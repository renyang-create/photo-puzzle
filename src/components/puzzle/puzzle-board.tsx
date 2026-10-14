"use client";

import { motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  MIN_TOUCH_TARGET_PX,
  createShuffledOrder,
  isSolved,
  pieceBackgroundPosition,
  pieceBackgroundSize,
  pieceCount,
  pieceSizePercent,
  slotToGrid,
  swapSlots,
  type Difficulty,
} from "@/lib/puzzle";

/**
 * 移动端拼图棋盘。
 *
 * 交互设计：
 *   - 主交互是「点击两块交换」，最贴合手指操作；
 *   - 拖拽是加分项，只用 Pointer Events 实现（HTML5 drag/drop 在移动端根本不可用）：
 *     所有块 touch-action: none，pointerdown 立刻 setPointerCapture，
 *     于是只有在拼图区域内才会阻断默认滚动，页面其他区域照常滚动。
 *   - 每块最小 44px 触控区：尺寸用 CSS 表达式直接兜底，不满足时会自动放大棋盘。
 *
 * 渲染方案：纯 DOM 切片。
 *   容器是正方形，每块 background-size: (n*100)% + background-position 定位，
 *   等价于 `object-fit: cover` 的正方形裁剪，绝不变形；
 *   位移用 transform(x, y) 交给合成层，移动端更稳。
 *
 * 完成判定：order[slot] === slot，即每块的 data-index === data-slot。
 * 打乱用 Fisher-Yates（见 lib/puzzle.ts），并保证初始不是已完成状态。
 *
 * 重开一局由父组件通过 `key` 触发重挂载，因此组件内部不需要「在 effect 里重置状态」。
 */

export interface PuzzleBoardProps {
  imageUrl: string;
  difficulty: Difficulty;
  onSolved: (elapsedMs: number) => void;
  onTick?: (elapsedMs: number) => void;
  paused?: boolean;
}

interface DragState {
  slot: number;
  dx: number;
  dy: number;
}

interface PointerState {
  slot: number;
  startX: number;
  startY: number;
  moved: boolean;
}

const SHUFFLE_DURATION_MS = 900;
const DRAG_THRESHOLD_PX = 8;

