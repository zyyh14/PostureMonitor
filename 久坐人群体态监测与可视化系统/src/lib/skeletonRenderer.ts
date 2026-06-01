/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 在 Canvas 上绘制 MediaPipe 骨架与几何辅助线
 * 把"假绿框"换成基于真实 33 个关键点的可视化
 */

import type { NormalizedLandmark } from './poseDetector';
import { POSE_LANDMARKS } from './poseDetector';
import type { PostureSnapshot } from './postureAnalyzer';

// 骨骼连线 (MediaPipe Pose 上半身) - [a, b, color]
const CONNECTIONS: Array<[number, number, string]> = [
  // 面部三角
  [POSE_LANDMARKS.LEFT_EYE, POSE_LANDMARKS.RIGHT_EYE, 'rgba(96, 165, 250, 0.8)'],
  [POSE_LANDMARKS.LEFT_EYE, POSE_LANDMARKS.NOSE, 'rgba(96, 165, 250, 0.8)'],
  [POSE_LANDMARKS.RIGHT_EYE, POSE_LANDMARKS.NOSE, 'rgba(96, 165, 250, 0.8)'],
  [POSE_LANDMARKS.LEFT_EAR, POSE_LANDMARKS.LEFT_EYE, 'rgba(96, 165, 250, 0.6)'],
  [POSE_LANDMARKS.RIGHT_EAR, POSE_LANDMARKS.RIGHT_EYE, 'rgba(96, 165, 250, 0.6)'],
  // 双肩横梁
  [POSE_LANDMARKS.LEFT_SHOULDER, POSE_LANDMARKS.RIGHT_SHOULDER, 'rgba(16, 185, 129, 0.95)'],
  // 上肢
  [POSE_LANDMARKS.LEFT_SHOULDER, POSE_LANDMARKS.LEFT_ELBOW, 'rgba(16, 185, 129, 0.85)'],
  [POSE_LANDMARKS.LEFT_ELBOW, POSE_LANDMARKS.LEFT_WRIST, 'rgba(16, 185, 129, 0.85)'],
  [POSE_LANDMARKS.RIGHT_SHOULDER, POSE_LANDMARKS.RIGHT_ELBOW, 'rgba(16, 185, 129, 0.85)'],
  [POSE_LANDMARKS.RIGHT_ELBOW, POSE_LANDMARKS.RIGHT_WRIST, 'rgba(16, 185, 129, 0.85)'],
  // 躯干
  [POSE_LANDMARKS.LEFT_SHOULDER, POSE_LANDMARKS.LEFT_HIP, 'rgba(168, 85, 247, 0.7)'],
  [POSE_LANDMARKS.RIGHT_SHOULDER, POSE_LANDMARKS.RIGHT_HIP, 'rgba(168, 85, 247, 0.7)'],
  [POSE_LANDMARKS.LEFT_HIP, POSE_LANDMARKS.RIGHT_HIP, 'rgba(168, 85, 247, 0.7)'],
];

// 根据当前姿态状态返回主色调
function statusColor(snap: PostureSnapshot, hasIssue: boolean): string {
  if (!snap.presence) return 'rgba(100, 116, 139, 0.7)';
  if (hasIssue) return 'rgba(239, 68, 68, 1)';
  return 'rgba(16, 185, 129, 1)';
}

