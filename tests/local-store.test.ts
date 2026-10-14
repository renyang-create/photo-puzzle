import { describe, expect, it } from "vitest";

import {
  STORAGE_KEYS,
  applyUnlock,
  createInitialProgress,
  sanitizeProgress,
  withDifficulty,
} from "@/lib/local-store";

describe("localStorage key 契约", () => {
  it("key 与文档/验收一致（改名属于破坏性变更）", () => {
    expect(STORAGE_KEYS).toEqual({
      deviceId: "photoPuzzle.deviceId",
      unlocked: "photoPuzzle.unlocked",
      bestTimes: "photoPuzzle.bestTimes",
      total: "photoPuzzle.total",
      lastDifficulty: "photoPuzzle.lastDifficulty",
      soundEnabled: "photoPuzzle.soundEnabled",
    });
  });
});

describe("applyUnlock", () => {
  it("首次解锁：加入相册、记录最佳成绩、累计次数 +1", () => {
    const start = createInitialProgress("device-1");
    const { next, isNewRecord, unlockedNow } = applyUnlock(start, {
      photoId: "photo-a",
      timeMs: 12_345,
      difficulty: 3,
    });

    expect(unlockedNow).toBe(true);
    expect(isNewRecord).toBe(true);
    expect(next.unlocked).toEqual(["photo-a"]);
    expect(next.bestTimes["photo-a"]).toEqual({ 3: 12_345 });
    expect(next.total).toBe(1);
    expect(next.lastDifficulty).toBe(3);
    // 不可变：原对象不被修改
    expect(start.unlocked).toEqual([]);
  });

  it("同一张照片换难度：保留两个难度的最佳成绩，不重复计入相册", () => {
    const first = applyUnlock(createInitialProgress("d"), {
      photoId: "photo-a",
      timeMs: 20_000,
      difficulty: 3,
    }).next;
    const { next, unlockedNow } = applyUnlock(first, {
      photoId: "photo-a",
      timeMs: 40_000,
      difficulty: 5,
    });

    expect(unlockedNow).toBe(false);
    expect(next.unlocked).toEqual(["photo-a"]);
    expect(next.bestTimes["photo-a"]).toEqual({ 3: 20_000, 5: 40_000 });
  });

  it("更慢的成绩不会覆盖最佳成绩", () => {
    const first = applyUnlock(createInitialProgress("d"), {
      photoId: "photo-a",
      timeMs: 10_000,
      difficulty: 4,
    }).next;
    const { next, isNewRecord } = applyUnlock(first, {
      photoId: "photo-a",
      timeMs: 30_000,
      difficulty: 4,
    });

    expect(isNewRecord).toBe(false);
    expect(next.bestTimes["photo-a"]?.[4]).toBe(10_000);
  });
});

describe("sanitizeProgress（localStorage 不可信）", () => {
  it("脏数据被收敛成合法结构", () => {
    const result = sanitizeProgress(
      {
        unlocked: ["a", "a", 123, null, ""],
        bestTimes: {
          a: { 3: "5000", 4: -1, 9: 100 },
          b: "not-an-object",
        },
        total: "abc",
        lastDifficulty: "9",
      },
      "device-x",
    );

    expect(result.deviceId).toBe("device-x");
    expect(result.unlocked).toEqual(["a"]);
    expect(result.bestTimes).toEqual({ a: { 3: 5000 } });
    expect(result.total).toBe(0);
    expect(result.lastDifficulty).toBe(3);
  });

  it("null / 字符串 / 数组都能安全降级", () => {
    expect(sanitizeProgress(null, "d").unlocked).toEqual([]);
    expect(sanitizeProgress("oops", "d").unlocked).toEqual([]);
    expect(sanitizeProgress([], "d").unlocked).toEqual([]);
  });

  it("解析后的状态再写回是幂等的", () => {
    const once = sanitizeProgress({ unlocked: ["a"], total: 3 }, "d");
    const twice = sanitizeProgress(JSON.parse(JSON.stringify(once)), "d");
    expect(twice).toEqual(once);
  });
});

describe("withDifficulty", () => {
  it("只改 lastDifficulty", () => {
    const start = createInitialProgress("d");
    const next = withDifficulty(start, 5);
    expect(next.lastDifficulty).toBe(5);
    expect(next.unlocked).toEqual([]);
  });
});
