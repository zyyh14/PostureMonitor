/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 久坐番茄钟 / 主动休息提醒
 * - 会话内连续坐 N 分钟 → 弹原生 Notification + TTS 语音 + 警报音
 * - 用户可调阈值 (25/45/60 min)
 * - 起身离开时（连续 detect 不到主体 ≥ 30s）自动重置计时
 */

import React, { useEffect, useRef, useState } from 'react';
import { Coffee, Bell, BellOff } from 'lucide-react';
import { ensureNotificationPermission, playChime, pushNotification, speak } from '../lib/notifier';
import type { PostureMetric } from '../types';

interface Props {
  currentMetric: PostureMetric;
  isWebcamActive: boolean;
}

const STORAGE = 'vidipost_reminder';

export default function SedentaryTimer({ currentMetric, isWebcamActive }: Props) {
  const [enabled, setEnabled] = useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE) ?? 'true'); } catch { return true; }
  });
  const [intervalMin, setIntervalMin] = useState<number>(45);
  const [seatedSec, setSeatedSec] = useState(0);
  const [permission, setPermission] = useState<NotificationPermission>('default');

  const lastTickRef = useRef<number>(Date.now());
  const awaySinceRef = useRef<number | null>(null);
  const lastNotifyRef = useRef<number>(0);

  useEffect(() => {
    try { localStorage.setItem(STORAGE, JSON.stringify(enabled)); } catch { /* noop */ }
  }, [enabled]);

  useEffect(() => {
    ensureNotificationPermission().then(setPermission);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => {
      const now = Date.now();
      const dt = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;

      const isAway = currentMetric.activityState === 'away' || (isWebcamActive && currentMetric.confidence !== undefined && currentMetric.confidence < 0.2);

      if (isAway) {
        if (awaySinceRef.current === null) awaySinceRef.current = now;
        if (now - (awaySinceRef.current ?? now) > 30_000) {
          // 离开 ≥ 30s，重置计时
          setSeatedSec(0);
        }
      } else {
        awaySinceRef.current = null;
        setSeatedSec(prev => prev + dt);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [enabled, currentMetric.activityState, currentMetric.confidence, isWebcamActive]);

  // 阈值触发提醒
  useEffect(() => {
    if (!enabled) return;
    const threshold = intervalMin * 60;
    if (seatedSec < threshold) return;
    const now = Date.now();
    if (now - lastNotifyRef.current < 5 * 60_000) return; // 5 分钟内不重复
    lastNotifyRef.current = now;

    playChime('info');
    pushNotification('该起身活动了 🌿', `您已连续端坐 ${intervalMin} 分钟，站起来走两步、做做颈椎拉伸吧。`);
    speak(`您已经连续坐了${intervalMin}分钟，建议起身活动一下。`);
    // 不直接重置，等用户离开 30s 自动重置
  }, [seatedSec, intervalMin, enabled]);

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const progress = Math.min(100, (seatedSec / (intervalMin * 60)) * 100);
  const danger = progress >= 100;

  return (
    <div className="bg-[#0f172a]/60 border border-slate-800 rounded-2xl p-4 flex items-center gap-4 shadow-xl">
      <div className={`p-2.5 rounded-xl ${danger ? 'bg-red-500/15 text-red-400 border-red-500/30' : 'bg-amber-500/10 text-amber-400 border-amber-500/20'} border shrink-0`}>
        <Coffee className="w-5 h-5" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-baseline mb-1">
          <span className="text-[10px] uppercase font-bold text-slate-400 tracking-widest">连续端坐计时</span>
          <span className={`text-xs font-mono font-bold ${danger ? 'text-red-400' : 'text-slate-200'}`}>
            {fmt(seatedSec)} / {intervalMin}:00
          </span>
        </div>
        <div className="h-1.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
          <div
            className={`h-full transition-all ${danger ? 'bg-red-500' : 'bg-gradient-to-r from-amber-400 to-orange-500'}`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-[10px] text-slate-500">阈值:</span>
          {[25, 45, 60].map(m => (
            <button
              key={m}
              onClick={() => setIntervalMin(m)}
              className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${intervalMin === m ? 'bg-indigo-600/80 text-white' : 'text-slate-400 hover:text-slate-200'}`}
            >
              {m}min
            </button>
          ))}
          {permission !== 'granted' && (
            <span className="text-[9.5px] text-amber-500 ml-auto">通知权限未授予</span>
          )}
        </div>
      </div>

      <button
        onClick={() => setEnabled(!enabled)}
        className={`p-2 rounded-lg shrink-0 ${enabled ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30' : 'bg-slate-800 text-slate-500 hover:bg-slate-700'}`}
        title={enabled ? '关闭久坐提醒' : '开启久坐提醒'}
      >
        {enabled ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
      </button>
    </div>
  );
}
