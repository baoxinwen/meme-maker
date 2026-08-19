/** 从图像中心裁出最大正方形，保留源图的原始像素。 */

import { createCanvas } from "../utils/runtime";
import type { RuntimeCanvas, RuntimeContext, RuntimeImage } from "../utils/runtime";

export function squareImage(source: RuntimeImage | RuntimeCanvas): RuntimeCanvas {
  const edge = Math.min(source.width, source.height);
  const x = (source.width - edge) / 2;
  const y = (source.height - edge) / 2;
  const canvas = createCanvas(edge, edge);
  const ctx = canvas.getContext("2d") as RuntimeContext;
  ctx.drawImage(source, x, y, edge, edge, 0, 0, edge, edge);
  return canvas;
}
