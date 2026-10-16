import { describe, expect, it } from "vitest";

import { TEETH_DEPTH_PX, edgeTabOut, pieceEdges } from "@/lib/jigsaw";

/**
 * 锯齿几何的核心不变量。
 *
 * 这些断言把 Demo 里那套「逐块读 canvas 像素」的自检固化成单测：
 * 只要有人在以后改哈希或改凹凸推导，这里立刻会红。
 */
describe("jigsaw 锯齿几何", () => {
  it("凹凸深度固定 12px（换难度 / 换屏宽都不变）", () => {
    expect(TEETH_DEPTH_PX).toBe(12);
  });

  it("同一条边对相邻两块必须一个凸起、一个凹槽", () => {
    for (let size = 3; size <= 5; size++) {
      for (let row = 0; row < size; row++) {
        for (let col = 0; col < size; col++) {
          const self = pieceEdges(row, col, size);

          if (row + 1 < size) {
            const below = pieceEdges(row + 1, col, size);
            expect([self.bottom, below.top].sort()).toEqual(["hole", "tab"]);
          }
          if (col + 1 < size) {
            const right = pieceEdges(row, col + 1, size);
            expect([self.right, right.left].sort()).toEqual(["hole", "tab"]);
          }
        }
      }
    }
  });

  it("棋盘最外圈必须是平直边（保证外轮廓是完整矩形）", () => {
    for (let size = 3; size <= 5; size++) {
      for (let i = 0; i < size; i++) {
        expect(pieceEdges(0, i, size).top).toBe("line");
        expect(pieceEdges(size - 1, i, size).bottom).toBe("line");
        expect(pieceEdges(i, 0, size).left).toBe("line");
        expect(pieceEdges(i, size - 1, size).right).toBe("line");
      }
    }
  });

  it("内部边不允许出现平直（那是拼图最外圈才有的形态）", () => {
    for (let size = 3; size <= 5; size++) {
      for (let row = 0; row < size; row++) {
        for (let col = 0; col < size; col++) {
          const edges = pieceEdges(row, col, size);
          if (row > 0) expect(edges.top).not.toBe("line");
          if (row < size - 1) expect(edges.bottom).not.toBe("line");
          if (col > 0) expect(edges.left).not.toBe("line");
          if (col < size - 1) expect(edges.right).not.toBe("line");
        }
      }
    }
  });

  it("同一坐标多次推导结果稳定（哈希是纯函数）", () => {
    for (let i = 0; i < 50; i++) {
      expect(edgeTabOut("h", i % 5, i % 3)).toBe(edgeTabOut("h", i % 5, i % 3));
    }
  });

  it("凹凸分布大致均匀（不会出现整片同向导致全是一边凸）", () => {
    let tabs = 0;
    let total = 0;
    for (let size = 3; size <= 5; size++) {
      for (let row = 0; row < size; row++) {
        for (let col = 0; col < size; col++) {
          const edges = pieceEdges(row, col, size);
          for (const mode of [edges.top, edges.right, edges.bottom, edges.left]) {
            if (mode === "line") continue;
            total++;
            if (mode === "tab") tabs++;
          }
        }
      }
    }
    const ratio = tabs / total;
    expect(ratio).toBeGreaterThan(0.3);
    expect(ratio).toBeLessThan(0.7);
  });
});