export function PuzzleBoard({
  imageUrl,
  difficulty,
  onSolved,
  onTick,
  paused = false,
}: PuzzleBoardProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<PointerState | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const solvedRef = useRef(false);

  const [order, setOrder] = useState<number[]>(() =>
    createShuffledOrder(difficulty),
  );
  const [phase, setPhase] = useState<"shuffling" | "playing" | "solved">(
    "shuffling",
  );
  const [boardSize, setBoardSize] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [peeking, setPeeking] = useState(false);

  const total = pieceCount(difficulty);

  /* ---------- 尺寸：CSS 负责正方形与最小触控区，ResizeObserver 只负责读回 px ---------- */
  useEffect(() => {
    const node = wrapperRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (typeof width === "number" && width > 0) {
        setBoardSize(Math.round(width));
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  /* ---------- 打乱动画结束后才开始计时 ---------- */
  useEffect(() => {
    const timer = window.setTimeout(() => {
      startedAtRef.current = performance.now();
      setPhase("playing");
    }, SHUFFLE_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, []);

  /* ---------- 计时器（100ms 刷新，setState 发生在回调里，不会造成级联渲染） ---------- */
  useEffect(() => {
    if (phase !== "playing" || paused) return;
    const interval = window.setInterval(() => {
      if (startedAtRef.current === null) return;
      onTick?.(performance.now() - startedAtRef.current);
    }, 100);
    return () => window.clearInterval(interval);
  }, [phase, paused, onTick]);

  const finish = useCallback(
    (elapsedMs: number) => {
      if (solvedRef.current) return;
      solvedRef.current = true;
      setPhase("solved");
      setSelected(null);
      onTick?.(elapsedMs);
      onSolved(elapsedMs);
    },
    [onSolved, onTick],
  );

  const commitOrder = useCallback(
    (next: number[]) => {
      setOrder(next);
      if (isSolved(next)) {
        const elapsed =
          startedAtRef.current === null
            ? 0
            : performance.now() - startedAtRef.current;
        // 留一点时间播「发光 + 缩放」，再弹解锁弹窗
        window.setTimeout(() => finish(elapsed), 620);
      }
    },
    [finish],
  );

  const swap = useCallback(
    (slotA: number, slotB: number) => {
      commitOrder(swapSlots(order, slotA, slotB));
    },
    [commitOrder, order],
  );

  const handleTap = useCallback(
    (slot: number) => {
      if (selected === null) {
        setSelected(slot);
        return;
      }
      if (selected === slot) {
        setSelected(null);
        return;
      }
      const target = selected;
      setSelected(null);
      swap(target, slot);
    },
    [selected, swap],
  );

  const slotFromPoint = useCallback(
    (clientX: number, clientY: number): number | null => {
      const node = boardRef.current;
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      const cell = rect.width / difficulty;
      const col = Math.floor((clientX - rect.left) / cell);
      const row = Math.floor((clientY - rect.top) / cell);
      if (col < 0 || row < 0 || col >= difficulty || row >= difficulty) return null;
      return row * difficulty + col;
    },
    [difficulty],
  );

  const interactive = phase === "playing" && !paused;

  // 正方形边长：既要放得下（94vw / 可视高度），也要保证单块 >= 44px
  const sizeExpression = `max(min(94vw, calc(100dvh - 280px), 520px), min(${difficulty * MIN_TOUCH_TARGET_PX}px, 98vw))`;
  const cellSize = boardSize > 0 ? boardSize / difficulty : 0;
  const piecePercent = pieceSizePercent(difficulty);

  return (
    <div className="flex w-full flex-col items-center gap-3">
      <div
        ref={wrapperRef}
        className="relative"
        style={{ width: sizeExpression, aspectRatio: "1 / 1" }}
      >
        <div
          ref={boardRef}
          className="relative size-full overflow-hidden rounded-2xl border border-white/10 bg-black/40 shadow-[0_0_60px_-20px_rgba(167,139,250,0.55)]"
          style={{ touchAction: "none" }}
          data-testid="puzzle-board"
          data-difficulty={difficulty}
          data-phase={phase}
        >
          {/* 偷看原图：只显示已经签发给本会话的缩略图，不涉及任何额外权限 */}
          {peeking && boardSize > 0 && (
            // eslint-disable-next-line @next/next/no-img-element -- 5 分钟签名的私有资源，next/image 优化器会缓存过期链接
            <img
              src={imageUrl}
              alt=""
              aria-hidden
              className="pointer-events-none absolute inset-0 size-full object-cover opacity-40"
              draggable={false}
            />
          )}

          {boardSize > 0 &&
            order.map((pieceId, slot) => {
              const { row, col } = slotToGrid(slot, difficulty);
              const baseX = col * cellSize;
              const baseY = row * cellSize;
              const isSelected = selected === slot;
              const isDragging = drag?.slot === slot;
              const solved = phase === "solved";

              return (
                <motion.button
                  // key 用 pieceId：交换时同一个 DOM 节点带着 transform 飞到新槽位
                  key={pieceId}
                  type="button"
                  data-index={pieceId}
                  data-slot={slot}
                  aria-label={`第 ${slot + 1} 格，图块 ${pieceId + 1}`}
                  aria-pressed={isSelected}
                  disabled={!interactive}
                  className="absolute top-0 left-0 border border-white/5 will-change-transform select-none"
                  style={{
                    width: cellSize,
                    height: cellSize,
                    backgroundImage: `url(${imageUrl})`,
                    backgroundSize: pieceBackgroundSize(difficulty),
                    backgroundPosition: pieceBackgroundPosition(pieceId, difficulty),
                    backgroundRepeat: "no-repeat",
                    touchAction: "none",
                    WebkitUserSelect: "none",
                    WebkitTouchCallout: "none",
                  }}
                  initial={{
                    x: boardSize / 2 - cellSize / 2,
                    y: boardSize / 2 - cellSize / 2,
                    scale: 0.15,
                    rotate: ((pieceId % 5) - 2) * 12,
                    opacity: 0,
                  }}
                  animate={{
                    x: isDragging && drag ? baseX + drag.dx : baseX,
                    y: isDragging && drag ? baseY + drag.dy : baseY,
                    scale: solved ? [1, 1.04, 1] : isSelected ? 0.93 : 1,
                    rotate: 0,
                    opacity: 1,
                    boxShadow: isSelected
                      ? "0 0 0 2px rgba(167,139,250,0.95), 0 0 24px rgba(167,139,250,0.55)"
                      : solved
                        ? "0 0 24px rgba(167,139,250,0.45)"
                        : "0 0 0 0 rgba(0,0,0,0)",
                    zIndex: isDragging ? 30 : isSelected ? 20 : 1,
                  }}
                  transition={{
                    type: "spring",
                    stiffness: 420,
                    damping: 32,
                    delay: phase === "shuffling" ? (slot % difficulty) * 0.035 : 0,
                    scale: solved ? { duration: 0.5, ease: "easeInOut" } : undefined,
                  }}
                  onPointerDown={(event) => {
                    if (!interactive) return;
                    event.currentTarget.setPointerCapture(event.pointerId);
                    pointerRef.current = {
                      slot,
                      startX: event.clientX,
                      startY: event.clientY,
                      moved: false,
                    };
                  }}
                  onPointerMove={(event) => {
                    const state = pointerRef.current;
                    if (!state || state.slot !== slot || !interactive) return;
                    const dx = event.clientX - state.startX;
                    const dy = event.clientY - state.startY;
                    if (!state.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
                      state.moved = true;
                    }
                    if (state.moved) setDrag({ slot, dx, dy });
                  }}
                  onPointerUp={(event) => {
                    const state = pointerRef.current;
                    pointerRef.current = null;
                    setDrag(null);
                    if (!state || state.slot !== slot) return;
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                      event.currentTarget.releasePointerCapture(event.pointerId);
                    }
                    if (!state.moved) {
                      handleTap(slot);
                      return;
                    }
                    const target = slotFromPoint(event.clientX, event.clientY);
                    if (target !== null && target !== slot) swap(slot, target);
                  }}
                  onPointerCancel={() => {
                    pointerRef.current = null;
                    setDrag(null);
                  }}
                  onContextMenu={(event) => event.preventDefault()}
                />
              );
            })}

          {/* 槽位参考线：几乎不可见，但能帮玩家判断格子边界 */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(to right, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.06) 1px, transparent 1px)",
              backgroundSize: `${piecePercent}% ${piecePercent}%`,
            }}
          />
        </div>
      </div>

      <div className="text-muted-foreground flex items-center gap-3 text-xs">
        <button
          type="button"
          className="underline decoration-dotted underline-offset-4"
          onPointerDown={(event) => {
            event.stopPropagation();
            setPeeking(true);
          }}
          onPointerUp={() => setPeeking(false)}
          onPointerLeave={() => setPeeking(false)}
          onPointerCancel={() => setPeeking(false)}
        >
          按住看原图
        </button>
        <span>
          {total} 块
          {boardSize > 0 ? ` · 单块 ${Math.round(cellSize)}px` : ""}
          {boardSize > 0 && cellSize < MIN_TOUCH_TARGET_PX
            ? "（偏小，建议换小难度）"
            : ""}
        </span>
      </div>
    </div>
  );
}
