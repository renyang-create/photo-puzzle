"use client";

/**
 * 音频管理：背景音乐（循环）+ 音效（按住 / 松开 / 完成）+ 音效期间自动压低 BGM。
 *
 * 设计要点：
 *   1. 纯逻辑（音量计算、淡入淡出、开关状态解析）与浏览器副作用分开，前者可直接单测；
 *   2. 全部资源都在 public/audio/ 下，用相对路径引用，不依赖任何第三方 CDN；
 *   3. 浏览器**禁止无交互自动播放**，所以策略是：
 *      进入游戏时先尝试 play()，被拒绝就挂一次性 pointerdown/keydown 监听，等用户第一次碰屏幕再起播；
 *   4. 音效用「对象池」复用播放，避免连续按下时互相打断；
 *   5. 播音效时把 BGM 快速压到 DUCKED_BGM_VOLUME，音效结束后 200ms 平滑恢复到 DEFAULT_BGM_VOLUME。
 */

export const AUDIO_SOURCES = {
  /** 背景音乐（循环） */
  bgm: "/audio/bgm.mp3",
  /** 按住 / 松开拼图块的泡泡音 */
  press: "/audio/bubble-pop.mp3",
  /** 拼图完成时的「叮」 */
  complete: "/audio/ding.mp3",
} as const;

export type SfxName = "press" | "complete";

export const DEFAULT_BGM_VOLUME = 0.35;
export const DUCKED_BGM_VOLUME = 0.12;
/** 压低用的极短过渡（听感上是「立刻让位」） */
export const DUCK_FADE_MS = 60;
/** 恢复用的过渡，200ms 内平滑回到原音量 */
export const RESTORE_FADE_MS = 200;
/** 单次音效压低的保持时长 */
export const SFX_DUCK_MS = 700;
/** 完成音更长一点，避免「叮」还没结束音乐就冲上来 */
export const COMPLETE_DUCK_MS = 1600;
/** 每种音效的并发对象池大小 */
export const SFX_POOL_SIZE = 3;
const FADE_STEP_MS = 30;

/** 纯函数：当前 BGM 应该处于什么音量（0 表示静音） */
export function bgmVolumeFor(options: {
  ducked: boolean;
  enabled: boolean;
}): number {
  if (!options.enabled) return 0;
  return options.ducked ? DUCKED_BGM_VOLUME : DEFAULT_BGM_VOLUME;
}

/** 纯函数：线性插值淡入淡出（progress 会被夹到 0..1） */
export function fadeVolume(from: number, to: number, progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  return Number((from + (to - from) * p).toFixed(3));
}

/** 纯函数：音效结束后需要恢复到的音量（关闭时就是 0） */
export function volumeAfterDuck(enabled: boolean): number {
  return bgmVolumeFor({ ducked: false, enabled });
}

class AudioManager {
  private enabled = true;
  private inGame = false;
  private bgm: HTMLAudioElement | null = null;
  private ducked = false;
  private duckTimer: ReturnType<typeof setTimeout> | null = null;
  private fadeTimer: ReturnType<typeof setInterval> | null = null;
  private currentVolume = DEFAULT_BGM_VOLUME;
  private sfxPools = new Map<SfxName, HTMLAudioElement[]>();
  private sfxCursor = new Map<SfxName, number>();
  private unlockHandler: (() => void) | null = null;

  /* ---------------- 开关 ---------------- */

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;

    if (!enabled) {
      this.ducked = false;
      this.clearDuckTimer();
      this.clearFadeTimer();
      if (this.bgm) {
        this.bgm.pause();
        this.bgm.volume = 0;
      }
      return;
    }

