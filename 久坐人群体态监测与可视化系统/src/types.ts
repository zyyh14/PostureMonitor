/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface PostureMetric {
  id: string;
  timestamp: string;
  neckAngle: number;       // 颈部前倾角 (度)
  shoulderDiff: number;    // 左右高低肩偏差 (像素/比例)
  screenDistance: number;  // 离屏距离 (cm)
  gazeFocus: number;       // 专注度评分 (0-100)
  torsoTilt?: number;      // 躯干侧倾角 (度) - 新增
  headTilt?: number;       // 头部侧倾角 (度) - 新增
  headDepthDelta?: number; // 头-肩深度差，用于区分前倾/后仰
  torsoDepthDelta?: number; // 肩-髋深度差，用于区分前倾/后仰
  isSlouched: boolean;     // 是否前倾/驼背
  isHighLowShoulder: boolean; // 是否高低肩
  isTooClose: boolean;     // 是否离屏幕过近
  isTorsoTilted?: boolean; // 是否躯干侧倾
  isForwardLeaning?: boolean; // 是否明显前倾
  isBackwardLeaning?: boolean; // 是否明显后仰
  postureStatus: 'good' | 'warning' | 'danger'; // 兼容字段：保留给告警状态机和旧导出，不再作为主显示源
  activityState: 'focused' | 'tired' | 'distracted' | 'away'; // 活动状态
  detectionSource?: 'mediapipe' | 'manual' | 'simulated'; // 数据来源
  confidence?: number;     // 关键点置信度 (0-1)
  modelLabel?: 'TUP' | 'TLF' | 'TLB' | 'TLR' | 'TLL'; // 模型原始输出类别
  finalLabel?: 'TUP' | 'TLF' | 'TLB' | 'TLR' | 'TLL'; // 唯一对外显示的最终体态判定
}

export interface SessionSummary {
  totalMinutes: number;
  goodPostureMinutes: number;
  badPostureMinutes: number;
  alertCount: number;
  averageFocusScore: number;
  neckAngleAvg: number;
  shoulderDiffAvg: number;
  distanceAvg: number;
  healthySpineScore: number; // 0-100
}

export interface DatasetMetrics {
  precision: number;
  recall: number;
  map50: number;
  map50_95: number;
  datasetSize: number;
  classBreakdowns: {
    className: string;
    precision: number;
    recall: number;
    ap: number;
    sampleCount: number;
  }[];
}

export interface GeminiResponse {
  analysis: string;
  suggestions: string[];
  excercises: {
    name: string;
    duration: string;
    steps: string[];
    benefit: string;
  }[];
  score: number;
}

// 用户个性化校准基线
export interface CalibrationProfile {
  baselineNeckAngle: number;       // 中立坐姿下的颈部参考角
  baselineShoulderRatio: number;   // 中立坐姿下的肩宽/画面宽度比
  baselineEyeY: number;            // 中立坐姿眼睛在画面中的纵坐标 (归一化)
  baselineNoseShoulderDist: number; // 鼻到双肩中点的归一化距离
  baselineHeadDepthDelta?: number;  // 中立坐姿下的头-肩深度差
  baselineTorsoDepthDelta?: number; // 中立坐姿下的肩-髋深度差
  baselineShoulderDiff?: number;   // 中立坐姿下的高低肩偏差
  baselineTorsoTilt?: number;      // 中立坐姿下的躯干侧倾角
  baselineSignedTilt?: number;     // 中立坐姿下的左右偏移签名值
  calibratedAt: string;
  pixelToCmRatio: number;          // 像素 -> 厘米换算系数（基于双肩宽 ≈ 38cm）
}

// MediaPipe 33 关键点子集（我们关心的）
export interface PoseLandmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

export interface PoseFrameData {
  landmarks: PoseLandmark[] | null;
  timestamp: number;
}

// 番茄钟 / 久坐提醒
export interface SedentaryReminder {
  enabled: boolean;
  intervalMinutes: number;          // 多少分钟弹一次
  lastNotifiedAt: number;
  continuousSittingMinutes: number; // 已连续坐多久
}
