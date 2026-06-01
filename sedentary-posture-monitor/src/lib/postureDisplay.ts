import type { PostureMetric } from '../types';

export type PostureTone = 'emerald' | 'amber' | 'red' | 'slate';
export type PostureLabel = NonNullable<PostureMetric['finalLabel']>;
export type StablePostureClass = 'slouch' | 'shoulder' | 'close' | 'torso' | 'backward';

export interface PostureDisplay {
  label: string;
  tone: PostureTone;
  statusLabel: string;
  statusTone: PostureTone;
  detail: string;
}

export function labelToChinese(label?: 'TUP' | 'TLF' | 'TLB' | 'TLR' | 'TLL') {
  if (!label) return '';
  return {
    TUP: '端正坐姿',
    TLF: '前倾',
    TLB: '后仰',
    TLR: '右倾',
    TLL: '左倾',
  }[label] ?? '';
}

export function resolveDisplayLabel(
  liveLabel: PostureLabel | undefined,
  stableClasses: StablePostureClass[]
): PostureLabel {
  if (!liveLabel || liveLabel === 'TUP') return 'TUP';
  if (liveLabel === 'TLF') {
    return stableClasses.some(c => c === 'slouch') ? liveLabel : 'TUP';
  }
  if (liveLabel === 'TLB') {
    return stableClasses.some(c => c === 'backward') ? liveLabel : 'TUP';
  }
  if (liveLabel === 'TLR' || liveLabel === 'TLL') {
    return stableClasses.some(c => c === 'torso' || c === 'shoulder') ? liveLabel : 'TUP';
  }
  return 'TUP';
}

export function resolveMetricLabel(metric: Partial<Pick<PostureMetric,
  'finalLabel' |
  'modelLabel' |
  'postureStatus' |
  'isSlouched' |
  'isTooClose' |
  'isHighLowShoulder' |
  'isTorsoTilted' |
  'isForwardLeaning' |
  'isBackwardLeaning'
>>): PostureLabel | undefined {
  if (metric.finalLabel) return metric.finalLabel;
  if (metric.modelLabel) return metric.modelLabel;
  if (metric.isBackwardLeaning) return 'TLB';
  if (metric.isForwardLeaning || metric.isSlouched || metric.isTooClose) return 'TLF';
  if (metric.isTorsoTilted || metric.isHighLowShoulder) return 'TLR';
  if (metric.postureStatus === 'good') return 'TUP';
  if (metric.postureStatus === 'warning' || metric.postureStatus === 'danger') return 'TLF';
  return undefined;
}

export function isBadPostureMetric(metric: Partial<Pick<PostureMetric,
  'finalLabel' |
  'modelLabel' |
  'postureStatus' |
  'isSlouched' |
  'isTooClose' |
  'isHighLowShoulder' |
  'isTorsoTilted' |
  'isForwardLeaning' |
  'isBackwardLeaning'
>>): boolean {
  const label = metric.finalLabel ?? metric.modelLabel;
  if (label) return label !== 'TUP';
  return !!(
    metric.isSlouched ||
    metric.isTooClose ||
    metric.isHighLowShoulder ||
    metric.isTorsoTilted ||
    metric.isForwardLeaning ||
    metric.isBackwardLeaning ||
    metric.postureStatus === 'warning' ||
    metric.postureStatus === 'danger'
  );
}

export function describePosture(metric: Pick<PostureMetric,
  'finalLabel' |
  'modelLabel' |
  'isForwardLeaning' |
  'isBackwardLeaning'
>): PostureDisplay {
  const label = resolveMetricLabel(metric);
  const status = label === 'TUP'
    ? { label: '端正', tone: 'emerald' as const }
    : label
      ? { label: '异常', tone: 'amber' as const }
      : { label: '', tone: 'slate' as const };

  return {
    label: label ? labelToChinese(label) : '',
    tone: status.tone,
    statusLabel: status.label,
    statusTone: status.tone,
    detail: status.label === '端正' ? '当前姿态稳定' : '',
  };
}

export function toneClass(tone: PostureTone) {
  return {
    emerald: 'text-emerald-400 bg-emerald-950/40 border-emerald-500/30',
    amber: 'text-amber-400 bg-amber-950/40 border-amber-500/30',
    red: 'text-red-400 bg-red-950/40 border-red-500/30',
    slate: 'text-slate-400 bg-slate-950/40 border-slate-700',
  }[tone];
}

export function toneTextClass(tone: PostureTone) {
  return {
    emerald: 'text-emerald-400',
    amber: 'text-amber-400',
    red: 'text-red-400',
    slate: 'text-slate-400',
  }[tone];
}
