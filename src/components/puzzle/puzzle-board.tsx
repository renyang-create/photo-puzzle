"use client";

import { motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";

import { audio } from "@/lib/audio";
import { TEETH_DEPTH_PX, drawPieceToCanvas } from "@/lib/jigsaw";
import {
  MIN_TOUCH_TARGET_PX,
  createShuffledOrder,
  isSolved,
  pieceCount,
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
 * 渲染方案：Canvas + Path2D + clip（等价 clipPath）。
 *   每块是一个与格子等大的按钮（命中区），里面叠一张比格子大 2×12px 的 canvas：
 *   先在 canvas 上画出「单元格 + 锯齿凸起/凹槽」的闭合轮廓，ctx.clip() 后贴图片切片，
 *   再沿轮廓向内侵蚀 1px —— 相邻两块之间就留下恒定 2px 的黑色缝隙（不给碎片描边）。
 *   位移仍然用 transform(x, y) 交给合成层，所以移动端依旧顺滑。
 *   锯齿几何与互补保证见 lib/jigsaw.ts。
 *
 * 完成判定：order[slot] === slot，即每块的 data-index === data-slot。
 * 打乱用 Fisher-Yates（见 lib/puzzle.ts），并保证初始不是已完成状态。
 *
 * 重开一局由父组件通过 `key` 触发重挂载，因此组件内部不需要「在 effect 里重置状态」。
 *
 * 外观：复刻 2008 老 Flash 拼图 —— 直角碎片、2px 黑色缝隙、#000 底板；
 * 全局玻璃反光只做一层独立 overlay（不是碎片自带高光）。
 * 层叠顺序严格为：普通碎片(1) < 玻璃高光层(500) < 拿起中的碎片(999)，
 * 因此「拿起」的碎片会自动越过高光层，既不用改碎片样式，也不用挪动 DOM 节点。
 */

/**
 * 单块碎片的画布：轮廓、裁剪、图片切片、缝隙侵蚀全部交给 lib/jigsaw。
 *
 * canvas 比格子大 2×TEETH_DEPTH_PX（容纳锯齿凸起），因此它会超出按钮的盒子 ——
 * 这也是棋盘（以及按钮本身）绝对不能 overflow:hidden 的原因。
 * 只依赖 row / col / cell / image，所以相邻两块交换时只有这两块重画。
 */
function PieceCanvas({
  image,
  row,
  col,
  size,
  cell,
}: {
  image: CanvasImageSource | null;
  row: number;
  col: number;
  size: number;
  cell: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const side = cell + TEETH_DEPTH_PX * 2;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !image || cell <= 0) return;
    drawPieceToCanvas(canvas, {
      image,
      boardPx: size * cell,
      row,
      col,
      size,
      cell,
      seam: PIECE_GAP_PX,
    });
  }, [image, row, col, size, cell]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute block"
      style={{
        left: -TEETH_DEPTH_PX,
        top: -TEETH_DEPTH_PX,
        width: side,
        height: side,
      }}
    />
  );
}

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
/**
 * 2008 老 Flash 拼图的「黑色缝隙」。
 * 做法：每块比所在格子小 PIECE_GAP_PX、并整体偏移 PIECE_GAP_PX / 2，
 * 相邻碎片之间就会露出底层纯黑底板 —— 缝隙由底色透出，而不是给碎片描边。
 * 需求给出的上限是 3px，不允许更大。
 */
const PIECE_GAP_PX = 2;

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
  const [bitmap, setBitmap] = useState<HTMLImageElement | null>(null);

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

  /* ---------- 碎片的位图：canvas 切片必须先把图片解码好 ---------- */
  useEffect(() => {
    let alive = true;
    // 带 crossOrigin 时 canvas 不被污染（能读回像素，便于自动化验收）；
    // 万一对象存储没回 CORS 头，就退回普通加载 —— 绘制照常，只是读不了像素。
    const image = new window.Image();
    image.decoding = "async";
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (alive) setBitmap(image);
    };
    image.onerror = () => {
      if (!alive) return;
      const fallback = new window.Image();
      fallback.decoding = "async";
      fallback.onload = () => {
        if (alive) setBitmap(fallback);
      };
      fallback.src = imageUrl;
    };
    image.src = imageUrl;
    return () => {
      alive = false;
    };
  }, [imageUrl]);

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
        // 完成音立即响（会同时把 BGM 压低），留一点时间播「发光 + 缩放」再弹解锁弹窗
        audio.playComplete();
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

  return (
    <div className="flex w-full flex-col items-center gap-3">
      <div
        ref={wrapperRef}
        className="relative"
        style={{ width: sizeExpression, aspectRatio: "1 / 1" }}
      >
        {/*
          2008 老 Flash 拼图外观：纯黑底板 + 直角 + 无描边 + 无外发光。
          这里**故意不加 overflow-hidden**：拖拽中的碎片会被拖到棋盘之外，
          一旦在棋盘上裁剪，碎片就会被切掉；高光渐变由下面那层 overlay 自己裁剪。
        */}
        <div
          ref={boardRef}
          className="relative size-full rounded-none bg-black"
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
              const isSelected = selected === slot;
              const isDragging = drag?.slot === slot;
              // 「拿起」= 点选态或拖拽态：老 Flash 里只有这一种状态才有放大与投影
              const lifted = isSelected || isDragging;
              const solved = phase === "solved";
              // 缝隙不再靠「缩小格子」制造，而是由 canvas 沿轮廓侵蚀（见 lib/jigsaw）：
              // 因此按钮就是完整的一格，命中区更大，定位也不需要半像素补偿。
              const baseX = col * cellSize;
              const baseY = row * cellSize;

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
                  className="absolute top-0 left-0 rounded-none border-0 will-change-transform select-none"
                  style={{
                    // 按钮 = 命中区 = 完整一格；图案由内部那张外扩 12px 的 canvas 画
                    width: cellSize,
                    height: cellSize,
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
                    // 老 Flash 规矩：静止碎片不缩放、无阴影；只有「拿起」时才抬高 2%
                    scale: solved ? [1, 1.04, 1] : lifted ? 1.02 : 1,
                    rotate: 0,
                    opacity: 1,
                    boxShadow: lifted
                      ? "0px 4px 8px rgba(0,0,0,0.35)"
                      : solved
                        ? "0 0 24px rgba(255,236,196,0.45)"
                        : "0 0 0 0 rgba(0,0,0,0)",
                    // 层叠顺序：普通碎片(1) < 玻璃高光层(500) < 拿起中的碎片(999)
                    zIndex: lifted ? 999 : 1,
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
                    // 「按住」音效（点选与拖拽起手都会响）
                    audio.playPress();
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
                    // 「松开」音效：交换成功时听着就像一块落位
                    audio.playRelease();
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
                >
                  {/* 锯齿碎片：轮廓 + 图片切片全画在这张 canvas 上 */}
                  <PieceCanvas
                    image={bitmap}
                    row={row}
                    col={col}
                    size={difficulty}
                    cell={cellSize}
                  />
                </motion.button>
              );
            })}

          {/*
            全局玻璃反光：独立 overlay 层（不是碎片自带高光），pointer-events: none 绝不遮挡交互。
            由这层容器自己 overflow-hidden 裁剪渐变 —— 高光不溢出棋盘，也不会切到拖拽中的碎片。
          */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-[500] overflow-hidden"
          >
            <div
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(135deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0) 35%)",
              }}
            />
          </div>
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
