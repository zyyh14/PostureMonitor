/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 姿态报警状态机 (带迟滞 / Hysteresis)
 * ----------------------------------
 * 真实生产环境的核心: 单帧坏数据不触发警报，必须连续 N 秒满足才升级到 ALARM；
 * 同样，恢复也需要连续 M 秒好数据才回到 NORMAL。这避免了:
 *   - MediaPipe 关键点偶发抖动 → 假警报
 *   - 用户偶尔伸懒腰 / 转头 → 误报
 *   - 警报反复触发吓人 (alarm storm)
 *
 * 状态: NORMAL → SUSPECT (检测到坏姿态但未到 dwell 时间) → ALARM (持续坏)
 *      ALARM → RECOVERING (检测到好但未到 dwell 时间) → NORMAL
 *
 * 每个不良类别 (slouch / shoulder / close / torso) 独立计时与冷却。
 */

export type PostureClass = 'slouch' | 'shoulder' | 'close' | 'torso' | 'backward';

interface ClassState {
  badSince: number | null;     // 第一次连续检测到坏的时间戳
  goodSince: number | null;    // 第一次连续检测到好的时间戳
  alarming: boolean;           // 当前是否处于 ALARM 状态
  lastFiredAt: number;         // 上次成功触发报警的时间 (供冷却)
}

export interface AlarmEvent {
  classes: PostureClass[];     // 此次触发的具体不良类别
  severity: 'warn' | 'danger';
  message: string;             // 中文友好提示
}

export interface PostureStateMachineOptions {
  badDwellMs?: number;         // 连续多久判定坏 → 升级 ALARM (默认 3 秒)
  goodDwellMs?: number;        // 连续多久判定好 → 解除 ALARM (默认 2 秒)
  classifyDwellMs?: number;    // 连续多久才把某类姿态当作稳定判定 (默认 2 秒)
  cooldownMs?: number;         // 同一类别两次警报最小间隔 (默认 30 秒)
  minConfidence?: number;      // 置信度低于此值视为脏数据，忽略 (默认 0.6)
}

const CLASS_LABEL: Record<PostureClass, string> = {
  slouch: '前倾',
  shoulder: '高低肩',
  close: '离屏过近',
  torso: '躯干侧倾',
  backward: '后仰',
};

export class PostureStateMachine {
  private states: Record<PostureClass, ClassState>;
  private opts: Required<PostureStateMachineOptions>;

  constructor(options: PostureStateMachineOptions = {}) {
    this.opts = {
      badDwellMs: options.badDwellMs ?? 3000,
      goodDwellMs: options.goodDwellMs ?? 2000,
      classifyDwellMs: options.classifyDwellMs ?? 2000,
      cooldownMs: options.cooldownMs ?? 30_000,
      minConfidence: options.minConfidence ?? 0.6,
    };
    this.states = {
      slouch: this.newClassState(),
      shoulder: this.newClassState(),
      close: this.newClassState(),
      torso: this.newClassState(),
      backward: this.newClassState(),
    };
  }

  private newClassState(): ClassState {
    return { badSince: null, goodSince: null, alarming: false, lastFiredAt: 0 };
  }

  /**
   * 输入一帧检测结果，输出: 是否产生新的报警事件 (null 表示无新事件)
   * UI 上的"红色警示条"应该读 isAnyAlarming()，而 sound/notification 由本方法返回值触发
   */
  feed(input: {
    flags: {
      isSlouched: boolean;
      isHighLowShoulder: boolean;
      isTooClose: boolean;
      isTorsoTilted: boolean;
      isBackwardLeaning?: boolean;
    };
    confidence: number;
    presence: boolean;
    timestamp?: number;
  }): AlarmEvent | null {
    const now = input.timestamp ?? Date.now();
    // 置信度不足或无主体: 重置所有 bad 计时但保留当前 alarming (让用户回来后立即恢复)
    if (!input.presence || input.confidence < this.opts.minConfidence) {
      (Object.keys(this.states) as PostureClass[]).forEach(k => {
        this.states[k].badSince = null;
      });
      return null;
    }

    const map: Record<PostureClass, boolean> = {
      slouch: input.flags.isSlouched,
      shoulder: input.flags.isHighLowShoulder,
      close: input.flags.isTooClose,
      torso: input.flags.isTorsoTilted,
      backward: !!input.flags.isBackwardLeaning,
    };

    const fired: PostureClass[] = [];

    (Object.keys(map) as PostureClass[]).forEach(key => {
      const s = this.states[key];
      const isBad = map[key];

      if (isBad) {
        // 出现坏: 启动 badSince 计时，重置 goodSince
        if (s.badSince === null) s.badSince = now;
        s.goodSince = null;

        // 超过 dwell 阈值且冷却已过 → 升级 ALARM 并触发
        if (!s.alarming && (now - s.badSince) >= this.opts.badDwellMs) {
          if (now - s.lastFiredAt >= this.opts.cooldownMs) {
            s.alarming = true;
            s.lastFiredAt = now;
            fired.push(key);
          } else {
            // 仍在冷却中，不发声，但保持 alarming 视觉
            s.alarming = true;
          }
        }
      } else {
        // 好: 启动 goodSince，重置 badSince
        if (s.goodSince === null) s.goodSince = now;
        s.badSince = null;

        // 持续好 ≥ goodDwell → 解除 alarm
        if (s.alarming && (now - s.goodSince) >= this.opts.goodDwellMs) {
          s.alarming = false;
        }
      }
    });

    if (fired.length === 0) return null;

    const severity: 'warn' | 'danger' = fired.length >= 2 || fired.includes('slouch') && fired.includes('close')
      ? 'danger' : 'warn';
    const message = fired.map(c => CLASS_LABEL[c]).join('、');
    return { classes: fired, severity, message };
  }

  /** UI 用: 是否处于任意 alarm 类别 (供红色横幅显示) */
  isAnyAlarming(): boolean {
    return (Object.keys(this.states) as PostureClass[]).some(k => this.states[k].alarming);
  }

  /**
   * 某一类是否已经稳定持续超过判定阈值。
   * 用于最终体态输出，避免一帧抖动就把结果切到左右倾。
   */
  isClassStable(className: PostureClass, now = Date.now()): boolean {
    const state = this.states[className];
    return state.badSince !== null && (now - state.badSince) >= this.opts.classifyDwellMs;
  }

  /** 将当前持续成立的类别映射成稳定的中文结果。 */
  getStableLabels(now = Date.now()): PostureClass[] {
    return (Object.keys(this.states) as PostureClass[]).filter(k => this.isClassStable(k, now));
  }

  /** UI 用: 当前 alarming 的类别清单 */
  alarmingClasses(): PostureClass[] {
    return (Object.keys(this.states) as PostureClass[]).filter(k => this.states[k].alarming);
  }

  reset() {
    (Object.keys(this.states) as PostureClass[]).forEach(k => {
      this.states[k] = this.newClassState();
    });
  }
}
