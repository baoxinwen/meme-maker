/** 在源图上叠加可控长度和透明度的纵向残影。 */

import { copyAsCanvas } from "../utils/canvas";
import type { RuntimeCanvas, RuntimeContext, RuntimeImage } from "../utils/runtime";
import type { ResolvedAfterimageFilter } from "./resolve-frame";

/** 按声明参数算出残影叠加行数（步数）；实现与计算量估算共用。 */
export function afterimageSteps(fraction: number, height: number): number {
  return Math.max(0, Math.floor(height * fraction));
}

export function afterimageFilter(
  source: RuntimeImage | RuntimeCanvas,
  params: ResolvedAfterimageFilter,
): RuntimeCanvas {
  const canvas = copyAsCanvas(source);
  const steps = afterimageSteps(params.fraction, source.height);
  if (steps === 0 || params.opacity <= 0) return canvas;

  const ctx = canvas.getContext("2d") as RuntimeContext;
  const previousAlpha = ctx.globalAlpha;
  ctx.globalAlpha = params.opacity;
  for (let offset = 0; offset < steps; offset++) {
    ctx.drawImage(source, 0, offset);
  }
  ctx.globalAlpha = previousAlpha;
  return canvas;
}
