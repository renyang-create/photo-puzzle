/**
 * 拼图锯齿（tab / blank）几何。
 *
 * 设计要点：
 *   · 单元格尺寸由调用方给出（线上是响应式尺寸），但**凹凸深度固定 12px**
 *     —— 老 Flash 拼图的凹凸是固定像素的，换难度 / 换屏宽时观感才稳定。
 *   · 每条内部边是否凸出，由 (行, 列, 方向) 的哈希唯一决定：
 *     左块算「凸起」和右块算「凹槽」调用的是同一个函数，因此天然互补，
 *     不可能出现两个凸起对撞。
 *   · 棋盘最外圈一律平直，保证拼图外轮廓是一个完整矩形。
 *   · 渲染用 Canvas：先 Path2D 画轮廓，再 ctx.clip() 贴图片切片。
 *     纯 CSS 的 clip-path 做不到这件事 —— 裁剪无法超出元素盒子，
 *     而锯齿凸起必须伸出格子之外。
 */

export const TEETH_DEPTH_PX = 12;

export type EdgeMode = "line" | "tab" | "hole";

export interface PieceEdges {
  top: EdgeMode;
  right: EdgeMode;
  bottom: EdgeMode;
  left: EdgeMode;
}

/** 相邻两块共享的那条边归谁凸出（true = 靠上 / 靠左那块向外凸） */
export function edgeTabOut(kind: "h" | "v", row: number, col: number): boolean {
  const hash =
    ((row * 73856093) ^ (col * 19349663) ^ (kind === "h" ? 0x9e3779b9 : 0x85ebca6b)) >>> 0;
  return hash % 2 === 1;
}

/** 推导某块四条边的形态：平直（外圈）/ 凸出 / 凹陷 */
export function pieceEdges(row: number, col: number, size: number): PieceEdges {
  const last = size - 1;
  return {
    top: row === 0 ? "line" : edgeTabOut("h", row - 1, col) ? "hole" : "tab",
    bottom: row === last ? "line" : edgeTabOut("h", row, col) ? "tab" : "hole",
    left: col === 0 ? "line" : edgeTabOut("v", row, col - 1) ? "hole" : "tab",
    right: col === last ? "line" : edgeTabOut("v", row, col) ? "tab" : "hole",
  };
}

/**
 * 沿一条边画「直线」或「凸起 / 凹槽」。
 *   · n = 外向法线；凸起朝 +法线，凹槽朝 −法线（少了这个方向，凹凸会一起外鼓）
 *   · 颈部收窄到边的中段 28%，圆头凸出 teeth 像素 —— 接近老 Flash 拼图的蘑菇形
 */
function addEdge(
  path: Path2D,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  nx: number,
  ny: number,
  mode: EdgeMode,
  teeth: number,
): void {
  if (mode === "line") {
    path.lineTo(bx, by);
    return;
  }

  const dir = mode === "tab" ? 1 : -1;
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const px = nx * teeth * dir;
  const py = ny * teeth * dir;

  const a1x = ax + ux * len * 0.36;
  const a1y = ay + uy * len * 0.36;
  const b1x = ax + ux * len * 0.64;
  const b1y = ay + uy * len * 0.64;
  const mx = ax + ux * len * 0.5 + px;
  const my = ay + uy * len * 0.5 + py;

  path.lineTo(a1x, a1y);
  path.bezierCurveTo(
    a1x + ux * len * 0.03 + px * 0.8,
    a1y + uy * len * 0.03 + py * 0.8,
    mx - ux * len * 0.11 + px * 0.8,
    my - uy * len * 0.11 + py * 0.8,
    mx,
    my,
  );
  path.bezierCurveTo(
    mx + ux * len * 0.11 + px * 0.8,
    my + uy * len * 0.11 + py * 0.8,
    b1x + ux * len * 0.03 + px * 0.8,
    b1y + uy * len * 0.03 + py * 0.8,
    b1x,
    b1y,
  );
  path.lineTo(bx, by);
}

export interface PieceRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 生成某一块的闭合轮廓（坐标系是它自己的画布） */
export function buildPiecePath(
  row: number,
  col: number,
  size: number,
  rect: PieceRect,
  teeth: number = TEETH_DEPTH_PX,
): Path2D {
  const edges = pieceEdges(row, col, size);
  const { x, y, w, h } = rect;

  const path = new Path2D();
  path.moveTo(x, y);
  addEdge(path, x, y, x + w, y, 0, -1, edges.top, teeth); // 上边：左 → 右
  addEdge(path, x + w, y, x + w, y + h, 1, 0, edges.right, teeth); // 右边：上 → 下
  addEdge(path, x + w, y + h, x, y + h, 0, 1, edges.bottom, teeth); // 下边：右 → 左
  addEdge(path, x, y + h, x, y, -1, 0, edges.left, teeth); // 左边：下 → 上
  path.closePath();
  return path;
}

export interface DrawPieceOptions {
  image: CanvasImageSource;
  /** 图片在棋盘上的整体绘制尺寸（= size × cell），与 CSS background-size 的观感一致 */
  boardPx: number;
  row: number;
  col: number;
  size: number;
  /** 单元格边长（响应式，会变） */
  cell: number;
  /** 锯齿深度，默认 12px */
  teeth?: number;
  /**
   * 相邻两块之间要留的黑缝宽度（px），默认 2。
   * 实现方式是沿轮廓向内侵蚀 seam / 2 —— 两块各缩一半，合起来正好 seam 像素。
   */
  seam?: number;
  /** 设备像素比，保证高清屏不糊 */
  dpr?: number;
}

/**
 * 把某一块画到 canvas 上：
 *   1. 画布比格子大 2×teeth（用来容纳凸起），格子位于画布正中；
 *   2. 先 clip 轮廓，再贴对应位置的图片切片；
 *   3. 沿轮廓向内侵蚀 1px —— 相邻两块各缩 1px，之间就会留下宽度恒为 2px 的黑缝
 *      （缝隙由底层黑色透出，不给碎片描边）。
 */
export function drawPieceToCanvas(
  canvas: HTMLCanvasElement,
  options: DrawPieceOptions,
): void {
  const { image, boardPx, row, col, size, cell } = options;
  const teeth = options.teeth ?? TEETH_DEPTH_PX;
  const seam = options.seam ?? 2;
  const dpr = options.dpr ?? Math.min(2, window.devicePixelRatio || 1);
  const side = cell + teeth * 2;

  const targetW = Math.max(1, Math.round(side * dpr));
  if (canvas.width !== targetW) canvas.width = targetW;
  if (canvas.height !== targetW) canvas.height = targetW;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, side, side);

  const rect: PieceRect = { x: teeth, y: teeth, w: cell, h: cell };
  const path = buildPiecePath(row, col, size, rect, teeth);

  ctx.save();
  ctx.clip(path);
  // 图片整体按 boardPx 渲染，此行此列对应的切片正好落在 [teeth, teeth, cell, cell] 上
  ctx.drawImage(image, teeth - col * cell, teeth - row * cell, boardPx, boardPx);
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.lineWidth = seam; // 描边以路径为中心 → 每块向内侵蚀 seam / 2
  ctx.strokeStyle = "#000";
  ctx.stroke(path);
  ctx.restore();
}
