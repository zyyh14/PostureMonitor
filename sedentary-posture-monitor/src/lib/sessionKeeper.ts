/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Session Keeper — HMR 跨模块热替换的资源持久化层
 * --------------------------------------------------
 * Vite 在 dev 模式下每次保存源码都会热替换模块、重新挂载 React 组件，
 * 导致摄像头流被 stop()、MediaPipe 引擎被销毁。这破坏了"持续监测"的核心需求。
 *
 * 解决方案: 把摄像头流、MediaPipe 引擎实例挂到 globalThis 上，
 * HMR 重载模块时仍然能找回，从而做到真正的"一次开启，持续运行"。
 *
 * 在生产环境 (无 HMR) 下这些字段也只是普通的全局单例，无副作用。
 */

const G = globalThis as any;
const NS = '__vidipost_session__';

if (!G[NS]) {
  G[NS] = {
    stream: null as MediaStream | null,
    detectorReady: false,
    sessionStartedAt: 0,
  };
}

export const sessionKeeper = {
  getStream(): MediaStream | null {
    const s = G[NS].stream as MediaStream | null;
    return s && s.active ? s : null;
  },
  setStream(stream: MediaStream | null) {
    G[NS].stream = stream;
  },
  isDetectorReady(): boolean {
    return !!G[NS].detectorReady;
  },
  markDetectorReady() {
    G[NS].detectorReady = true;
  },
  getSessionStart(): number {
    return G[NS].sessionStartedAt || 0;
  },
  setSessionStart(ts: number) {
    G[NS].sessionStartedAt = ts;
  },
  /** 用户主动关闭摄像头时调用，真正释放资源 */
  hardStopStream() {
    const s = G[NS].stream as MediaStream | null;
    if (s) {
      s.getTracks().forEach(t => t.stop());
    }
    G[NS].stream = null;
    G[NS].sessionStartedAt = 0;
  },
};
