/**
 * 把图像剪成圆形（用于 round 选项）。
 */

import { createCanvas } from "../utils/runtime";
import type { RuntimeCanvas, RuntimeContext, RuntimeImage } from "../utils/runtime";

export function clipCircleImage(source: RuntimeImage | RuntimeCanvas): RuntimeCanvas {
  const w = source.width;
  const h = source.height;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d") as RuntimeContext;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(source, 0, 0);
  ctx.restore();
  return canvas;
}
