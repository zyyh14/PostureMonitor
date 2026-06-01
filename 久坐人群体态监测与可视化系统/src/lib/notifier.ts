/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 三通道提醒: Web Notification API + Web Audio 警报音 + Speech Synthesis
 * 用于久坐提醒、姿态报警、番茄钟。
 */

let audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (Ctx) audioCtx = new Ctx();
  }
  if (audioCtx?.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

/** 三连提示音 (友好不刺耳) */
export function playChime(severity: 'info' | 'warn' | 'danger' = 'info') {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const start = ctx.currentTime;
  const tones = severity === 'danger'
    ? [330, 392, 523, 392]   // 急促 4 音
    : severity === 'warn'
      ? [440, 554, 659]        // 三和弦
      : [523, 659];            // 双音

  tones.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const t = start + i * 0.18;
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.45);
  });
}

/** 浏览器原生通知 */
export async function pushNotification(title: string, body: string) {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission === 'default') {
    try { await Notification.requestPermission(); } catch { /* ignore */ }
  }
  if (Notification.permission === 'granted') {
    try {
      new Notification(title, { body, silent: false, tag: 'vidipost' });
      return true;
    } catch (e) {
      console.warn('Notification失败:', e);
    }
  }
  return false;
}

export async function ensureNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'denied';
  if (Notification.permission === 'default') {
    try { return await Notification.requestPermission(); } catch { return 'denied'; }
  }
  return Notification.permission;
}

/** 中文 TTS 语音播报 */
export function speak(text: string, lang = 'zh-CN') {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = 0.95;
    u.pitch = 1.05;
    u.volume = 0.85;
    window.speechSynthesis.cancel(); // 防叠音
    window.speechSynthesis.speak(u);
  } catch (e) {
    console.warn('TTS 不可用', e);
  }
}
