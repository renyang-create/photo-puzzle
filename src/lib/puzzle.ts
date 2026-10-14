/**
 * 拼图核心纯逻辑（无 DOM 依赖，可在 Node 中直接单测）
 *
 * 来源与改动说明：
 *   - 打乱算法 Fisher-Yates 参考 usecodelee/Vue-auto-Puzzle（MIT）中的 shuffle 实现，
 *     改为纯函数 + 可注入随机源（便于测试与「保证不是已完成状态」的约束）。
 *   - 胜利判定 / 槽位映射为本次重写：数据结构由「二维数组」改为「一维 order 数组」，
 *     使 React 侧可以用 transform 动画复用同一份状态。
 */

export const DIFFICULTIES = [3, 4, 5] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const DEFAULT_DIFFICULTY: Difficulty = 3;

/** 移动端最小可点区域（WCAG 2.2 / Apple HIG 建议 44px） */
export const MIN_TOUCH_TARGET_PX = 44;

export const DIFFICULTY_META: Record<
  Difficulty,
  { label: string; sub: string; pieces: number }
> = {
  3: { label: "3 × 3", sub: "轻松热身", pieces: 9 },
  4: { label: "4 × 4", sub: "标准难度", pieces: 16 },
  5: { label: "5 × 5", sub: "硬核挑战", pieces: 25 },
};

export type RandomSource = () => number;

export function isDifficulty(value: unknown): value is Difficulty {
  return (
    typeof value === "number" &&
    (DIFFICULTIES as readonly number[]).includes(value)
  );
}

export function toDifficulty(value: unknown): Difficulty {
  const parsed =
    typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  return isDifficulty(parsed) ? parsed : DEFAULT_DIFFICULTY;
}

export function pieceCount(difficulty: Difficulty): number {
  return difficulty * difficulty;
}

/** 确定性随机源：同一个 seed 必然得到同一排列（测试与 OG 装饰网格都用它） */
export function mulberry32(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates，返回新数组，不修改入参 */
export function shuffle<T>(
  input: readonly T[],
  random: RandomSource = Math.random,
): T[] {
  const result = [...input];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const tmp = result[i];
    result[i] = result[j];
    result[j] = tmp;
  }
  return result;
}

/** order[slot] = pieceId（第 slot 个格子放的是第几号拼图块） */
export function solvedOrder(difficulty: Difficulty): number[] {
  return Array.from({ length: pieceCount(difficulty) }, (_, index) => index);
}

export function isSolved(order: readonly number[]): boolean {
  return order.every((pieceId, slot) => pieceId === slot);
}

/**
 * 生成打乱后的 order，并保证：
 *   1. 不是已完成状态
 *   2. 不出现「只差两块」这种一开始就结束的情况（至少 60% 的块不在原位）
 */
export function createShuffledOrder(
  difficulty: Difficulty,
  random: RandomSource = Math.random,
): number[] {
  const base = solvedOrder(difficulty);
  const total = base.length;
  const minMisplaced = Math.max(2, Math.floor(total * 0.6));

  for (let attempt = 0; attempt < 32; attempt += 1) {
    const candidate = shuffle(base, random);
    if (isSolved(candidate)) continue;
    const misplaced = candidate.reduce(
      (acc, pieceId, slot) => (pieceId === slot ? acc : acc + 1),
      0,
    );
    if (misplaced >= minMisplaced) return candidate;
  }

  // 极端兜底：交换前两块，确保永远不会返回「已完成」
  const fallback = shuffle(base, random);
  [fallback[0], fallback[1]] = [fallback[1], fallback[0]];
  return fallback;
}

/** 点击两块交换：返回新 order */
export function swapSlots(
  order: readonly number[],
  slotA: number,
  slotB: number,
): number[] {
  if (slotA === slotB) return [...order];
  if (
    slotA < 0 ||
    slotB < 0 ||
    slotA >= order.length ||
    slotB >= order.length
  ) {
    return [...order];
  }
  const next = [...order];
  const tmp = next[slotA];
  next[slotA] = next[slotB];
  next[slotB] = tmp;
  return next;
}

export function slotToGrid(slot: number, difficulty: Difficulty) {
  return {
    row: Math.floor(slot / difficulty),
    col: slot % difficulty,
  };
}

/** 每块占容器的百分比尺寸 */
export function pieceSizePercent(difficulty: Difficulty): number {
  return 100 / difficulty;
}

/**
 * DOM 切片方案：用 background-size: (n*100)% 把原图放大 n 倍，
 * 再用 background-position 定位到对应格子；配合容器 aspect-ratio: 1/1 + cover，
 * 正方形裁剪、绝不变形。
 */
export function pieceBackgroundSize(difficulty: Difficulty): string {
  return `${difficulty * 100}% ${difficulty * 100}%`;
}

export function pieceBackgroundPosition(
  pieceId: number,
  difficulty: Difficulty,
): string {
  const { row, col } = slotToGrid(pieceId, difficulty);
  // 只有一块时没有「其他位置」可分，直接给 0
  const divisor = difficulty > 1 ? difficulty - 1 : 1;
  const step = 100 / divisor;
  return `${col * step}% ${row * step}%`;
}

/** 棋盘边长 = min(容器宽, 可用高度)，保证在手机上不被压扁 */
export function computeBoardSize(
  viewportWidth: number,
  viewportHeight: number,
  headerReserve = 210,
): number {
  const widthLimit = viewportWidth * 0.94;
  const heightLimit = Math.max(220, viewportHeight - headerReserve);
  return Math.round(Math.min(widthLimit, heightLimit));
}

export function touchTargetSize(
  boardSize: number,
  difficulty: Difficulty,
): number {
  return boardSize / difficulty;
}

export function isTouchTargetSafe(
  boardSize: number,
  difficulty: Difficulty,
): boolean {
  return touchTargetSize(boardSize, difficulty) >= MIN_TOUCH_TARGET_PX;
}

export function formatDuration(ms: number): string {
  const safe = Math.max(0, Math.floor(ms));
  const totalSeconds = Math.floor(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const centis = Math.floor((safe % 1000) / 100);
  if (minutes === 0) return `${seconds}.${centis}s`;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatMilliseconds(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
