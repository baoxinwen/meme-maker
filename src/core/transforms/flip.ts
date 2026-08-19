/**
 * 上下翻转（竖直镜像）。基于 Canvas API 实现，不依赖 WebGL。
 */

import { createCanvas } from "../utils/runtime";
import type { RuntimeCanvas, RuntimeContext, RuntimeImage } from "../utils/runtime";

export function flipImage(source: RuntimeImage | RuntimeCanvas): RuntimeCanvas {
  const canvas = createCanvas(source.width, source.height);
  const ctx = canvas.getContext("2d") as RuntimeContext;
  ctx.translate(0, source.height);
  ctx.scale(1, -1);
  ctx.drawImage(source, 0, 0);
  return canvas;
}

/**
 * 左右镜像（水平翻转）。
 */
export function mirrorImage(source: RuntimeImage | RuntimeCanvas): RuntimeCanvas {
  const canvas = createCanvas(source.width, source.height);
  const ctx = canvas.getContext("2d") as RuntimeContext;
  ctx.translate(source.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(source, 0, 0);
  return canvas;
}
