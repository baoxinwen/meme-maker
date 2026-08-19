/** 按像素坐标多边形裁切图像，保持原画布尺寸。 */

import { createCanvas } from "../utils/runtime";
import type { RuntimeCanvas, RuntimeContext, RuntimeImage } from "../utils/runtime";

export function clipPolygonImage(
  source: RuntimeImage | RuntimeCanvas,
  points: readonly (readonly [number, number])[],
): RuntimeCanvas {
  const canvas = createCanvas(source.width, source.height);
  const ctx = canvas.getContext("2d") as RuntimeContext;
  const [first, ...rest] = points;
  if (!first) return canvas;

  ctx.beginPath();
  ctx.moveTo(first[0], first[1]);
  for (const [x, y] of rest) ctx.lineTo(x, y);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(source, 0, 0);
  return canvas;
}
