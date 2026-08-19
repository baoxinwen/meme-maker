/** 使用任意 alpha 蒙版裁切图像，蒙版会等比拉伸到源图尺寸。 */

import { createCanvas } from "../utils/runtime";
import type { RuntimeCanvas, RuntimeContext, RuntimeImage } from "../utils/runtime";

export function clipMaskImage(
  source: RuntimeImage | RuntimeCanvas,
  mask: RuntimeImage | RuntimeCanvas,
): RuntimeCanvas {
  const canvas = createCanvas(source.width, source.height);
  const ctx = canvas.getContext("2d") as RuntimeContext;
  ctx.drawImage(mask, 0, 0, source.width, source.height);
  ctx.globalCompositeOperation = "source-in";
  ctx.drawImage(source, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  return canvas;
}
