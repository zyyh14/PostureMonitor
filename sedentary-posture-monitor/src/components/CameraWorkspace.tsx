/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 摄像头实时姿态监测工作台 — 生产级实现
 *
 * 关键设计原则
 * ============
 * 1. 摄像头 / 引擎 / 报警 三块完全解耦:
 *    - 报警永远不影响摄像头/引擎生命周期 (报警只发声)
 *    - 引擎失败不关闭摄像头流
 *    - 摄像头失败只更新错误状态，不写假数据
 *
 * 2. 报警走带迟滞的状态机 (PostureStateMachine):
 *    - 坏姿态需持续 3 秒 才升级 ALARM
 *    - 好姿态需持续 2 秒 才解除 ALARM
 *    - 同类别 30 秒冷却
 *    - 置信度 < 0.6 视为脏数据，跳过
 *
 * 3. 摄像头流幂等启停:
 *    - 每个组件实例只持有一个 stream
 *    - StrictMode 双挂载下，第二次 mount 会复用现有流，不会重新申请
 *    - 用户主动关闭才真正 stop()
 *
 * 4. Tab 不可见时暂停推理保留流, 回来时无缝恢复
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  Camera, CameraOff, Volume2, VolumeX, ShieldAlert, CheckCircle,
  Flame, Activity, Crosshair, Loader2, Sparkles, AlertCircle,
} from 'lucide-react';
import { PostureMetric, CalibrationProfile } from '../types';
import { PoseDetector, type NormalizedLandmark } from '../lib/poseDetector';
import {
  analyzeWithKan, buildCalibration, DEFAULT_BASELINE,
  type PostureSnapshot,
} from '../lib/postureAnalyzer';
import { drawSkeleton } from '../lib/skeletonRenderer';
import { playChime, pushNotification, speak } from '../lib/notifier';
import { PostureStateMachine, type AlarmEvent } from '../lib/postureStateMachine';
import { sessionKeeper } from '../lib/sessionKeeper';
import { toneClass, labelToChinese, resolveDisplayLabel, resolveMetricLabel } from '../lib/postureDisplay';

interface CameraWorkspaceProps {
  currentMetric: PostureMetric;
  onMetricChange: (metric: PostureMetric) => void;
  isWebcamActive: boolean;
  setIsWebcamActive: (active: boolean) => void;
  isPlaySound: boolean;
  setIsPlaySound: (active: boolean) => void;
}

const CALIBRATION_DURATION_MS = 4000;
const CALIBRATION_MIN_SAMPLES = 3;
const CALIBRATION_TARGET_SAMPLES = 6;
const CALIBRATION_MIN_LOCK_MS = 1800;
const BASELINE_STORAGE_KEY = 'vidipost_baseline';