export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[] | null,
  snap: PostureSnapshot,
  flags: { isSlouched: boolean; isHighLowShoulder: boolean; isTooClose: boolean; isTorsoTilted: boolean },
  width: number,
  height: number
) {
  ctx.clearRect(0, 0, width, height);

  // 顶层 HUD（即便没识别到也显示）
  drawHUD(ctx, snap, width, height);

  if (!landmarks) {
    drawNoSubject(ctx, width, height);
    return;
  }

  const hasIssue = flags.isSlouched || flags.isHighLowShoulder || flags.isTooClose || flags.isTorsoTilted;
  const main = statusColor(snap, hasIssue);

  // 1. 骨架连线
  ctx.lineWidth = 3;
  CONNECTIONS.forEach(([a, b, defaultColor]) => {
    const pa = landmarks[a], pb = landmarks[b];
    if (!pa || !pb) return;
    if ((pa.visibility ?? 1) < 0.3 || (pb.visibility ?? 1) < 0.3) return;
    ctx.strokeStyle = hasIssue ? main : defaultColor;
    ctx.beginPath();
    ctx.moveTo(pa.x * width, pa.y * height);
    ctx.lineTo(pb.x * width, pb.y * height);
    ctx.stroke();
  });

  // 2. 关键关键点圆点 + 标签
  const KEY_LABELS: Array<[number, string, string]> = [
    [POSE_LANDMARKS.NOSE, 'Nose', '#ef4444'],
    [POSE_LANDMARKS.LEFT_SHOULDER, 'L-Sh', '#10b981'],
    [POSE_LANDMARKS.RIGHT_SHOULDER, 'R-Sh', '#10b981'],
    [POSE_LANDMARKS.LEFT_EAR, 'L-Ear', '#60a5fa'],
    [POSE_LANDMARKS.RIGHT_EAR, 'R-Ear', '#60a5fa'],
  ];
  KEY_LABELS.forEach(([idx, label, color]) => {
    const p = landmarks[idx];
    if (!p || (p.visibility ?? 1) < 0.3) return;
    const x = p.x * width;
    const y = p.y * height;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.fillRect(x + 7, y - 8, ctx.measureText(label).width + 8, 14);
    ctx.fillStyle = '#fff';
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.fillText(label, x + 11, y + 3);
  });

  // 3. 颈部前倾角辅助线 (从肩中点到鼻子)
  const ls = landmarks[POSE_LANDMARKS.LEFT_SHOULDER];
  const rs = landmarks[POSE_LANDMARKS.RIGHT_SHOULDER];
  const nose = landmarks[POSE_LANDMARKS.NOSE];
  if (ls && rs && nose) {
    const midX = ((ls.x + rs.x) / 2) * width;
    const midY = ((ls.y + rs.y) / 2) * height;
    const noseX = nose.x * width;
    const noseY = nose.y * height;

    // 垂直参考虚线
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(midX, midY);
    ctx.lineTo(midX, midY - 120);
    ctx.stroke();
    ctx.setLineDash([]);

    // 实际颈线
    ctx.strokeStyle = flags.isSlouched ? '#ef4444' : '#fbbf24';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(midX, midY);
    ctx.lineTo(noseX, noseY);
    ctx.stroke();

    // 角度弧 + 数值
    const angleRad = Math.atan2(noseX - midX, midY - noseY);
    ctx.strokeStyle = flags.isSlouched ? '#ef4444' : '#fbbf24';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(midX, midY, 28, -Math.PI / 2, -Math.PI / 2 + angleRad, angleRad < 0);
    ctx.stroke();

    ctx.fillStyle = flags.isSlouched ? '#ef4444' : '#fbbf24';
    ctx.font = 'bold 12px JetBrains Mono, monospace';
    ctx.fillText(`${snap.neckAngle.toFixed(1)}°`, midX + 8, midY - 30);
  }

  // 4. 警告标记
  if (flags.isHighLowShoulder && ls && rs) {
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 3]);
    ctx.beginPath();
    ctx.moveTo(ls.x * width, ls.y * height);
    ctx.lineTo(rs.x * width, rs.y * height);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawHUD(
  ctx: CanvasRenderingContext2D,
  snap: PostureSnapshot,
  width: number,
  _height: number
) {
  ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
  ctx.fillRect(8, 8, 222, 92);
  ctx.strokeStyle = snap.presence ? '#10b981' : '#64748b';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(8, 8, 222, 92);

  ctx.fillStyle = '#fff';
  ctx.font = 'bold 11px JetBrains Mono, monospace';
  ctx.fillText('MediaPipe Pose · LIVE', 18, 26);

  ctx.font = '11px JetBrains Mono, monospace';
  ctx.fillStyle = snap.presence ? '#cbd5e1' : '#64748b';
  ctx.fillText(`Neck: ${snap.neckAngle.toFixed(1)}°`, 18, 44);
  ctx.fillText(`Sh-Δ: ${snap.shoulderDiff.toFixed(1)} px`, 18, 60);
  ctx.fillText(`Dist: ${snap.screenDistance.toFixed(0)} cm`, 18, 76);
  ctx.fillText(`Conf: ${(snap.confidence * 100).toFixed(0)}%`, 130, 76);

  // 状态点
  const presenceColor = snap.presence ? '#10b981' : '#64748b';
  ctx.fillStyle = presenceColor;
  ctx.beginPath();
  ctx.arc(217, 22, 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawNoSubject(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.fillStyle = 'rgba(239, 68, 68, 0.15)';
  ctx.fillRect(0, height - 40, width, 40);
  ctx.fillStyle = '#fca5a5';
  ctx.font = 'bold 13px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('未检测到上半身，请正对摄像头并露出双肩', width / 2, height - 16);
  ctx.textAlign = 'start';
}
