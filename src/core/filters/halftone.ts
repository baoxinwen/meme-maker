/**
 * 彩色半色调滤镜（HALFTONE）—— 模仿 CMYK 彩色印刷的网点叠印。
 *
 * 四个色版（青/品红/黄/黑）各自有自己的网屏角度 + 全局 angle，
 * 用 multiply 混合叠印在白底上，暗区网点大、亮区网点小。
 */

import type { RuntimeCanvas, RuntimeImage } from "../utils/runtime";
import type { ResolvedHalftoneFilter } from "./resolve-frame";
import { renderScreen, rgbToCmyk, screenCellSize } from "./screen";

// 经典 CMYK 网屏角度（弧度）
const ANG_C = (15 * Math.PI) / 180;
const ANG_M = (75 * Math.PI) / 180;
const ANG_Y = 0;
const ANG_K = (45 * Math.PI) / 180;

export function halftoneFilter(
  source: RuntimeImage | RuntimeCanvas,
  params: ResolvedHalftoneFilter,
): RuntimeCanvas {
  const cellSize = screenCellSize(params.radius);
  const w = source.width;
  const h = source.height;
  const cx = params.x * w;
  const cy = params.y * h;

  return renderScreen({
    source,
    cellSize,
    angle: params.angle,
    cx,
    cy,
    planes: [
      { color: "#00ffff", angle: ANG_C, ink: (r, g, b) => rgbToCmyk(r, g, b)[0] },
      { color: "#ff00ff", angle: ANG_M, ink: (r, g, b) => rgbToCmyk(r, g, b)[1] },
      { color: "#ffff00", angle: ANG_Y, ink: (r, g, b) => rgbToCmyk(r, g, b)[2] },
      { color: "#000000", angle: ANG_K, ink: (r, g, b) => rgbToCmyk(r, g, b)[3] },
    ],
  });
}
