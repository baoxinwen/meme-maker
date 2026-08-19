/**
 * 半色调渲染器（halftone / dot-screen 共用）。
 *
 * 使用“旋转网格 + 圆点”的矢量绘制实现：
 *   - 白底
 *   - multiply 混合：多个色版（CMYK）叠印时按印刷减色模型混合
 *   - 每个色版有自己的网屏角度 + 全局 angle 旋转
 *   - 每个网格单元画一个圆点，半径 ∝ 该单元的油墨量
 *
 * 该算法生成经典的印刷半色调视觉。
 */

import { readPixels } from "../utils/pixel";
import { createCanvas } from "../utils/runtime";
import type { RuntimeCanvas, RuntimeContext, RuntimeImage } from "../utils/runtime";

export interface ScreenPlane {
  /** 油墨颜色（CSS），如 cyan="#00ffff" */
  readonly color: string;
  /** 该色版的网屏角度（弧度） */
  readonly angle: number;
  /** 由采样 RGBA(0-255) 求油墨量 [0,1] */
  readonly ink: (r: number, g: number, b: number, a: number) => number;
}

export interface RenderScreenOptions {
  readonly source: RuntimeImage | RuntimeCanvas;
  readonly cellSize: number;
  /** 全局旋转角（弧度），叠加到每个色版角度上 */
  readonly angle: number;
  readonly cx: number;
  readonly cy: number;
  readonly planes: readonly ScreenPlane[];
}

export const MAX_SCREEN_GRID_OPERATIONS = 50_000_000;

/** 把声明的 radius 归一化为网屏单元格边长（像素）；两个包装滤镜与估算共用。 */
export function screenCellSize(radius: number): number {
  return Math.max(2, Math.round(radius * 2));
}

export function estimateScreenGridOperations(
  width: number,
  height: number,
  cellSize: number,
  cx: number,
  cy: number,
  planeCount: number,
): number {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(cellSize) ||
    !Number.isFinite(cx) ||
    !Number.isFinite(cy) ||
    !Number.isSafeInteger(planeCount) ||
    width <= 0 ||
    height <= 0 ||
    cellSize <= 0 ||
    planeCount < 0
  ) {
    return Number.POSITIVE_INFINITY;
  }

  const maxDist = Math.hypot(Math.max(cx, width - cx), Math.max(cy, height - cy));
  const gridRadius = Math.ceil(maxDist / cellSize) + 1;
  const gridWidth = gridRadius * 2 + 1;
  return gridWidth * gridWidth * planeCount;
}

export function renderScreen(opts: RenderScreenOptions): RuntimeCanvas {
  const { source, cellSize, angle, cx, cy, planes } = opts;
  if (![cellSize, angle, cx, cy].every(Number.isFinite) || cellSize <= 0) {
    throw new Error("网屏几何参数必须是有效的有限数值");
  }
  const gridOperations = estimateScreenGridOperations(
    source.width,
    source.height,
    cellSize,
    cx,
    cy,
    planes.length,
  );
  if (!Number.isFinite(gridOperations) || gridOperations > MAX_SCREEN_GRID_OPERATIONS) {
    throw new Error("网屏计算量过大，请调整中心坐标、半径或图片尺寸");
  }
  const src = readPixels(source);
  const { data, width: w, height: h } = src;

  const out = createCanvas(w, h);
  const ctx = out.getContext("2d") as RuntimeContext;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "multiply";

  const half = cellSize / 2;
  // 覆盖整图所需的网格范围（以中心为原点，到四角最大距离）
  const maxDist = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy));
  const N = Math.ceil(maxDist / cellSize) + 1;

  for (const plane of planes) {
    const ang = angle + plane.angle;
    const cosA = Math.cos(ang);
    const sinA = Math.sin(ang);
    ctx.fillStyle = plane.color;

    for (let j = -N; j <= N; j++) {
      for (let i = -N; i <= N; i++) {
        const wx = cx + i * cellSize * cosA - j * cellSize * sinA;
        const wy = cy + i * cellSize * sinA + j * cellSize * cosA;
        if (wx < 0 || wx >= w || wy < 0 || wy >= h) continue;

        const sx = wx | 0;
        const sy = wy | 0;
        const idx = (sy * w + sx) * 4;
        const ink = plane.ink(data[idx], data[idx + 1], data[idx + 2], data[idx + 3]);
        const dotR = ink * half;
        if (dotR < 0.2) continue;

        ctx.beginPath();
        ctx.arc(wx, wy, dotR, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  ctx.globalCompositeOperation = "source-over";
  return out;
}

/** 亮度（0-255 → 0-1），用 ITU-R BT.601 加权。 */
export function luminance(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** RGB(0-255) → CMYK(0-1)，返回 [c, m, y, k]。 */
export function rgbToCmyk(r: number, g: number, b: number): [number, number, number, number] {
  const r1 = r / 255;
  const g1 = g / 255;
  const b1 = b / 255;
  const k = 1 - Math.max(r1, g1, b1);
  if (k >= 1) return [0, 0, 0, 1];
  const c = (1 - r1 - k) / (1 - k);
  const m = (1 - g1 - k) / (1 - k);
  const y = (1 - b1 - k) / (1 - k);
  return [c, m, y, k];
}
