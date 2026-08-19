/**
 * 裁剪一张图。支持两种参数形式：
 *   - [w, h] —— 从原点 (0,0) 起裁出 w*h 大小
 *   - [x1, y1, x2, y2] —— 从 (x1, y1) 到 (x2, y2) 这块区域
 *
 * `usePercentage` 为 `true` 时，所有数值视为基于原图尺寸的百分比。
 */

import { createCanvas } from "../utils/runtime";
import type { RuntimeCanvas, RuntimeContext, RuntimeImage } from "../utils/runtime";

export type CropCoords = readonly [number, number] | readonly [number, number, number, number];

export function cropImage(
  image: RuntimeImage | RuntimeCanvas,
  coords: CropCoords,
  usePercentage = false,
): RuntimeCanvas {
  let x1: number;
  let y1: number;
  let x2: number;
  let y2: number;
  if (coords.length === 2) {
    [x1, y1] = [0, 0];
    [x2, y2] = coords;
  } else {
    [x1, y1, x2, y2] = coords;
  }

  let srcW: number;
  let srcH: number;
  let dstW: number;
  let dstH: number;

  if (usePercentage) {
    srcW = ((x2 - x1) / 100) * image.width;
    srcH = ((y2 - y1) / 100) * image.height;
    dstW = srcW;
    dstH = srcH;
  } else {
    srcW = x2 - x1;
    srcH = y2 - y1;
    dstW = srcW;
    dstH = srcH;
  }

  const canvas = createCanvas(dstW, dstH);
  const ctx = canvas.getContext("2d") as RuntimeContext;
  ctx.drawImage(image, x1, y1, srcW, srcH, 0, 0, dstW, dstH);
  return canvas;
}
