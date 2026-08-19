/**
 * 单色点阵滤镜（DOT_SCREEN）—— 模仿黑白印刷品的网点。
 *
 * 单一黑色色版，网点大小 ∝ 暗度（1 - 亮度），白底黑点。
 */

import type { RuntimeCanvas, RuntimeImage } from "../utils/runtime";
import type { ResolvedDotScreenFilter } from "./resolve-frame";
import { luminance, renderScreen, screenCellSize } from "./screen";

export function dotScreenFilter(
  source: RuntimeImage | RuntimeCanvas,
  params: ResolvedDotScreenFilter,
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
      {
        color: "#000000",
        angle: 0,
        ink: (r, g, b) => 1 - luminance(r, g, b),
      },
    ],
  });
}