    this.currentVolume = DEFAULT_BGM_VOLUME;
    if (this.inGame) this.tryStart();
  }

  /* ---------------- 进入 / 离开游戏 ---------------- */

  enterGame(): void {
    this.inGame = true;
    this.tryStart();
  }

  exitGame(): void {
    this.inGame = false;
    this.ducked = false;
    this.clearDuckTimer();
    this.clearFadeTimer();
    this.detachUnlockHandler();
    if (this.bgm) {
      this.bgm.pause();
      this.bgm.currentTime = 0;
    }
  }

  /** 返回是否成功起播（被浏览器拦截时返回 false） */
  private tryStart(): boolean {
    if (!this.enabled || !this.inGame || typeof window === "undefined") {
      return false;
    }

    const element = this.ensureBgm();
    element.volume = bgmVolumeFor({ ducked: false, enabled: true });
    this.currentVolume = element.volume;

    const result = element.play();
    if (result && typeof result.then === "function") {
      result
        .then(() => this.detachUnlockHandler())
        .catch(() => this.attachUnlockHandler());
    }
    return true;
  }

  /* ---------------- 音效 ---------------- */

  playSfx(name: SfxName): void {
    if (!this.enabled || typeof window === "undefined") return;

    const pool = this.ensureSfxPool(name);
    const index = (this.sfxCursor.get(name) ?? 0) % pool.length;
    this.sfxCursor.set(name, index + 1);

    const element = pool[index];
    if (!element) return;

    try {
      element.currentTime = 0;
      const result = element.play();
      if (result && typeof result.catch === "function") {
        result.catch(() => {
          /* 浏览器还没解锁音频：忽略这一次 */
        });
      }
    } catch {
      /* 个别浏览器在 currentTime 未就绪时会抛错，忽略 */
    }

    this.duck(name === "complete" ? COMPLETE_DUCK_MS : SFX_DUCK_MS);
  }

  playPress(): void {
    this.playSfx("press");
  }

  playRelease(): void {
    this.playSfx("press");
  }

  playComplete(): void {
    this.playSfx("complete");
  }

  /* ---------------- 压低 / 恢复 ---------------- */

  private duck(durationMs: number): void {
    if (!this.bgm || !this.enabled) return;

    this.ducked = true;
    this.fadeTo(DUCKED_BGM_VOLUME, DUCK_FADE_MS);

    this.clearDuckTimer();
    this.duckTimer = setTimeout(() => {
      this.ducked = false;
      if (this.enabled) this.fadeTo(volumeAfterDuck(true), RESTORE_FADE_MS);
    }, durationMs);
  }

  private fadeTo(target: number, durationMs: number): void {
    const element = this.bgm;
    if (!element) return;

    this.clearFadeTimer();
    if (durationMs <= 0) {
      element.volume = target;
      this.currentVolume = target;
      return;
    }

    const from = element.volume;
    const startedAt = Date.now();
    this.fadeTimer = setInterval(() => {
      const progress = (Date.now() - startedAt) / durationMs;
      const next = fadeVolume(from, target, progress);
      element.volume = next;
      this.currentVolume = next;
      if (progress >= 1) {
        element.volume = target;
        this.currentVolume = target;
        this.clearFadeTimer();
      }
    }, FADE_STEP_MS);
  }

  /* ---------------- 资源懒加载 ---------------- */

  private ensureBgm(): HTMLAudioElement {
    if (this.bgm) return this.bgm;
    const element = new Audio(AUDIO_SOURCES.bgm);
    element.loop = true;
    element.preload = "auto";
    element.volume = DEFAULT_BGM_VOLUME;
    this.bgm = element;
    return element;
  }

  private ensureSfxPool(name: SfxName): HTMLAudioElement[] {
    const cached = this.sfxPools.get(name);
    if (cached) return cached;

    const pool = Array.from({ length: SFX_POOL_SIZE }, () => {
      const element = new Audio(AUDIO_SOURCES[name]);
      element.preload = "auto";
      element.volume = 1;
      return element;
    });
    this.sfxPools.set(name, pool);
    this.sfxCursor.set(name, 0);
    return pool;
  }

  /* ---------------- 自动播放解锁 ---------------- */

  private attachUnlockHandler(): void {
    if (this.unlockHandler || typeof window === "undefined") return;

    const handler = () => {
      this.detachUnlockHandler();
      this.tryStart();
    };
    this.unlockHandler = handler;
    // 只在「用户第一次交互」时补一次起播，不去打断页面其它手势
    window.addEventListener("pointerdown", handler, { once: true, passive: true });
    window.addEventListener("keydown", handler, { once: true, passive: true });
  }

  private detachUnlockHandler(): void {
    if (!this.unlockHandler || typeof window === "undefined") return;
    window.removeEventListener("pointerdown", this.unlockHandler);
    window.removeEventListener("keydown", this.unlockHandler);
    this.unlockHandler = null;
  }

  private clearDuckTimer(): void {
    if (this.duckTimer) {
      clearTimeout(this.duckTimer);
      this.duckTimer = null;
    }
  }

  private clearFadeTimer(): void {
    if (this.fadeTimer) {
      clearInterval(this.fadeTimer);
      this.fadeTimer = null;
    }
  }
}

/** 单例：整个应用共享同一个 BGM 实例，避免路由切换时叠音 */
export const audio = new AudioManager();

export function isAudioAvailable(): boolean {
  return typeof window !== "undefined" && typeof Audio !== "undefined";
}
