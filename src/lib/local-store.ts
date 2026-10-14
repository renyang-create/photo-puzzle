import { DEFAULT_DIFFICULTY, toDifficulty, type Difficulty } from "./puzzle";

/**
 * localStorage 统一 key 表（对外契约，勿随性改名）
 * 说明：这些数据只用于「本机体验」——设备维度不是可信身份，
 *     服务端的解锁统计以 httpOnly 匿名 session cookie 里的 sid 为准。
 * 严禁往 localStorage 里塞图片 base64、access token、密码。
 */
export const STORAGE_KEYS = {
  deviceId: "photoPuzzle.deviceId",
  unlocked: "photoPuzzle.unlocked",
  bestTimes: "photoPuzzle.bestTimes",
  total: "photoPuzzle.total",
  lastDifficulty: "photoPuzzle.lastDifficulty",
  /** 声音开关（右上角喇叭），默认开 */
  soundEnabled: "photoPuzzle.soundEnabled",
} as const;

export type BestTimes = Record<string, Partial<Record<Difficulty, number>>>;

export interface LocalProgress {
  deviceId: string;
  unlocked: string[];
  bestTimes: BestTimes;
  total: number;
  lastDifficulty: Difficulty;
}

export function createInitialProgress(deviceId: string): LocalProgress {
  return {
    deviceId,
    unlocked: [],
    bestTimes: {},
    total: 0,
    lastDifficulty: DEFAULT_DIFFICULTY,
  };
}

/** 把不可信的 localStorage 内容收敛成合法结构（脏数据不能让页面崩） */
export function sanitizeProgress(raw: unknown, deviceId: string): LocalProgress {
  const base = createInitialProgress(deviceId);
  if (!raw || typeof raw !== "object") return base;
  const input = raw as Partial<Record<keyof LocalProgress, unknown>>;

  const unlocked = Array.isArray(input.unlocked)
    ? Array.from(
        new Set(
          input.unlocked.filter(
            (item): item is string => typeof item === "string" && item.length > 0,
          ),
        ),
      )
    : [];

  const bestTimes: BestTimes = {};
  if (input.bestTimes && typeof input.bestTimes === "object") {
    for (const [photoId, times] of Object.entries(
      input.bestTimes as Record<string, unknown>,
    )) {
      if (!times || typeof times !== "object") continue;
      const entry: Partial<Record<Difficulty, number>> = {};
      for (const [difficulty, value] of Object.entries(
        times as Record<string, unknown>,
      )) {
        const parsed = Number(value);
        if (
          Number.isFinite(parsed) &&
          parsed > 0 &&
          [3, 4, 5].includes(Number(difficulty))
        ) {
          entry[Number(difficulty) as Difficulty] = Math.round(parsed);
        }
      }
      if (Object.keys(entry).length > 0) bestTimes[photoId] = entry;
    }
  }

  const total = Number(input.total);

  return {
    deviceId,
    unlocked,
    bestTimes,
    total: Number.isFinite(total) && total > 0 ? Math.floor(total) : 0,
    lastDifficulty: toDifficulty(input.lastDifficulty),
  };
}

export interface UnlockOutcome {
  next: LocalProgress;
  isNewRecord: boolean;
  unlockedNow: boolean;
}

/** 纯函数：记录一次解锁，返回新状态（可在 Node 中直接单测） */
export function applyUnlock(
  progress: LocalProgress,
  payload: { photoId: string; timeMs: number; difficulty: Difficulty },
): UnlockOutcome {
  const { photoId, timeMs, difficulty } = payload;
  const safeTime = Math.max(1, Math.round(timeMs));
  const previousBest = progress.bestTimes[photoId]?.[difficulty];
  const isNewRecord = previousBest === undefined || safeTime < previousBest;
  const unlockedNow = !progress.unlocked.includes(photoId);

  const next: LocalProgress = {
    ...progress,
    unlocked: unlockedNow
      ? [...progress.unlocked, photoId]
      : progress.unlocked,
    bestTimes: {
      ...progress.bestTimes,
      [photoId]: {
        ...progress.bestTimes[photoId],
        [difficulty]: isNewRecord ? safeTime : previousBest,
      },
    },
    total: progress.total + 1,
    lastDifficulty: difficulty,
  };

  return { next, isNewRecord, unlockedNow };
}

export function withDifficulty(
  progress: LocalProgress,
  difficulty: Difficulty,
): LocalProgress {
  return { ...progress, lastDifficulty: difficulty };
}

/* ------------------------------------------------------------------ */
/* 浏览器侧读写（服务端渲染时全部 no-op，避免 hydration 报错）          */
/* ------------------------------------------------------------------ */

function safeStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getOrCreateDeviceId(): string {
  const storage = safeStorage();
  if (!storage) return "server";
  const existing = storage.getItem(STORAGE_KEYS.deviceId);
  if (existing && existing.length > 0) return existing;
  const created =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  storage.setItem(STORAGE_KEYS.deviceId, created);
  return created;
}

export function readProgress(): LocalProgress {
  const storage = safeStorage();
  if (!storage) return createInitialProgress("server");
  const deviceId = getOrCreateDeviceId();
  try {
    return sanitizeProgress(
      JSON.parse(storage.getItem(STORAGE_KEYS.unlocked) ?? "null"),
      deviceId,
    );
  } catch {
    return createInitialProgress(deviceId);
  }
}

export function writeProgress(progress: LocalProgress): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEYS.deviceId, progress.deviceId);
    storage.setItem(STORAGE_KEYS.unlocked, JSON.stringify(progress.unlocked));
    storage.setItem(STORAGE_KEYS.bestTimes, JSON.stringify(progress.bestTimes));
    storage.setItem(STORAGE_KEYS.total, String(progress.total));
    storage.setItem(
      STORAGE_KEYS.lastDifficulty,
      String(progress.lastDifficulty),
    );
    emitProgressChange();
  } catch {
    /* 隐私模式下写入失败可以忽略：服务端 unlocks 表才是统计口径 */
  }
}

/* ------------------------------------------------------------------ */
/* useSyncExternalStore 适配层                                          */
/*                                                                     */
/* 为什么不用「在 useEffect 里 setState」：React 19 的 lint 规则          */
/* （react-hooks/set-state-in-effect）会直接报错，而且那样确实会造成      */
/* 级联渲染。localStorage 属于外部数据源，用 useSyncExternalStore 才是   */
/* 语义正确的做法，还能让封面统计、拼图页、相册页自动保持同步。            */
/* ------------------------------------------------------------------ */

const listeners = new Set<() => void>();
let cachedSnapshot: string | null = null;

export function subscribeProgress(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  // 订阅发生在挂载之后，这时才第一次写 deviceId，避免渲染期产生副作用
  getOrCreateDeviceId();
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

/** 返回稳定的字符串快照：useSyncExternalStore 要求引用稳定，否则会无限重渲染 */
export function getProgressSnapshot(): string | null {
  if (typeof window === "undefined") return null;
  const json = JSON.stringify(readProgress());
  if (json !== cachedSnapshot) cachedSnapshot = json;
  return cachedSnapshot;
}

/** 服务端渲染阶段没有 localStorage，返回 null 由组件降级处理 */
export function getServerProgressSnapshot(): null {
  return null;
}

export function parseProgressSnapshot(snapshot: string | null): LocalProgress | null {
  if (!snapshot) return null;
  try {
    return sanitizeProgress(JSON.parse(snapshot), getOrCreateDeviceId());
  } catch {
    return null;
  }
}

function emitProgressChange(): void {
  cachedSnapshot = null;
  listeners.forEach((listener) => listener());
}

/* ------------------------------------------------------------------ */
/* 声音开关（右上角喇叭）                                                */
/* 复用同一套订阅机制，所以拼图页与任何其他组件读到的是同一份状态。        */
/* ------------------------------------------------------------------ */

let cachedSoundSnapshot: string | null = null;

/** 纯函数：localStorage 里读到的原始值 → 布尔（缺省视为开启） */
export function resolveSoundEnabled(raw: unknown): boolean {
  if (raw === null || raw === undefined || raw === "") return true;
  return raw !== "0" && raw !== "false";
}

export function readSoundEnabled(): boolean {
  const storage = safeStorage();
  if (!storage) return true;
  return resolveSoundEnabled(storage.getItem(STORAGE_KEYS.soundEnabled));
}

export function writeSoundEnabled(enabled: boolean): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEYS.soundEnabled, enabled ? "1" : "0");
    cachedSoundSnapshot = null;
    listeners.forEach((listener) => listener());
  } catch {
    /* 隐私模式下忽略 */
  }
}

export function subscribeSound(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

export function getSoundSnapshot(): string | null {
  if (typeof window === "undefined") return null;
  const value = readSoundEnabled() ? "1" : "0";
  if (value !== cachedSoundSnapshot) cachedSoundSnapshot = value;
  return cachedSoundSnapshot;
}

export function getServerSoundSnapshot(): null {
  return null;
}

export function parseSoundSnapshot(snapshot: string | null): boolean {
  if (snapshot === null) return true;
  return snapshot === "1";
}

export function clearProgress(): void {
  const storage = safeStorage();
  if (!storage) return;
  Object.values(STORAGE_KEYS).forEach((key) => storage.removeItem(key));
}
