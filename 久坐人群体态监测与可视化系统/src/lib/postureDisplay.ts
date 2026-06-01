import type { PostureMetric } from '../types';

export type PostureTone = 'emerald' | 'amber' | 'red' | 'slate';

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

export function describePosture(metric: Pick<PostureMetric,
  'finalLabel' |
  'modelLabel' |
  'isForwardLeaning' |
  'isBackwardLeaning'
>): PostureDisplay {
  const label = metric.finalLabel ?? metric.modelLabel;
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
