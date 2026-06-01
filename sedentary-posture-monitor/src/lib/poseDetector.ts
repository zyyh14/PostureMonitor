/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MediaPipe Pose Landmarker 封装
 * ------------------------------
 * 调用 Google MediaPipe Tasks Vision，用 GPU 跑 33 关键点姿态检测。
 * 关键点索引参考 MediaPipe Pose 文档:
 *   0  = nose
 *   2/5 = left/right eye (inner)
 *   7  = left ear, 8 = right ear
 *   11 = left shoulder, 12 = right shoulder
 *   13 = left elbow,    14 = right elbow
 *   23 = left hip,      24 = right hip
 */

import { FilesetResolver, PoseLandmarker, type PoseLandmarkerResult } from '@mediapipe/tasks-vision';
import { PoseSmoother } from './oneEuroFilter';

export const POSE_LANDMARKS = {
  NOSE: 0,
  LEFT_EYE_INNER: 1,
  LEFT_EYE: 2,
  LEFT_EYE_OUTER: 3,
  RIGHT_EYE_INNER: 4,
  RIGHT_EYE: 5,
  RIGHT_EYE_OUTER: 6,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  MOUTH_LEFT: 9,
  MOUTH_RIGHT: 10,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
} as const;

// 我们关心的关键点子集，只对这些点做 One-Euro 平滑
const TRACKED_INDICES = [
  POSE_LANDMARKS.NOSE,
  POSE_LANDMARKS.LEFT_EYE,
  POSE_LANDMARKS.RIGHT_EYE,
  POSE_LANDMARKS.LEFT_EAR,
  POSE_LANDMARKS.RIGHT_EAR,
  POSE_LANDMARKS.LEFT_SHOULDER,
  POSE_LANDMARKS.RIGHT_SHOULDER,
  POSE_LANDMARKS.LEFT_HIP,
  POSE_LANDMARKS.RIGHT_HIP,
];

export interface NormalizedLandmark {
  x: number; y: number; z: number; visibility: number;
}

export interface PoseResult {
  landmarks: NormalizedLandmark[] | null;
  worldLandmarks: NormalizedLandmark[] | null;
  detected: boolean;
  inferenceMs: number;
}

let _instance: PoseDetector | null = null;

export class PoseDetector {
  private landmarker: PoseLandmarker | null = null;
  private smoother = new PoseSmoother();
  private initializing: Promise<void> | null = null;

  static getInstance(): PoseDetector {
    // 把单例挂到 globalThis 上，HMR 重载模块时仍能找回
    const G = globalThis as any;
    if (G.__vidipost_pose_detector__) return G.__vidipost_pose_detector__ as PoseDetector;
    if (!_instance) _instance = new PoseDetector();
    G.__vidipost_pose_detector__ = _instance;
    return _instance;
  }

  async init(): Promise<void> {
    if (this.landmarker) return;
    if (this.initializing) return this.initializing;

    this.initializing = (async () => {
      // Tasks Vision 通过 jsdelivr CDN 加载 wasm 二进制
      const fileset = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm'
      );
      this.landmarker = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: {
          // 用 lite 模型在 CPU/低端 GPU 上也能跑出 25FPS+
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputSegmentationMasks: false,
      });
    })();
    await this.initializing;
  }

  /** 对每帧 video 元素做姿态推理 */
  async detect(video: HTMLVideoElement, timestampMs: number): Promise<PoseResult> {
    if (!this.landmarker) {
      return { landmarks: null, worldLandmarks: null, detected: false, inferenceMs: 0 };
    }
    const t0 = performance.now();
    let result: PoseLandmarkerResult;
    try {
      result = this.landmarker.detectForVideo(video, timestampMs);
    } catch (e) {
      // 视频还没准备好或者 timestamp 倒退会抛错，吞掉
      return { landmarks: null, worldLandmarks: null, detected: false, inferenceMs: 0 };
    }
    const inferenceMs = performance.now() - t0;

    if (!result.landmarks || result.landmarks.length === 0) {
      return { landmarks: null, worldLandmarks: null, detected: false, inferenceMs };
    }

    const raw = result.landmarks[0] as NormalizedLandmark[];
    const world = (result.worldLandmarks?.[0] ?? null) as NormalizedLandmark[] | null;

    // One-Euro 平滑: 只对追踪的关键点做，其他保持原值
    const smoothed: NormalizedLandmark[] = raw.map((lm, idx) => {
      if (!TRACKED_INDICES.includes(idx as any)) return lm;
      return {
        x: this.smoother.smooth(idx, 'x', lm.x, timestampMs),
        y: this.smoother.smooth(idx, 'y', lm.y, timestampMs),
        z: this.smoother.smooth(idx, 'z', lm.z, timestampMs),
        visibility: lm.visibility ?? 1,
      };
    });

    return { landmarks: smoothed, worldLandmarks: world, detected: true, inferenceMs };
  }

  reset() {
    this.smoother.reset();
  }

  dispose() {
    this.landmarker?.close();
    this.landmarker = null;
    this.smoother.reset();
  }
}
