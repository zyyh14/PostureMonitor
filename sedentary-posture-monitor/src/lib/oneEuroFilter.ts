/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * One-Euro Filter
 * ---------------
 * 基于 Géry Casiez 等人的论文 (CHI 2012)，专门用于消除人体关键点
 * 在低频时的漂移抖动 (jitter)，又能在高频快速运动时尽可能少引入延迟。
 *
 * 思路: 用一个 low-pass 滤波器估计信号导数(速度)，再用导数动态调整
 * 主滤波器的截止频率 fc = minCutoff + beta * |dx|。
 *
 * 这是项目"提高准确率"的关键模块——MediaPipe 的关键点本身有 2-5 像素
 * 抖动，靠它来稳定颈部前倾角等指标。
 */

class LowPassFilter {
  private y: number | null = null;
  private s: number | null = null;

  filter(x: number, alpha: number): number {
    if (this.y === null) {
      this.s = x;
    } else {
      this.s = alpha * x + (1 - alpha) * (this.s ?? x);
    }
    this.y = x;
    return this.s as number;
  }

  lastRawValue(): number | null {
    return this.y;
  }

  reset() {
    this.y = null;
    this.s = null;
  }
}

export class OneEuroFilter {
  private xFilter = new LowPassFilter();
  private dxFilter = new LowPassFilter();
  private lastTime: number | null = null;

  constructor(
    private minCutoff = 1.0,   // 最低截止频率 (Hz)，越小越稳越延迟
    private beta = 0.007,      // 速度敏感度，越大快速运动越跟手
    private dCutoff = 1.0      // 导数滤波截止
  ) {}

  private alpha(cutoff: number, dt: number): number {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
  }

  filter(x: number, timestamp: number): number {
    if (this.lastTime === null) {
      this.lastTime = timestamp;
      return this.xFilter.filter(x, 1);
    }

    const dt = Math.max(1e-3, (timestamp - this.lastTime) / 1000);
    this.lastTime = timestamp;

    const lastRaw = this.xFilter.lastRawValue();
    const dx = lastRaw === null ? 0 : (x - lastRaw) / dt;
    const edx = this.dxFilter.filter(dx, this.alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.xFilter.filter(x, this.alpha(cutoff, dt));
  }

  reset() {
    this.xFilter.reset();
    this.dxFilter.reset();
    this.lastTime = null;
  }
}

/**
 * 一组关键点 2D 坐标的批量平滑器。给每个 (landmarkIndex, axis) 维护
 * 独立的 OneEuroFilter，避免不同关键点的运动状态相互干扰。
 */
export class PoseSmoother {
  private filters = new Map<string, OneEuroFilter>();

  smooth(
    landmarkIndex: number,
    axis: 'x' | 'y' | 'z',
    value: number,
    timestamp: number
  ): number {
    const key = `${landmarkIndex}_${axis}`;
    let f = this.filters.get(key);
    if (!f) {
      // z 轴 (深度) 通常更不稳，给更强滤波
      f = axis === 'z'
        ? new OneEuroFilter(0.5, 0.005, 1.0)
        : new OneEuroFilter(1.2, 0.01, 1.0);
      this.filters.set(key, f);
    }
    return f.filter(value, timestamp);
  }

  reset() {
    this.filters.forEach(f => f.reset());
    this.filters.clear();
  }
}
