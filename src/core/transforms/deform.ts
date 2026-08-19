/**
 * 透视变形（DEFORM）—— 把矩形头像映射到任意四边形区域，产生贴合透视的效果。
 *
 * 使用自包含的“单应性变换 + 三角网格细分”纯 Canvas 实现：
 *   1. 由源矩形四角 → 目标四边形四角，解出 3x3 单应性矩阵 H
 *   2. 把源图细分成 N×N 网格，每个网格顶点用 H 映射到目标位置
 *   3. 每个网格单元拆成 2 个三角形，用仿射变换逐三角形贴纹理
 *
 * 网格越细，透视越平滑（默认 10×10 足够表情包使用）。
 * 好处：无 WebGL 依赖、浏览器/Node 一致、体积极小。
 */

import { createCanvas } from "../utils/runtime";
import type { RuntimeCanvas, RuntimeContext, RuntimeImage } from "../utils/runtime";

type Point = readonly [number, number];

/**
 * 解 8 元线性方程组，求把单位/源矩形映射到目标四边形的单应性矩阵。
 * 返回 [a, b, c, d, e, f, g, h]（第 9 项固定为 1）。
 *
 * 源点固定为 (0,0)(sw,0)(0,sh)(sw,sh)，目标为四个角点。
 */
function computeHomography(
  sw: number,
  sh: number,
  dst: readonly [Point, Point, Point, Point],
): number[] {
  const src: Point[] = [
    [0, 0],
    [sw, 0],
    [0, sh],
    [sw, sh],
  ];

  // 构造 8x8 线性方程组 A·x = b
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [X, Y] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]);
    b.push(X);
    A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]);
    b.push(Y);
  }

  return solveLinearSystem(A, b);
}

/** 高斯消元解 n 元线性方程组 */
function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = b.length;
  // 增广矩阵
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // 选主元（部分主元法，提升数值稳定性）
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    [M[col], M[pivot]] = [M[pivot], M[col]];

    const pv = M[col][col] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col] / pv;
      for (let c = col; c <= n; c++) {
        M[r][c] -= factor * M[col][c];
      }
    }
  }

  return M.map((row, i) => row[n] / (row[i] || 1e-12));
}

/** 用单应性矩阵把点 (x,y) 映射到目标坐标 */
function applyHomography(h: number[], x: number, y: number): Point {
  const denom = h[6] * x + h[7] * y + 1;
  return [(h[0] * x + h[1] * y + h[2]) / denom, (h[3] * x + h[4] * y + h[5]) / denom];
}

/**
 * 用仿射变换把源三角形 (s0,s1,s2) 的纹理贴到目标三角形 (d0,d1,d2)。
 */
function drawTexturedTriangle(
  ctx: RuntimeContext,
  image: RuntimeImage | RuntimeCanvas,
  s: [Point, Point, Point],
  d: [Point, Point, Point],
): void {
  ctx.save();

  // 用目标三角形做裁剪区域
  ctx.beginPath();
  ctx.moveTo(d[0][0], d[0][1]);
  ctx.lineTo(d[1][0], d[1][1]);
  ctx.lineTo(d[2][0], d[2][1]);
  ctx.closePath();
  ctx.clip();

  // 求把源三角形映射到目标三角形的仿射矩阵
  const [sx0, sy0] = s[0];
  const [sx1, sy1] = s[1];
  const [sx2, sy2] = s[2];
  const [dx0, dy0] = d[0];
  const [dx1, dy1] = d[1];
  const [dx2, dy2] = d[2];

  const denom = sx0 * (sy2 - sy1) - sx1 * sy2 + sx2 * sy1 + (sx1 - sx2) * sy0;
  if (Math.abs(denom) < 1e-9) {
    ctx.restore();
    return;
  }
  const m11 = -(sy0 * (dx2 - dx1) - sy1 * dx2 + sy2 * dx1 + (sy1 - sy2) * dx0) / denom;
  const m12 = (sy1 * dy2 + sy0 * (dy1 - dy2) - sy2 * dy1 + (sy2 - sy1) * dy0) / denom;
  const m21 = (sx0 * (dx2 - dx1) - sx1 * dx2 + sx2 * dx1 + (sx1 - sx2) * dx0) / denom;
  const m22 = -(sx1 * dy2 + sx0 * (dy1 - dy2) - sx2 * dy1 + (sx2 - sx1) * dy0) / denom;
  const dx =
    (sx0 * (sy2 * dx1 - sy1 * dx2) +
      sy0 * (sx1 * dx2 - sx2 * dx1) +
      (sx2 * sy1 - sx1 * sy2) * dx0) /
    denom;
  const dy =
    (sx0 * (sy2 * dy1 - sy1 * dy2) +
      sy0 * (sx1 * dy2 - sx2 * dy1) +
      (sx2 * sy1 - sx1 * sy2) * dy0) /
    denom;

  ctx.transform(m11, m12, m21, m22, dx, dy);
  ctx.drawImage(image, 0, 0);
  ctx.restore();
}

/**
 * 把图像透视变形到目标四边形并画到 ctx。
 *
 * @param corners 目标四边形的 4 个角点，顺序：左上、右上、右下、左下
 * @param grid 网格细分数（默认 10）
 */
export function drawDeform(
  ctx: RuntimeContext,
  image: RuntimeImage | RuntimeCanvas,
  corners: readonly [Point, Point, Point, Point],
  grid = 10,
): void {
  const sw = image.width;
  const sh = image.height;
  // 目标四边形顺序（左上、右上、右下、左下）转成单应性需要的
  // 源点顺序 (0,0)(sw,0)(0,sh)(sw,sh) 对应 目标 (LT)(RT)(LB)(RB)
  const [lt, rt, rb, lb] = corners;
  const h = computeHomography(sw, sh, [lt, rt, lb, rb]);

  const cellW = sw / grid;
  const cellH = sh / grid;

  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      const x0 = gx * cellW;
      const y0 = gy * cellH;
      const x1 = (gx + 1) * cellW;
      const y1 = (gy + 1) * cellH;

      // 源网格 4 角
      const s00: Point = [x0, y0];
      const s10: Point = [x1, y0];
      const s01: Point = [x0, y1];
      const s11: Point = [x1, y1];

      // 目标网格 4 角（单应性映射）
      const d00 = applyHomography(h, x0, y0);
      const d10 = applyHomography(h, x1, y0);
      const d01 = applyHomography(h, x0, y1);
      const d11 = applyHomography(h, x1, y1);

      // 每格 2 个三角形
      drawTexturedTriangle(ctx, image, [s00, s10, s01], [d00, d10, d01]);
      drawTexturedTriangle(ctx, image, [s10, s11, s01], [d10, d11, d01]);
    }
  }
}

/**
 * 变形到独立画布（尺寸由目标四边形包围盒决定）。
 * 便于在合成流程里当作普通图层使用。
 */
export function deformToCanvas(
  image: RuntimeImage | RuntimeCanvas,
  corners: readonly [Point, Point, Point, Point],
  canvasWidth: number,
  canvasHeight: number,
  grid = 10,
): RuntimeCanvas {
  const canvas = createCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext("2d") as RuntimeContext;
  drawDeform(ctx, image, corners, grid);
  return canvas;
}
