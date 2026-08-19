/**
 * 漩涡滤镜（SWIRL）—— 围绕中心点把图像旋转扭曲，越靠中心旋转越多。
 *
 * 逆向映射（共享骨架见 ./warp）：对半径内每个输出像素，
 *   twist = angle * (1 - dist/radius)   // 中心满旋，边缘归零
 *   源点角度 = atan2(dy, dx) + twist
 * 采样偏移为极坐标 (dist·cosθ, dist·sinθ)。radius=0 时取 min(w,h)/2。
 */

import type { RuntimeCanvas, RuntimeImage } from "../utils/runtime";
import type { ResolvedSwirlFilter } from "./resolve-frame";
import { warpFilter } from "./warp";

export function swirlFilter(
  source: RuntimeImage | RuntimeCanvas,
  params: ResolvedSwirlFilter,
): RuntimeCanvas {
  const { angle } = params;
  return warpFilter(source, params, (dx, dy, dist, radius) => {
    const twist = angle * (1 - dist / radius);
    const srcTheta = Math.atan2(dy, dx) + twist;
    return [dist * Math.cos(srcTheta), dist * Math.sin(srcTheta)];
  });
}