export default function CameraWorkspace({
  currentMetric,
  onMetricChange,
  isWebcamActive,
  setIsWebcamActive,
  isPlaySound,
  setIsPlaySound,
}: CameraWorkspaceProps) {
  // ========= DOM Refs =========
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // ========= 运行时单例 (refs) =========
  const animationFrameId = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<PoseDetector | null>(null);
  const stateMachineRef = useRef<PostureStateMachine>(new PostureStateMachine({
    badDwellMs: 3000,    // 必须持续 3 秒不良才报警
    goodDwellMs: 2000,   // 必须持续 2 秒良好才解除
    classifyDwellMs: 2000,
    cooldownMs: 30_000,  // 同类别 30 秒冷却
    minConfidence: 0.6,
  }));
  const lastVoiceTsRef = useRef<number>(0);    // TTS 节流
  const fpsRef = useRef<{ count: number; t0: number; fps: number }>({ count: 0, t0: performance.now(), fps: 0 });
  const calibSamplesRef = useRef<NormalizedLandmark[][]>([]);
  const calibStartRef = useRef<number>(0);
  const sessionStartRef = useRef<number>(0);
  const pageHiddenRef = useRef<boolean>(false);
  const startupGuardRef = useRef<number>(0);

  // ========= props/state 镜像到 ref，让推理循环始终读到最新值 =========
  const baselineRef = useRef<CalibrationProfile>(DEFAULT_BASELINE);
  const calibratingRef = useRef<boolean>(false);
  const isPlaySoundRef = useRef<boolean>(isPlaySound);
  const onMetricChangeRef = useRef(onMetricChange);
  const currentMetricIdRef = useRef(currentMetric.id);
  useEffect(() => { onMetricChangeRef.current = onMetricChange; }, [onMetricChange]);
  useEffect(() => { currentMetricIdRef.current = currentMetric.id; }, [currentMetric.id]);
  useEffect(() => { isPlaySoundRef.current = isPlaySound; }, [isPlaySound]);

  // ========= 模拟模式滑杆 =========
  const [neckSlide, setNeckSlide] = useState(currentMetric.neckAngle);
  const [shoulderSlide, setShoulderSlide] = useState(currentMetric.shoulderDiff);
  const [distanceSlide, setDistanceSlide] = useState(currentMetric.screenDistance);
  const [focusSlide, setFocusSlide] = useState(currentMetric.gazeFocus);

  // ========= 引擎 / 摄像头状态 =========
  type EngineStatus = 'idle' | 'loading' | 'ready' | 'failed';
  const [engineStatus, setEngineStatus] = useState<EngineStatus>('idle');
  const [engineError, setEngineError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [streamActive, setStreamActive] = useState(false);
  const [fps, setFps] = useState(0);
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const [alarming, setAlarming] = useState(false);
  const [alarmText, setAlarmText] = useState<string>('');
  const [debugPanelOpen, setDebugPanelOpen] = useState(true);

  // ========= 校准 =========
  const [baseline, setBaseline] = useState<CalibrationProfile>(() => {
    try {
      const saved = localStorage.getItem(BASELINE_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        parsed.baselineHeadDepthDelta ??= 0;
        parsed.baselineTorsoDepthDelta ??= 0;
        baselineRef.current = parsed;
        return parsed;
      }
    } catch { /* noop */ }
    return DEFAULT_BASELINE;
  });
  useEffect(() => { baselineRef.current = baseline; }, [baseline]);

  const [calibrating, setCalibrating] = useState(false);
  const [calibProgress, setCalibProgress] = useState(0);
  const [calibStatusText, setCalibStatusText] = useState<string>('');
  useEffect(() => { calibratingRef.current = calibrating; }, [calibrating]);

  // ============ 1. 摄像头流: HMR 安全的幂等启停 ============
  useEffect(() => {
    if (!isWebcamActive) {
      // 用户主动关闭 → 真正释放
      sessionKeeper.hardStopStream();
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      sessionStartRef.current = 0;
      setSessionSeconds(0);
      setStreamActive(false);
      stateMachineRef.current.reset();
      setAlarming(false);
      setAlarmText('');
      return;
    }

    // 优先复用 globalThis 上的流（HMR 后第一时间找回）
    const persisted = sessionKeeper.getStream();
    if (persisted) {
      streamRef.current = persisted;
      setStreamActive(true);
      sessionStartRef.current = sessionKeeper.getSessionStart() || Date.now();
      if (videoRef.current && videoRef.current.srcObject !== persisted) {
        videoRef.current.srcObject = persisted;
        videoRef.current.play().catch(() => {});
      }
      return;
    }

    // 当前组件实例已有流且仍 active 直接复用
    if (streamRef.current && streamRef.current.active) {
      sessionKeeper.setStream(streamRef.current);
      if (videoRef.current && videoRef.current.srcObject !== streamRef.current) {
        videoRef.current.srcObject = streamRef.current;
        videoRef.current.play().catch(() => {});
      }
      return;
    }

    let cancelled = false;
    setCameraError(null);  // 进入新一轮申请，清除上次错误  // 进入新一轮申请，清除上次错误

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        streamRef.current = stream;
        sessionKeeper.setStream(stream);
        setStreamActive(true);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          try { await videoRef.current.play(); } catch { /* autoplay 受限可忽略 */ }
        }
        sessionStartRef.current = Date.now();
        sessionKeeper.setSessionStart(sessionStartRef.current);
        startupGuardRef.current = Date.now() + 8000;
        setSessionSeconds(0);

        // 监听 track 自身的 ended 事件 (例如用户在浏览器原生 UI 撤销了授权、
        // 或拔掉了 USB 摄像头)，做出可见的状态反馈而非默默关闭开关。
        stream.getVideoTracks().forEach(track => {
          track.addEventListener('ended', () => {
            setStreamActive(false);
            setCameraError('摄像头视频流被中断（可能是设备被拔出或权限被撤销），请点击重试。');
          });
        });
      } catch (err) {
        const e = err as DOMException;
        const msg =
          e.name === 'NotAllowedError'
            ? '摄像头权限被拒绝，请在浏览器地址栏左侧"锁形图标"处重新授权。'
            : e.name === 'NotFoundError'
              ? '未检测到可用摄像头设备，请检查硬件连接。'
              : e.name === 'NotReadableError'
                ? '摄像头被其他应用占用，请关闭占用程序后重试。'
                : '摄像头启动失败：' + (e.message || '未知错误');
        // 不自动关闭开关 — 让用户保留摄像头 ON 状态以便点击重试
        setCameraError(msg);
      }
    })();

    return () => { cancelled = true; };
  }, [isWebcamActive]);

  // ============ 2. 组件卸载时只取消推理循环, 保留全局流 ============
  // 注意: 这里不能 stop streamRef.current，因为 HMR 会卸载组件后立即重新挂载，
  // 一旦 stop 流就需要重新申请权限 → 用户体验上看到的就是"摄像头反复重启"。
  // 流的真正释放只发生在用户手动关闭摄像头时 (上面 effect 1 的 if(!isWebcamActive))。
  useEffect(() => {
    return () => {
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
    };
  }, []);

  // ============ 3. MediaPipe 引擎初始化 ============
  // 注意: 我们不再在关闭摄像头时把 engineStatus 重置为 idle —— 引擎是全局单例，
  // 一次加载后即便关闭/重开摄像头，仍然保持 ready 状态，避免反复 LOADING 闪烁。
  useEffect(() => {
    if (!isWebcamActive) return;

    // 如果全局单例已 ready，直接同步状态
    if (sessionKeeper.isDetectorReady()) {
      detectorRef.current = PoseDetector.getInstance();
      if (engineStatus !== 'ready') setEngineStatus('ready');
      return;
    }

    if (engineStatus === 'ready' || engineStatus === 'loading') return;

    setEngineStatus('loading');
    setEngineError(null);
    const detector = PoseDetector.getInstance();
    detectorRef.current = detector;
    detector.init()
      .then(() => {
        sessionKeeper.markDetectorReady();
        setEngineStatus('ready');
      })
      .catch(err => {
        console.error('MediaPipe init 失败', err);
        setEngineError('AI 引擎加载失败：' + (err?.message || '请检查网络或刷新重试'));
        setEngineStatus('failed');
      });
  }, [isWebcamActive, engineStatus]);

  // ============ 4. 推理循环 ============
  useEffect(() => {
    if (!isWebcamActive || engineStatus !== 'ready') return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const detector = detectorRef.current;
    if (!video || !canvas || !detector) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let stopped = false;
    let metricThrottle = 0;

    const loop = async () => {
      if (stopped) return;

      // Tab 不可见 → 暂停推理 (保留流)，每 500ms 检查一次
      if (pageHiddenRef.current) {
        setTimeout(() => { if (!stopped) loop(); }, 500);
        return;
      }

      if (!video || video.readyState < 2) {
        animationFrameId.current = requestAnimationFrame(loop);
        return;
      }

      const ts = performance.now();
      let result;
      try {
        result = await detector.detect(video, ts);
      } catch {
        animationFrameId.current = requestAnimationFrame(loop);
        return;
      }
      if (stopped) return;

      // FPS 统计
      const fpsState = fpsRef.current;
      fpsState.count++;
      if (ts - fpsState.t0 > 1000) {
        fpsState.fps = (fpsState.count * 1000) / (ts - fpsState.t0);
        fpsState.count = 0; fpsState.t0 = ts;
        setFps(Math.round(fpsState.fps));
      }

      let snap: PostureSnapshot;
      let flags: {
        isSlouched: boolean;
        isHighLowShoulder: boolean;
        isTooClose: boolean;
        isTorsoTilted: boolean;
        isForwardLeaning?: boolean;
        isBackwardLeaning?: boolean;
      };
      let postureStatus: PostureMetric['postureStatus'] = 'good';
      let activityState: PostureMetric['activityState'] = 'focused';
      let modelLabel: PostureMetric['modelLabel'] = 'TUP';
      let finalLabel: PostureMetric['finalLabel'] = 'TUP';
      if (result.detected && result.landmarks) {
        const analyzed = analyzeWithKan(result.landmarks, baselineRef.current, canvas.width);
        snap = analyzed.snap;
        flags = analyzed.flags;
        modelLabel = analyzed.modelLabel;
        finalLabel = analyzed.finalLabel;
        postureStatus = analyzed.postureStatus;
        activityState = analyzed.activityState;
        if (calibratingRef.current) {
          calibSamplesRef.current.push(result.landmarks);
          const elapsed = performance.now() - calibStartRef.current;
          const sampleCount = calibSamplesRef.current.length;
          setCalibProgress(Math.min(100, Math.max(
            (elapsed / CALIBRATION_DURATION_MS) * 70,
            (sampleCount / CALIBRATION_TARGET_SAMPLES) * 100
          )));
          setCalibStatusText(`已采样 ${sampleCount} 帧，至少需要 ${CALIBRATION_MIN_SAMPLES} 帧`);
          const enoughTime = elapsed >= CALIBRATION_MIN_LOCK_MS;
          const enoughSamples = sampleCount >= CALIBRATION_TARGET_SAMPLES;
          const timedOut = elapsed >= CALIBRATION_DURATION_MS;
          if ((enoughTime && enoughSamples) || timedOut) finishCalibrationRef.current?.();
        }
      } else {
        snap = {
          neckAngle: 0, shoulderDiff: 0, shoulderDiffNorm: 0,
          screenDistance: 0, torsoTilt: 0, headTilt: 0, headDepthDelta: 0,
          torsoDepthDelta: 0,
          gazeFocus: 0, confidence: 0, presence: false,
          signedTilt: 0,
        };
        flags = {
          isSlouched: false, isHighLowShoulder: false, isTooClose: false, isTorsoTilted: false,
        };
        postureStatus = 'good';
        activityState = 'away';
        modelLabel = 'TUP';
        finalLabel = 'TUP';
      }

      // === 状态机喂入 (核心) ===
      const event: AlarmEvent | null = stateMachineRef.current.feed({
        flags: Date.now() < startupGuardRef.current ? {
          isSlouched: false,
          isHighLowShoulder: false,
          isTooClose: false,
          isTorsoTilted: false,
          isBackwardLeaning: false,
        } : flags,
        confidence: snap.confidence,
        presence: snap.presence,
      });

      // 同步 UI 报警态
      const stableLabels = stateMachineRef.current.getStableLabels(Date.now());
      const displayLabel = resolveDisplayLabel(finalLabel, stableLabels);
      const machineAlarming = displayLabel === 'TUP' ? false : stateMachineRef.current.isAnyAlarming();
      setAlarming(machineAlarming);
      setAlarmText(displayLabel === 'TUP'
        ? ''
        : ({
            TLF: '前倾',
            TLB: '后仰',
            TLR: '右倾',
            TLL: '左倾',
          } as const)[displayLabel as 'TLF' | 'TLB' | 'TLR' | 'TLL'] ?? '');

      // 真正触发声音/通知 (状态机已经做了节流冷却)
      if (event) {
        const alertTitle = event.message;
        const alertBody = `检测到${event.message}，请调整坐姿。`;
        if (isPlaySoundRef.current) {
          playChime(event.severity);
          // TTS 至少间隔 8 秒，避免连续同时多类别叠音
          if (Date.now() - lastVoiceTsRef.current > 8000) {
            speak(`检测到${event.message}，请调整坐姿。`);
            lastVoiceTsRef.current = Date.now();
          }
        }
        if (event.severity === 'danger') {
          pushNotification(alertTitle, alertBody);
        }
      }

      // 渲染骨骼
      drawSkeleton(ctx, result.landmarks, snap, flags, canvas.width, canvas.height);

      // 节流上报到上层 (~每 6 帧)
      metricThrottle++;
      if (metricThrottle >= 6 && snap.presence) {
        metricThrottle = 0;
        onMetricChangeRef.current({
          id: currentMetricIdRef.current,
          timestamp: new Date().toISOString(),
          neckAngle: snap.neckAngle,
          shoulderDiff: snap.shoulderDiff,
          screenDistance: snap.screenDistance,
          gazeFocus: snap.gazeFocus,
          torsoTilt: snap.torsoTilt,
          headTilt: snap.headTilt,
          headDepthDelta: snap.headDepthDelta,
          torsoDepthDelta: snap.torsoDepthDelta,
          isSlouched: Date.now() < startupGuardRef.current ? false : flags.isSlouched,
          isHighLowShoulder: Date.now() < startupGuardRef.current ? false : flags.isHighLowShoulder,
          isTooClose: Date.now() < startupGuardRef.current ? false : flags.isTooClose,
          isTorsoTilted: Date.now() < startupGuardRef.current ? false : flags.isTorsoTilted,
          isForwardLeaning: Date.now() < startupGuardRef.current ? false : flags.isForwardLeaning,
          isBackwardLeaning: Date.now() < startupGuardRef.current ? false : flags.isBackwardLeaning,
          postureStatus,
          activityState,
          detectionSource: 'mediapipe',
          confidence: snap.confidence,
          modelLabel,
          finalLabel: displayLabel,
        });
      }

      animationFrameId.current = requestAnimationFrame(loop);
    };

    animationFrameId.current = requestAnimationFrame(loop);

    return () => {
      stopped = true;
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
        animationFrameId.current = null;
      }
    };
  }, [isWebcamActive, engineStatus]);

  // ============ 5. Page Visibility 监听 ============
  useEffect(() => {
    const onVis = () => {
      pageHiddenRef.current = document.hidden;
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // ============ 6. 会话计时 ============
  useEffect(() => {
    if (!isWebcamActive) return;
    const id = window.setInterval(() => {
      if (sessionStartRef.current > 0) {
        setSessionSeconds(Math.floor((Date.now() - sessionStartRef.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(id);
  }, [isWebcamActive]);

  // ============ 7. 模拟模式 (无摄像头时滑杆驱动) ============
  useEffect(() => {
    if (isWebcamActive) return;
    const isSlouched = neckSlide > 18;
    const isHighLowShoulder = shoulderSlide > 4.5;
    const isTooClose = distanceSlide < 45;
    let postureStatus: 'good' | 'warning' | 'danger' = 'good';
    if (isSlouched && isTooClose) postureStatus = 'danger';
    else if (isSlouched || isHighLowShoulder || isTooClose) postureStatus = 'warning';
    let activityState: PostureMetric['activityState'] = 'focused';
    if (focusSlide < 40) activityState = 'distracted';
    else if (isSlouched && focusSlide < 65) activityState = 'tired';
    const manualLabel = isSlouched || isTooClose ? 'TLF' : isHighLowShoulder ? 'TLR' : 'TUP';

    onMetricChangeRef.current({
      ...currentMetric,
      timestamp: new Date().toISOString(),
        neckAngle: neckSlide,
        shoulderDiff: shoulderSlide,
        screenDistance: distanceSlide,
        gazeFocus: focusSlide,
        torsoDepthDelta: 0,
        isSlouched, isHighLowShoulder, isTooClose,
        isForwardLeaning: false,
        isBackwardLeaning: false,
        postureStatus, activityState,
        detectionSource: 'manual',
        confidence: 1,
        modelLabel: manualLabel,
        finalLabel: manualLabel,
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [neckSlide, shoulderSlide, distanceSlide, focusSlide, isWebcamActive]);

  // ============ 8. 校准 ============
  const finishCalibrationRef = useRef<() => void>(() => {});
  const startCalibration = useCallback(() => {
    if (!isWebcamActive || engineStatus !== 'ready') {
      alert('请先开启摄像头并等待 AI 引擎就绪。');
      return;
    }
    calibSamplesRef.current = [];
    calibStartRef.current = performance.now();
    setCalibProgress(0);
    setCalibStatusText('开始采样，请保持端正坐姿并尽量正对摄像头。');
    setCalibrating(true);
    if (isPlaySoundRef.current) speak('请保持端正坐姿不要动，系统正在自动采样。');
  }, [isWebcamActive, engineStatus]);

  const finishCalibration = useCallback(() => {
    setCalibrating(false);
    const samples = calibSamplesRef.current;
    calibSamplesRef.current = [];
    setCalibStatusText('');
    const newBaseline = buildCalibration(samples);
    if (!newBaseline) {
      alert(`采样不足，校准失败，请重试。当前仅采到 ${samples.length} 帧，建议保持正对摄像头并避免遮挡。`);
      return;
    }
    setBaseline(newBaseline);
    try { localStorage.setItem(BASELINE_STORAGE_KEY, JSON.stringify(newBaseline)); } catch { /* noop */ }
    if (isPlaySoundRef.current) speak('校准完成，正在使用您的个人坐姿基线。');
    // 校准后清空状态机，避免基线变化造成的瞬态误报
    stateMachineRef.current.reset();
  }, []);
  useEffect(() => { finishCalibrationRef.current = finishCalibration; }, [finishCalibration]);

  const resetCalibration = useCallback(() => {
    setBaseline(DEFAULT_BASELINE);
    try { localStorage.removeItem(BASELINE_STORAGE_KEY); } catch { /* noop */ }
    stateMachineRef.current.reset();
  }, []);

  const isCalibrated = !!baseline.calibratedAt;

  const sessionDisplay = (() => {
    const h = Math.floor(sessionSeconds / 3600);
    const m = Math.floor((sessionSeconds % 3600) / 60);
    const s = sessionSeconds % 60;
    return h > 0
      ? `${h}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`
      : `${m}m ${s.toString().padStart(2, '0')}s`;
  })();

  const retryCamera = () => {
    setCameraError(null);
    // 强制触发流重新申请: 先停掉残留流让 effect 检测到 stream 不再 active 后重申请
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    // 让 isWebcamActive 维持 true，只是触发副作用重跑 - 通过引用替换技巧
    // 直接把 video.srcObject 清掉，下次 effect 跑时就会发现 stream 不存在并重新申请
    if (videoRef.current) videoRef.current.srcObject = null;
    // 用 toggle false→true 强制触发，但要等一帧让 React 处理掉关闭的副作用
    setIsWebcamActive(false);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setIsWebcamActive(true));
    });
  };

  const retryEngine = () => {
    setEngineStatus('idle');
  };

  const currentDisplayLabel = resolveMetricLabel(currentMetric) ?? 'TUP';

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col h-full shadow-2xl relative overflow-hidden">
      {/* 引擎/FPS 指示 */}
      <div className="absolute top-0 right-0 bg-slate-950/60 text-emerald-400 font-mono text-[9.5px] px-3 py-1.5 rounded-bl-xl border-l border-b border-slate-700 hidden sm:flex items-center gap-1">
        <Activity className="w-3.5 h-3.5" />
        {engineStatus === 'ready' ? `MEDIAPIPE · ${fps}FPS` :
          engineStatus === 'loading' ? 'LOADING…' :
            engineStatus === 'failed' ? 'ENGINE-FAIL' : 'STANDBY'}
      </div>

      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-slate-100 flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${isWebcamActive ? 'bg-sky-500' : 'bg-slate-600'}`}></span>
            工作空间实时流
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            MediaPipe Pose 33 关键点 · 状态机迟滞防误报 · 个性化基线
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsPlaySound(!isPlaySound)}
            className={`p-2 rounded-lg transition-all ${isPlaySound
              ? 'bg-slate-800 text-amber-400 hover:bg-slate-700'
              : 'bg-slate-950 text-slate-600 hover:bg-slate-800'
              }`}
            title={isPlaySound ? '警报音已启用' : '警报音已静音'}
          >
            {isPlaySound ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>

          <button
            onClick={() => {
              // 用户点击切换。注意此处只允许由用户点击触发；任何代码路径都不应自动调 setIsWebcamActive(false)。
              setIsWebcamActive(!isWebcamActive);
            }}
            className={`flex items-center gap-1.5 text-xs font-semibold py-1.5 px-3 rounded-lg transition-all ${isWebcamActive
              ? 'bg-red-500/90 hover:bg-red-600 text-white'
              : 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-500/10'
              }`}
            title={isWebcamActive ? '点击关闭摄像头' : '点击开启摄像头'}
          >
            {isWebcamActive ? (
              <><CameraOff className="w-3.5 h-3.5" />关闭摄像头 · {sessionDisplay}</>
            ) : (
              <><Camera className="w-3.5 h-3.5" />开启摄像头</>
            )}
          </button>
        </div>
      </div>

      {/* 调试面板：用于观察实时判定到底是哪一项把正常坐姿推成前倾 */}
      <div className="mb-3 bg-slate-950/60 border border-slate-800 rounded-lg p-3 text-[10px] font-mono">
        <div className="flex items-center justify-between mb-2">
          <span className="text-slate-400">调试面板</span>
          <button
            onClick={() => setDebugPanelOpen(v => !v)}
            className="text-slate-500 hover:text-slate-300"
          >
            {debugPanelOpen ? '收起' : '展开'}
          </button>
        </div>
        {debugPanelOpen && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <DebugCell label="颈倾角" value={`${(currentMetric.neckAngle ?? 0).toFixed(1)}°`} />
            <DebugCell label="头肩深度" value={formatSignedDepth(currentMetric.headDepthDelta)} />
            <DebugCell label="屏幕距离" value={`${(currentMetric.screenDistance ?? 0).toFixed(0)}cm`} />
            <DebugCell label="体态判定" value={labelToChinese(currentDisplayLabel)} />
            <DebugCell label="置信度" value={`${((currentMetric.confidence ?? 0) * 100).toFixed(0)}%`} />
            <DebugCell label="校准状态" value={calibrating ? `采样中 ${calibSamplesRef.current.length} 帧` : isCalibrated ? '已校准' : '未校准'} />
          </div>
        )}
      </div>

      {/* 运行状态诊断条 (永久可见，方便排错) */}
      <div className="mb-3 bg-slate-950/40 border border-slate-800 rounded-lg px-3 py-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-mono">
        <span className="text-slate-500">摄像头</span>
        <span className={isWebcamActive ? 'text-emerald-400' : 'text-slate-500'}>
          {isWebcamActive ? 'ON' : 'OFF'}
        </span>
        <span className="text-slate-700">|</span>
        <span className="text-slate-500">流</span>
        <span className={streamActive ? 'text-emerald-400' : 'text-slate-500'}>
          {streamActive ? 'ACTIVE' : 'NULL'}
        </span>
        <span className="text-slate-700">|</span>
        <span className="text-slate-500">引擎</span>
        <span className={
          engineStatus === 'ready' ? 'text-emerald-400' :
            engineStatus === 'loading' ? 'text-amber-400' :
              engineStatus === 'failed' ? 'text-red-400' : 'text-slate-500'
        }>
          {engineStatus.toUpperCase()}
        </span>
        <span className="text-slate-700">|</span>
        <span className="text-slate-500">FPS</span>
        <span className="text-slate-300">{fps}</span>
        <span className="text-slate-700">|</span>
        <span className="text-slate-500">检测置信度</span>
        <span className={`${(currentMetric.confidence ?? 0) >= 0.6 ? 'text-emerald-400' : 'text-slate-500'}`}>
          {((currentMetric.confidence ?? 0) * 100).toFixed(0)}%
        </span>
      </div>

      {/* 摄像头 / 引擎错误条 - 始终可见(即便摄像头处于关闭状态)，
          这样用户主动点开却失败时能立刻看到原因，而不是被默默弹回关闭态 */}
      {(cameraError || engineError) && (
        <div className="mb-3 bg-red-950/60 border border-red-500/40 rounded-lg p-2.5 flex items-start gap-2 text-[11px]">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="text-red-200 font-semibold mb-0.5">
              {cameraError ? '摄像头错误' : '引擎错误'}
            </div>
            <div className="text-red-300">{cameraError || engineError}</div>
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => { setCameraError(null); setEngineError(null); }}
              className="text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded transition-all shrink-0"
            >
              忽略
            </button>
            <button
              onClick={cameraError ? retryCamera : retryEngine}
              className="text-[10px] bg-red-500/30 hover:bg-red-500/50 text-red-100 px-2 py-1 rounded transition-all shrink-0"
            >
              重试
            </button>
          </div>
        </div>
      )}

      {/* 画面 */}
      <div className="relative aspect-video w-full rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-center overflow-hidden shadow-2xl">

        {isWebcamActive ? (
          <>
            <video
              ref={videoRef}
              className="absolute inset-0 w-full h-full object-cover select-none scale-x-[-1]"
              muted
              playsInline
              autoPlay
            />
            <canvas
              ref={canvasRef}
              width={640}
              height={480}
              className="absolute inset-0 w-full h-full object-cover scale-x-[-1] z-10 pointer-events-none"
            />

            {engineStatus === 'loading' && (
              <div className="absolute inset-0 bg-slate-950/80 z-30 flex flex-col items-center justify-center backdrop-blur-sm">
                <Loader2 className="w-8 h-8 text-sky-400 animate-spin mb-3" />
                <p className="text-xs text-slate-300 font-medium">正在加载 MediaPipe AI 引擎…</p>
                <p className="text-[10px] text-slate-500 mt-1">首次需下载约 6MB WASM 与模型</p>
              </div>
            )}

            {calibrating && (
              <div className="absolute inset-0 bg-indigo-950/70 z-30 flex flex-col items-center justify-center backdrop-blur-sm">
                <Crosshair className="w-9 h-9 text-indigo-300 mb-2" />
                <p className="text-sm text-indigo-100 font-bold">基线校准中</p>
                <p className="text-[11px] text-indigo-300 mt-1">请保持端正坐姿，目视屏幕中央</p>
                <p className="text-[10px] text-indigo-200 mt-1 font-mono">{calibStatusText}</p>
                <div className="mt-3 w-48 h-2 bg-indigo-950 rounded-full overflow-hidden border border-indigo-500/30">
                  <div className="h-full bg-gradient-to-r from-indigo-400 to-sky-400 transition-all" style={{ width: `${calibProgress}%` }} />
                </div>
                <p className="text-[10px] text-indigo-300 mt-1.5 font-mono">{Math.round(calibProgress)}%</p>
              </div>
            )}
          </>
        ) : (
          <div className="text-center p-6 flex flex-col items-center">
            <div className="w-36 h-36 border border-dashed border-slate-700 rounded-full mb-4 flex items-center justify-center relative">
              <div
                className="w-10 h-10 rounded-full bg-indigo-500/20 border-2 border-indigo-400 flex items-center justify-center transition-all absolute"
                style={{ top: `${Math.max(10, 45 - (distanceSlide / 2.5))}%`, transform: `translateX(${(shoulderSlide * 3)}px)` }}
              >
                <div className="w-2.5 h-2.5 bg-indigo-400 rounded-full"></div>
              </div>
              <div className="absolute top-[48%] left-1/2 w-20 h-0.5 bg-slate-700 -translate-x-1/2" />
              <div
                className="absolute top-[52%] left-1/2 w-28 h-1 bg-emerald-500 transition-all rounded"
                style={{ transform: `translate(-50%, -50%) rotate(${shoulderSlide * 1.5}deg)` }}
              />
              <span className="absolute bottom-2 text-[10px] font-mono text-slate-500">模拟姿势坐标投影器</span>
            </div>
            <p className="text-xs text-slate-400 font-medium">摄像头已关闭，正在通过「手动实验台」驱动状态</p>
            <p className="text-[10px] text-slate-500 mt-1">滑动下方拉杆即可仿真各类不良姿势</p>
          </div>
        )}

        {/* 报警条 — 由状态机驱动，连续 3s 不良才显示 */}
        {alarming ? (
          <div className="absolute bottom-3 left-3 right-3 z-20 bg-red-950/90 border border-red-500/50 rounded-lg p-2.5 flex items-center gap-3">
            <ShieldAlert className="w-5 h-5 text-red-400 shrink-0" />
            <div className="text-left">
              <h4 className="text-xs font-bold text-red-200">体态警报</h4>
              <p className="text-[10.5px] text-red-300">{alarmText} · 请调整坐姿</p>
            </div>
          </div>
        ) : isWebcamActive && engineStatus === 'ready' ? (
          <div className={`absolute bottom-3 right-3 z-20 border rounded-lg px-2.5 py-1 flex items-center gap-1.5 ${
            toneClass(currentDisplayLabel === 'TUP' ? 'emerald' : 'amber')
          }`}>
            <CheckCircle className={`w-4 h-4 ${currentDisplayLabel === 'TUP' ? 'text-emerald-400' : 'text-amber-400'}`} />
            <span className={`text-[10.5px] font-medium ${currentDisplayLabel === 'TUP' ? 'text-emerald-200' : 'text-amber-200'}`}>
              体态判定：{labelToChinese(currentDisplayLabel)}
            </span>
          </div>
        ) : null}
      </div>

      {/* 控件区 */}
      <div className="mt-4 flex-1 flex flex-col justify-end space-y-4 pt-1 border-t border-slate-800">
        <div className="flex items-center justify-between">
          <h3 className="text-slate-300 font-medium text-xs flex items-center gap-1.5">
            <Flame className="w-3.5 h-3.5 text-indigo-400" />
            校准与状态 {isWebcamActive ? '实时读取' : '仿真控制'}
          </h3>
          <div className="flex items-center gap-2">
            {isCalibrated && (
              <span className="text-[9.5px] text-emerald-400 font-mono bg-emerald-950/40 border border-emerald-500/20 px-1.5 py-0.5 rounded">
                ✓ 已完成中立校准
              </span>
            )}
            <button
              onClick={startCalibration}
              disabled={!isWebcamActive || engineStatus !== 'ready' || calibrating}
              className="flex items-center gap-1 text-[10px] font-semibold py-1 px-2 rounded-md bg-indigo-600/80 hover:bg-indigo-500 text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              title="用 5 秒静坐采样，建立属于您的中立姿态基线"
            >
              <Sparkles className="w-3 h-3" />
              {calibrating ? '校准中…' : '中立校准'}
            </button>
            {isCalibrated && (
              <button
                onClick={resetCalibration}
                className="text-[9.5px] text-slate-500 hover:text-slate-300 underline"
              >
                重置
              </button>
            )}
          </div>
        </div>

        {isWebcamActive ? (
          <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-3 text-[11px] text-slate-300 leading-relaxed">
            <div className="font-semibold text-slate-100 mb-1">实时特征说明</div>
            <div className="text-slate-400">
              上方调试面板显示实时数值和模型判定。这里的“中立校准”只修正前后倾和离屏距离，不会修正左右倾，避免把侧倾基线拉歪。
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <SliderRow label="脖椎前倾角度" value={neckSlide} setValue={setNeckSlide} min={2} max={45} step={0.5} unit="°" warn={neckSlide > 18} accent="sky" />
            <SliderRow label="高低肩偏差" value={shoulderSlide} setValue={setShoulderSlide} min={0} max={15} step={0.1} unit=" px" warn={shoulderSlide > 4.5} accent="indigo" />
            <SliderRow label="眼周离屏距离" value={distanceSlide} setValue={setDistanceSlide} min={20} max={100} step={1} unit=" cm" warn={distanceSlide < 45} accent="purple" />
            <SliderRow label="注视专注评分" value={focusSlide} setValue={setFocusSlide} min={10} max={100} step={1} unit=" 分" warn={focusSlide < 40} accent="emerald" />
          </div>
        )}
      </div>
    </div>
  );
}

// ============ 子组件 ============

function MetricCell({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className={`bg-slate-950/50 border ${bad ? 'border-red-500/40' : 'border-slate-800'} rounded-lg px-2 py-1.5`}>
      <div className="text-slate-500 text-[9px]">{label}</div>
      <div className={`font-bold text-xs ${bad ? 'text-red-400' : 'text-slate-200'}`}>{value}</div>
    </div>
  );
}

function DebugCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-md px-2 py-1.5">
      <div className="text-slate-500 text-[9px]">{label}</div>
      <div className="text-slate-200 text-[10px] break-all">{value}</div>
    </div>
  );
}

function formatSignedDepth(value?: number) {
  const v = value ?? 0;
  const dir = v < 0 ? '前' : v > 0 ? '后' : '中';
  return `${dir}${Math.abs(v).toFixed(3)}`;
}

function formatHeadTilt(value?: number) {
  const v = value ?? 0;
  const dir = v > 12 ? '明显侧倾' : v > 6 ? '轻微侧倾' : '基本水平';
  return `${v.toFixed(1)}° | ${dir}`;
}

function SliderRow({
  label, value, setValue, min, max, step, unit, warn, accent,
}: {
  label: string; value: number; setValue: (v: number) => void;
  min: number; max: number; step: number; unit: string;
  warn: boolean; accent: 'sky' | 'indigo' | 'purple' | 'emerald';
}) {
  const accentClass = {
    sky: 'accent-sky-500',
    indigo: 'accent-indigo-500',
    purple: 'accent-purple-500',
    emerald: 'accent-emerald-500',
  }[accent];
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px] font-mono">
        <span className="text-slate-400">{label}</span>
        <span className={warn ? 'text-red-400 font-semibold' : 'text-slate-300'}>
          {value}{unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => setValue(parseFloat(e.target.value))}
        className={`w-full h-1.5 bg-slate-950 rounded-lg appearance-none cursor-pointer ${accentClass}`}
      />
    </div>
  );
}
