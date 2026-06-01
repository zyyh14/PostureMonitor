/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 模型主导姿态分析层
 * --------------------------
 * 1. 先从 MediaPipe 33 关键点提取几何特征
 * 2. 交给离线训练导出的 KAN 模型做五分类预测
 * 3. 用个性化校准基线修正前后倾/距离/头肩深度
 * 4. 规则仅作为辅助解释，不参与最终体态判定
 */

import type { NormalizedLandmark } from './poseDetector';
import { POSE_LANDMARKS } from './poseDetector';
import type { CalibrationProfile } from '../types';
import { predictKan, type KanLabel } from './kanModelRuntime';

export interface PostureSnapshot {
  neckAngle: number;
  shoulderDiff: number;
  shoulderDiffNorm: number;
  screenDistance: number;
  torsoTilt: number;
  headTilt: number;
  headDepthDelta: number;
  torsoDepthDelta: number;
  gazeFocus: number;
  confidence: number;
  presence: boolean;
  signedTilt: number;
  calibratedScreenDistance?: number;
  calibratedHeadDepthDelta?: number;
  calibratedTorsoDepthDelta?: number;
  calibratedShoulderDiff?: number;
  calibratedTorsoTilt?: number;
  calibratedSignedTilt?: number;
}

const rad2deg = (r: number) => (r * 180) / Math.PI;

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function angleFromVertical(dx: number, dy: number): number {
  return rad2deg(Math.atan2(Math.abs(dx), Math.abs(dy)));
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export const DEFAULT_BASELINE: CalibrationProfile = {
  baselineNeckAngle: 14,
  baselineShoulderRatio: 0.28,
  baselineEyeY: 0.35,
  baselineNoseShoulderDist: 0.18,
  baselineHeadDepthDelta: 0,
  baselineTorsoDepthDelta: 0,
  baselineShoulderDiff: 0,
  baselineTorsoTilt: 0,
  baselineSignedTilt: 0,
  calibratedAt: '',
  pixelToCmRatio: 0,
};

export function analyzePose(
  lm: NormalizedLandmark[],
  baseline: CalibrationProfile,
  frameWidth = 640
): PostureSnapshot {
  const nose = lm[POSE_LANDMARKS.NOSE];
  const lShoulder = lm[POSE_LANDMARKS.LEFT_SHOULDER];
  const rShoulder = lm[POSE_LANDMARKS.RIGHT_SHOULDER];
  const lEye = lm[POSE_LANDMARKS.LEFT_EYE];
  const rEye = lm[POSE_LANDMARKS.RIGHT_EYE];
  const lHip = lm[POSE_LANDMARKS.LEFT_HIP];
  const rHip = lm[POSE_LANDMARKS.RIGHT_HIP];

  const requiredVis = [nose, lShoulder, rShoulder, lEye, rEye]
    .every(p => p && (p.visibility ?? 1) > 0.25);
  const presence = requiredVis;

  if (!presence) {
    return {
      neckAngle: 0,
      shoulderDiff: 0,
      shoulderDiffNorm: 0,
      screenDistance: 0,
      torsoTilt: 0,
      headTilt: 0,
      headDepthDelta: 0,
      torsoDepthDelta: 0,
      gazeFocus: 0,
      confidence: 0,
      presence: false,
      signedTilt: 0,
    };
  }

  const midShoulder = {
    x: (lShoulder.x + rShoulder.x) / 2,
    y: (lShoulder.y + rShoulder.y) / 2,
    z: ((lShoulder.z ?? 0) + (rShoulder.z ?? 0)) / 2,
  };
  const dxNose = nose.x - midShoulder.x;
  const dyNose = nose.y - midShoulder.y;
  let neckAngle = angleFromVertical(dxNose, dyNose);

  const noseZ = nose.z ?? 0;
  const shoulderZ = midShoulder.z;
  const rawHeadDepthDelta = noseZ - shoulderZ;
  const headDepthDelta = rawHeadDepthDelta - (baseline.baselineHeadDepthDelta ?? 0);
  const zForward = Math.max(0, shoulderZ - noseZ);
  neckAngle += zForward * 60;
  neckAngle = Math.max(0, neckAngle - (baseline.baselineNeckAngle - 14));

  const shoulderDiffNorm = Math.abs(lShoulder.y - rShoulder.y);
  const shoulderDiff = shoulderDiffNorm * 480;

  const shoulderWidthNorm = Math.hypot(
    lShoulder.x - rShoulder.x,
    lShoulder.y - rShoulder.y
  );
  const k = baseline.pixelToCmRatio > 0 ? baseline.pixelToCmRatio : 0.28 * 60;
  const screenDistance = Math.min(150, Math.max(20, k / Math.max(0.05, shoulderWidthNorm)));

  let torsoTilt = 0;
  let torsoDepthDelta = 0;
  let signedTilt = 0;
  const hipVisible = lHip && rHip && (lHip.visibility ?? 0) > 0.3 && (rHip.visibility ?? 0) > 0.3;
  if (hipVisible) {
    const midHip = {
      x: (lHip.x + rHip.x) / 2,
      y: (lHip.y + rHip.y) / 2,
      z: ((lHip.z ?? 0) + (rHip.z ?? 0)) / 2,
    };
    const dx = midShoulder.x - midHip.x;
    const dy = midShoulder.y - midHip.y;
    torsoTilt = angleFromVertical(dx, dy);
    torsoDepthDelta = ((midShoulder.z ?? 0) - (midHip.z ?? 0)) - (baseline.baselineTorsoDepthDelta ?? 0);
    signedTilt = dx;
  } else {
    torsoTilt = rad2deg(Math.atan2(
      Math.abs(lShoulder.y - rShoulder.y),
      Math.abs(lShoulder.x - rShoulder.x)
    ));
    signedTilt = midShoulder.x - 0.5;
  }

  const calibratedHeadDepthDelta = headDepthDelta - (baseline.baselineHeadDepthDelta ?? 0);
  const calibratedTorsoDepthDelta = torsoDepthDelta - (baseline.baselineTorsoDepthDelta ?? 0);
  const calibratedShoulderDiff = Math.max(0, shoulderDiff - (baseline.baselineShoulderDiff ?? 0));
  const calibratedTorsoTilt = Math.max(0, Math.abs(torsoTilt - (baseline.baselineTorsoTilt ?? 0)));
  const calibratedSignedTilt = Math.max(0, Math.abs(signedTilt - (baseline.baselineSignedTilt ?? 0)));

  const eyeDx = rEye.x - lEye.x;
  const eyeDy = rEye.y - lEye.y;
  const headTilt = Math.abs(rad2deg(Math.atan2(eyeDy, eyeDx)));

  const centerScore = 100 - Math.min(100, Math.abs(nose.x - 0.5) * 250);
  const eyeSymScore = (() => {
    const lv = lEye.visibility ?? 0;
    const rv = rEye.visibility ?? 0;
    return 100 * Math.min(lv, rv) / Math.max(0.001, Math.max(lv, rv));
  })();
  const tiltPenalty = Math.min(40, headTilt * 2);
  const slouchPenalty = Math.min(30, neckAngle * 0.8);
  const gazeFocus = Math.max(0, Math.min(100, Math.round(
    centerScore * 0.45 + eyeSymScore * 0.35 + (100 - tiltPenalty - slouchPenalty) * 0.20
  )));

  const confidence = [nose, lShoulder, rShoulder, lEye, rEye]
    .reduce((acc, p) => acc * (p.visibility ?? 0.5), 1) ** (1 / 5);

  return {
    neckAngle: Number(neckAngle.toFixed(1)),
    shoulderDiff: Number(shoulderDiff.toFixed(1)),
    shoulderDiffNorm: Number(shoulderDiffNorm.toFixed(4)),
    screenDistance: Number(screenDistance.toFixed(0)),
    torsoTilt: Number(torsoTilt.toFixed(1)),
    headTilt: Number(headTilt.toFixed(1)),
    headDepthDelta: Number(headDepthDelta.toFixed(3)),
    torsoDepthDelta: Number(torsoDepthDelta.toFixed(3)),
    gazeFocus,
    confidence: Number(confidence.toFixed(2)),
    presence,
    signedTilt: Number(signedTilt.toFixed(4)),
    calibratedScreenDistance: Number((screenDistance - (baseline.baselineNoseShoulderDist ?? 0) * 100).toFixed(0)),
    calibratedHeadDepthDelta: Number(calibratedHeadDepthDelta.toFixed(3)),
    calibratedTorsoDepthDelta: Number(calibratedTorsoDepthDelta.toFixed(3)),
    calibratedShoulderDiff: Number(calibratedShoulderDiff.toFixed(1)),
    calibratedTorsoTilt: Number(calibratedTorsoTilt.toFixed(1)),
    calibratedSignedTilt: Number(calibratedSignedTilt.toFixed(4)),
  };
}

export function buildCalibration(samples: NormalizedLandmark[][]): CalibrationProfile | null {
  if (samples.length === 0) return null;

  const scored = samples
    .map(lm => {
      const nose = lm[POSE_LANDMARKS.NOSE];
      const ls = lm[POSE_LANDMARKS.LEFT_SHOULDER];
      const rs = lm[POSE_LANDMARKS.RIGHT_SHOULDER];
      if (!nose || !ls || !rs) return null;
      const score = (nose.visibility ?? 0) + (ls.visibility ?? 0) + (rs.visibility ?? 0);
      return { lm, score };
    })
    .filter((item): item is { lm: NormalizedLandmark[]; score: number } => !!item)
    .sort((a, b) => b.score - a.score);

  const usable = scored.slice(0, Math.min(scored.length, 12)).map(item => item.lm);
  if (usable.length < 3) return null;

  const necks: number[] = [];
  const shoulderRatios: number[] = [];
  const eyeYs: number[] = [];
  const noseShoulderDists: number[] = [];
  const headDepths: number[] = [];
  const torsoDepths: number[] = [];
  const shoulderDiffs: number[] = [];
  const torsoTilts: number[] = [];
  const signedTilts: number[] = [];

  usable.forEach(lm => {
    const nose = lm[POSE_LANDMARKS.NOSE];
    const ls = lm[POSE_LANDMARKS.LEFT_SHOULDER];
    const rs = lm[POSE_LANDMARKS.RIGHT_SHOULDER];
    const lh = lm[POSE_LANDMARKS.LEFT_HIP];
    const rh = lm[POSE_LANDMARKS.RIGHT_HIP];
    const eye = lm[POSE_LANDMARKS.LEFT_EYE] ?? nose;

    const mid = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
    const midShoulderZ = (ls.z + rs.z) / 2;
    const dxNose = nose.x - mid.x;
    const dyNose = nose.y - mid.y;
    necks.push(angleFromVertical(dxNose, dyNose));
    headDepths.push((nose.z ?? 0) - midShoulderZ);
    if (lh && rh) {
      const midHipZ = ((lh.z ?? 0) + (rh.z ?? 0)) / 2;
      torsoDepths.push(midShoulderZ - midHipZ);
    }

    shoulderRatios.push(Math.hypot(ls.x - rs.x, ls.y - rs.y));
    shoulderDiffs.push(Math.abs(ls.y - rs.y) * 480);
    torsoTilts.push(0);
    signedTilts.push(lh && rh ? (mid.x - ((lh.x + rh.x) / 2)) : (mid.x - 0.5));
    eyeYs.push(eye.y);
    noseShoulderDists.push(dist(nose, mid));
  });

  const baselineShoulderRatio = median(shoulderRatios);
  const pixelToCmRatio = baselineShoulderRatio * 60;

  return {
    baselineNeckAngle: median(necks),
    baselineShoulderRatio,
    baselineEyeY: median(eyeYs),
    baselineNoseShoulderDist: median(noseShoulderDists),
    baselineHeadDepthDelta: median(headDepths),
    baselineTorsoDepthDelta: median(torsoDepths),
    baselineShoulderDiff: median(shoulderDiffs),
    baselineTorsoTilt: median(torsoTilts),
    baselineSignedTilt: median(signedTilts),
    pixelToCmRatio,
    calibratedAt: new Date().toISOString(),
  };
}

type RuleFlags = {
  isSlouched: boolean;
  isHighLowShoulder: boolean;
  isTooClose: boolean;
  isTorsoTilted: boolean;
  isForwardLeaning: boolean;
  isBackwardLeaning: boolean;
};

function labelToRuleFlags(label: KanLabel): RuleFlags {
  return {
    isSlouched: label === 'TLF',
    isHighLowShoulder: label === 'TLR' || label === 'TLL',
    isTooClose: label === 'TLF',
    isTorsoTilted: label === 'TLR' || label === 'TLL',
    isForwardLeaning: label === 'TLF',
    isBackwardLeaning: label === 'TLB',
  };
}

function buildAuxFlags(snap: PostureSnapshot, baseline: CalibrationProfile): RuleFlags {
  const calibratedHead = snap.calibratedHeadDepthDelta ?? (snap.headDepthDelta - (baseline.baselineHeadDepthDelta ?? 0));
  const calibratedShoulderDiff = snap.calibratedShoulderDiff ?? Math.max(0, snap.shoulderDiff - (baseline.baselineShoulderDiff ?? 0));
  const calibratedTorsoTilt = snap.calibratedTorsoTilt ?? Math.max(0, Math.abs(snap.torsoTilt - (baseline.baselineTorsoTilt ?? 0)));
  const calibratedSignedTilt = snap.calibratedSignedTilt ?? Math.max(0, Math.abs(snap.signedTilt - (baseline.baselineSignedTilt ?? 0)));

  // 规则层只做“辅助确认”，不再参与主分类分数。
  // 前后倾仍以头肩深度 + 颈角 + 距离为主，但只作为报警辅助；
  // 侧倾/高低肩只用原始几何，不吃校准偏移。
  const forwardByRules = calibratedHead <= -0.02 && (
    snap.neckAngle >= 12 ||
    snap.screenDistance <= 62
  );
  const backwardByRules = calibratedHead >= 0.05 && (
    snap.neckAngle <= 15 ||
    snap.screenDistance >= 68
  );
  const sideByRules = calibratedTorsoTilt >= 4.5 || calibratedSignedTilt >= 0.02;
  const shoulderByRules = calibratedShoulderDiff >= 4.5;
  const tooCloseByRules = snap.screenDistance < 45 && snap.neckAngle >= 16;

  return {
    isSlouched: forwardByRules,
    isHighLowShoulder: shoulderByRules,
    isTooClose: tooCloseByRules,
    isTorsoTilted: sideByRules,
    isForwardLeaning: forwardByRules,
    isBackwardLeaning: backwardByRules,
  };
}

function ruleSupportScores(snap: PostureSnapshot, baseline: CalibrationProfile) {
  const calibratedHead = snap.calibratedHeadDepthDelta ?? (snap.headDepthDelta - (baseline.baselineHeadDepthDelta ?? 0));
  const calibratedShoulderDiff = snap.calibratedShoulderDiff ?? Math.max(0, snap.shoulderDiff - (baseline.baselineShoulderDiff ?? 0));
  const calibratedTorsoTilt = snap.calibratedTorsoTilt ?? Math.max(0, Math.abs(snap.torsoTilt - (baseline.baselineTorsoTilt ?? 0)));
  const calibratedSignedTilt = snap.calibratedSignedTilt ?? Math.max(0, Math.abs(snap.signedTilt - (baseline.baselineSignedTilt ?? 0)));
  const forwardSupport =
    calibratedHead <= -0.02 && (snap.neckAngle >= 12 || snap.screenDistance <= 62);
  const backwardSupport =
    calibratedHead >= 0.05 && (snap.neckAngle <= 15 || snap.screenDistance >= 68);
  const sideSupport = calibratedTorsoTilt >= 4.5 || calibratedSignedTilt >= 0.02;
  const rightSupport = sideSupport && snap.signedTilt >= 0;
  const leftSupport = sideSupport && snap.signedTilt < 0;
  const calmSupport =
    !forwardSupport &&
    !backwardSupport &&
    !sideSupport &&
    calibratedShoulderDiff < 4.5 &&
    snap.screenDistance >= 45 &&
    snap.neckAngle <= 16;

  return {
    TUP: calmSupport ? 1 : 0,
    TLF: forwardSupport ? 1 : 0,
    TLB: backwardSupport ? 1 : 0,
    TLR: rightSupport ? 1 : 0,
    TLL: leftSupport ? 1 : 0,
  } as Record<KanLabel, number>;
}

export function analyzeWithKan(
  lm: NormalizedLandmark[],
  baseline: CalibrationProfile,
  frameWidth = 640
) {
  const snap = analyzePose(lm, baseline, frameWidth);
  const kanInput = {
    neck_angle: snap.neckAngle,
    head_depth_delta: snap.headDepthDelta,
    depth_delta: snap.torsoDepthDelta,
    torso_tilt: snap.torsoTilt,
    shoulder_diff: snap.shoulderDiff,
    shoulder_width: Math.max(0.01, Math.hypot(snap.shoulderDiffNorm, snap.torsoTilt / 90)),
    signed_tilt: snap.signedTilt,
  };
  const prediction = predictKan(kanInput);
  const modelFlags = labelToRuleFlags(prediction.label);
  const auxFlags = buildAuxFlags(snap, baseline);
  const ruleScores = ruleSupportScores(snap, baseline);
  const fusedScores = (Object.keys(prediction.probs) as KanLabel[]).reduce((acc, label) => {
    const modelScore = (prediction.probs[label] ?? 0) * 70;
    const ruleScore = (ruleScores[label] ?? 0) * 30;
    acc[label] = modelScore + ruleScore;
    return acc;
  }, {} as Record<KanLabel, number>);
  const finalLabel = (Object.entries(fusedScores).sort((a, b) => b[1] - a[1])[0][0]) as KanLabel;
  const flags: RuleFlags = labelToRuleFlags(finalLabel);
  const postureStatus: 'good' | 'warning' | 'danger' = finalLabel === 'TUP' ? 'good' : 'warning';

  let activityState: 'focused' | 'tired' | 'distracted' | 'away' = 'focused';
  if (!snap.presence) activityState = 'away';
  else if (snap.gazeFocus < 40) activityState = 'distracted';
  else if ((flags.isSlouched || flags.isForwardLeaning) && snap.gazeFocus < 70) activityState = 'tired';

  return {
    snap,
    prediction,
    flags,
    auxFlags,
    modelFlags,
    modelLabel: prediction.label,
    finalLabel,
    fusedScores,
    postureStatus,
    activityState,
  };
}

export function deriveStatus() {
  throw new Error('deriveStatus is replaced by analyzeWithKan in the model+rules pipeline.');
}
