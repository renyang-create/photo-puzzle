import { describe, expect, it } from "vitest";

import {
  DEFAULT_DIFFICULTY,
  DIFFICULTY_META,
  MIN_TOUCH_TARGET_PX,
  computeBoardSize,
  createShuffledOrder,
  formatDuration,
  formatMilliseconds,
  isSolved,
  isTouchTargetSafe,
  mulberry32,
  pieceBackgroundPosition,
  pieceBackgroundSize,
  pieceCount,
  shuffle,
  slotToGrid,
  solvedOrder,
  swapSlots,
  toDifficulty,
  touchTargetSize,
} from "@/lib/puzzle";

describe("打乱（Fisher-Yates）", () => {
  it("shuffle 不修改入参且保持元素集合不变", () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const snapshot = [...input];
    const output = shuffle(input);
    expect(input).toEqual(snapshot);
    expect([...output].sort((a, b) => a - b)).toEqual(snapshot);
  });

  it("同一个 seed 得到同一排列（可复现，便于测试与 OG 装饰网格）", () => {
    const a = shuffle(solvedOrder(4), mulberry32(42));
    const b = shuffle(solvedOrder(4), mulberry32(42));
    expect(a).toEqual(b);
  });

  it("createShuffledOrder 永远不返回「已完成」状态", () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const order = createShuffledOrder(3, mulberry32(seed));
      expect(isSolved(order)).toBe(false);
    }
  });

  it("createShuffledOrder 至少打乱 60% 的块，避免一开局就快拼完", () => {
    for (const difficulty of [3, 4, 5] as const) {
      const total = pieceCount(difficulty);
      for (let seed = 0; seed < 50; seed += 1) {
        const order = createShuffledOrder(difficulty, mulberry32(seed + 1000));
        const misplaced = order.filter((pieceId, slot) => pieceId !== slot).length;
        expect(misplaced).toBeGreaterThanOrEqual(Math.max(2, Math.floor(total * 0.6)));
      }
    }
  });

  it("即使随机源恒定（最坏情况）也保证不是已完成状态", () => {
    const order = createShuffledOrder(3, () => 0);
    expect(isSolved(order)).toBe(false);
    expect(order).toHaveLength(9);
  });
});

describe("完成判定与交换", () => {
  it("solvedOrder 是唯一解", () => {
    expect(isSolved(solvedOrder(3))).toBe(true);
    expect(isSolved([1, 0, 2, 3, 4, 5, 6, 7, 8])).toBe(false);
  });

  it("swapSlots 交换两块，非法索引原样返回", () => {
    expect(swapSlots([0, 1, 2], 0, 2)).toEqual([2, 1, 0]);
    expect(swapSlots([0, 1, 2], 1, 1)).toEqual([0, 1, 2]);
    expect(swapSlots([0, 1, 2], -1, 2)).toEqual([0, 1, 2]);
    expect(swapSlots([0, 1, 2], 0, 99)).toEqual([0, 1, 2]);
  });

  it("两次交换可以复原", () => {
    const start = createShuffledOrder(3, mulberry32(7));
    const swapped = swapSlots(start, 0, 4);
    expect(swapSlots(swapped, 0, 4)).toEqual(start);
  });

  it("data-index / data-slot 语义：order[slot] === slot 即完成", () => {
    const order = solvedOrder(3);
    const pairs = order.map((pieceId, slot) => ({ pieceId, slot }));
    expect(pairs.every(({ pieceId, slot }) => pieceId === slot)).toBe(true);
  });
});

describe("切片几何（DOM + background-position 方案）", () => {
  it("slotToGrid 按行优先映射", () => {
    expect(slotToGrid(0, 3)).toEqual({ row: 0, col: 0 });
    expect(slotToGrid(4, 3)).toEqual({ row: 1, col: 1 });
    expect(slotToGrid(8, 3)).toEqual({ row: 2, col: 2 });
  });

  it("background-size 是 n * 100% 的两个方向", () => {
    expect(pieceBackgroundSize(3)).toBe("300% 300%");
    expect(pieceBackgroundSize(5)).toBe("500% 500%");
  });

  it("background-position 角点正确（0% 与 100%），中间均分", () => {
    expect(pieceBackgroundPosition(0, 3)).toBe("0% 0%");
    expect(pieceBackgroundPosition(2, 3)).toBe("100% 0%");
    expect(pieceBackgroundPosition(6, 3)).toBe("0% 100%");
    expect(pieceBackgroundPosition(4, 3)).toBe("50% 50%");
  });
});

describe("移动端可用性约束", () => {
  it("默认难度是 3 或 4 档之一", () => {
    expect([3, 4]).toContain(DEFAULT_DIFFICULTY);
    expect(DIFFICULTY_META[DEFAULT_DIFFICULTY].pieces).toBe(
      pieceCount(DEFAULT_DIFFICULTY),
    );
  });

  it("iPhone 12 尺寸下 5×5 的单块仍不小于 44px", () => {
    const boardSize = computeBoardSize(390, 844);
    expect(touchTargetSize(boardSize, 5)).toBeGreaterThanOrEqual(
      MIN_TOUCH_TARGET_PX,
    );
    expect(isTouchTargetSafe(boardSize, 5)).toBe(true);
  });

  it("横屏窄高时棋盘仍然保持正方形且不被压扁", () => {
    const boardSize = computeBoardSize(844, 390);
    expect(boardSize).toBeLessThanOrEqual(844 * 0.94);
    expect(boardSize).toBeGreaterThan(0);
  });
});

describe("格式化", () => {
  it("formatDuration 小于一分钟只显示秒", () => {
    expect(formatDuration(9_400)).toBe("9.4s");
  });

  it("formatMilliseconds 始终 mm:ss", () => {
    expect(formatMilliseconds(65_000)).toBe("01:05");
    expect(formatMilliseconds(-5)).toBe("00:00");
  });

  it("toDifficulty 对脏输入回退到默认难度", () => {
    expect(toDifficulty("4")).toBe(4);
    expect(toDifficulty(5)).toBe(5);
    expect(toDifficulty("9")).toBe(DEFAULT_DIFFICULTY);
    expect(toDifficulty(null)).toBe(DEFAULT_DIFFICULTY);
  });
});
