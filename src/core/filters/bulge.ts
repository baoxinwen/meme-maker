/**
 * 膨胀/收缩滤镜（BULGE）。
 *
 * 逆向映射（共享骨架见 ./warp）：对半径内每个输出像素，
 * 用平滑衰减 falloff=(1-percent)² 把采样点向中心拉（strength>0 膨胀）或外推（strength<0 收缩）：
 *   srcDist = dist * (1 - strength * falloff)
 * 采样偏移 = (dx, dy) * (srcDist / dist)
 * strength ∈ [-1,1]，正数膨胀、负数收缩（与 filter.md 一致）。
 */

import type { RuntimeCanvas, RuntimeImage } from "../utils/runtime";
import type { ResolvedBulgeFilter } from "./resolve-frame";
import { warpFilter } from "./warp";

export function bulgeFilter(
  source: RuntimeImage | RuntimeCanvas,
  params: ResolvedBulgeFilter,
): RuntimeCanvas {
  const { strength } = params;
  return warpFilter(source, params, (dx, dy, dist, radius) => {
    const percent = dist / radius;
    const falloff = (1 - percent) * (1 - percent);
    const srcDist = dist * (1 - strength * falloff);
    const scale = srcDist / dist;
    return [dx * scale, dy * scale];
  });
}
