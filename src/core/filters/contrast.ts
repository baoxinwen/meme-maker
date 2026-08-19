/**
 * 亮度/对比度滤镜（CONTRAST）。
 *
 * 颜色先归一化到 [0,1]，再应用亮度和对比度：
 *   1) v *= (brightness + 1)        // brightness ∈ [-1,1]，0 = 不变
 *   2) v = (v - 0.5) * (contrast + 1) + 0.5   // contrast ∈ [-1,1]，0 = 不变
 * alpha 不变。
 */

import { readPixels, writePixels } from "../utils/pixel";
import type { RuntimeCanvas, RuntimeImage } from "../utils/runtime";
import type { ResolvedContrastFilter } from "./resolve-frame";

export function contrastFilter(
  source: RuntimeImage | RuntimeCanvas,
  params: ResolvedContrastFilter,
): RuntimeCanvas {
  const bMul = params.brightness + 1; // 亮度乘子
  const cMul = params.contrast + 1; // 对比度乘子
  const { data, width: w, height: h } = readPixels(source);
  const out = new Uint8ClampedArray(data.length);

  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      let v = data[i + c] / 255;
      v = v * bMul;
      v = (v - 0.5) * cMul + 0.5;
      out[i + c] = v * 255;
    }
    out[i + 3] = data[i + 3];
  }

  return writePixels({ data: out, width: w, height: h });
}
