/**
 * 像素操作辅助 —— 给滤镜（filters/）共用的「读像素 / 写像素 / 双线性采样」工具。
 *
 * 之所以单独抽出来：11 种滤镜里，像素级（blur/noise/contrast/...）都走
 * getImageData→改→putImageData；几何扭曲（swirl/bulge/swim）还额外需要
 * 按浮点坐标从源图采样。统一在这里收口，避免每个滤镜文件各写一遍。
 *
 * 兼容性：用 createImageData 而非 new ImageData()，浏览器与 @napi-rs/canvas 都支持。
 */

import { copyAsCanvas } from "./canvas";
import { createCanvas } from "./runtime";
import type { RuntimeCanvas, RuntimeContext, RuntimeImage } from "./runtime";

export interface PixelBuffer {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

/**
 * 把任意 Image/Canvas 的像素读出来。
 * 内部先复制一张可读画布（willReadFrequently），再 getImageData。
 */
export function readPixels(source: RuntimeImage | RuntimeCanvas): PixelBuffer {
  const canvas = copyAsCanvas(source, true);
  const ctx = canvas.getContext("2d", { willReadFrequently: true }) as RuntimeContext;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { data: imageData.data, width: canvas.width, height: canvas.height };
}

/**
 * 把像素缓冲写回一张新的 Canvas。
 */
export function writePixels(buf: PixelBuffer): RuntimeCanvas {
  const canvas = createCanvas(buf.width, buf.height);
  const ctx = canvas.getContext("2d") as RuntimeContext;
  const imageData = ctx.createImageData(buf.width, buf.height);
  imageData.data.set(buf.data);
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * 按浮点坐标 (x, y) 从源像素数组双线性采样，结果写进 out[outIndex..outIndex+3]。
 * 坐标自动 clamp 到边界（超出按边缘像素延伸）。
 */
export function bilinearSample(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  out: Uint8ClampedArray,
  outIndex: number,
): void {
  let sx = x;
  let sy = y;
  if (sx < 0) sx = 0;
  else if (sx > width - 1) sx = width - 1;
  if (sy < 0) sy = 0;
  else if (sy > height - 1) sy = height - 1;

  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const x1 = x0 + 1 < width ? x0 + 1 : x0;
  const y1 = y0 + 1 < height ? y0 + 1 : y0;
  const fx = sx - x0;
  const fy = sy - y0;

  const i00 = (y0 * width + x0) * 4;
  const i10 = (y0 * width + x1) * 4;
  const i01 = (y1 * width + x0) * 4;
  const i11 = (y1 * width + x1) * 4;

  for (let c = 0; c < 4; c++) {
    const top = data[i00 + c] * (1 - fx) + data[i10 + c] * fx;
    const bot = data[i01 + c] * (1 - fx) + data[i11 + c] * fx;
    out[outIndex + c] = top * (1 - fy) + bot * fy;
  }
}

/** 取第 (x,y) 像素的起始索引（整数坐标，不越界检查）。 */
export function pixelIndex(width: number, x: number, y: number): number {
  return (y * width + x) * 4;
}

/** ITU-R BT.601 加权亮度（输入与返回值均为 0-255）。 */
export function luminance601(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}
