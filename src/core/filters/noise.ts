/**
 * 噪声滤镜（NOISE）。
 *
 * 每个像素的颜色按 amount 混向一个灰度随机值：
 * out = color * (1 - amount) + rand * amount（RGB 通道），
 * alpha 保持不变。amount ∈ [0,1]。
 */

import { readPixels, writePixels } from "../utils/pixel";
import type { RuntimeCanvas, RuntimeImage } from "../utils/runtime";
import type { ResolvedNoiseFilter } from "./resolve-frame";

export function noiseFilter(
  source: RuntimeImage | RuntimeCanvas,
  params: ResolvedNoiseFilter,
): RuntimeCanvas {
  const amount = Math.max(0, Math.min(1, params.amount));
  const { data, width: w, height: h } = readPixels(source);
  const out = new Uint8ClampedArray(data.length);
  const inv = 1 - amount;

  for (let i = 0; i < data.length; i += 4) {
    const n = Math.random() * 255;
    out[i] = data[i] * inv + n * amount;
    out[i + 1] = data[i + 1] * inv + n * amount;
    out[i + 2] = data[i + 2] * inv + n * amount;
    out[i + 3] = data[i + 3];
  }

  return writePixels({ data: out, width: w, height: h });
}
