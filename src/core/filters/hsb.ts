/**
 * 色相/饱和度/亮度滤镜（HSB）。
 *
 * 使用 Rodrigues 旋转公式处理色相，并通过亮度加权混合饱和度；
 * brightness 按 [-1,1] 范围执行加性偏移。
 *
 *   hue ∈ [-1,1] → 旋转 hue * 2π
 *   saturation ∈ [-1,1] → mix(lum, color, 1 + saturation)
 *   brightness ∈ [-1,1] → 加性偏移
 */

import { readPixels, writePixels } from "../utils/pixel";
import type { RuntimeCanvas, RuntimeImage } from "../utils/runtime";
import type { ResolvedHsbFilter } from "./resolve-frame";

// 1/sqrt(3)，Rodrigues 旋转公式中的单位轴分量。
const K = 0.5773502691896258;

export function hsbFilter(
  source: RuntimeImage | RuntimeCanvas,
  params: ResolvedHsbFilter,
): RuntimeCanvas {
  const angle = params.hue * Math.PI * 2;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const oneMinusCos = 1 - cosA;
  const satMul = 1 + params.saturation;
  const brightness = params.brightness;

  const { data, width: w, height: h } = readPixels(source);
  const out = new Uint8ClampedArray(data.length);

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;

    // 色相旋转（k = (1,1,1)/√3 的 Rodrigues 公式）
    const dot = K * (r + g + b);
    const cr = K * b - K * g;
    const cg = K * r - K * b;
    const cb = K * g - K * r;
    let hr = r * cosA + cr * sinA + K * dot * oneMinusCos;
    let hg = g * cosA + cg * sinA + K * dot * oneMinusCos;
    let hb = b * cosA + cb * sinA + K * dot * oneMinusCos;

    // 饱和度：向亮度灰混合
    const lum = 0.2125 * hr + 0.7154 * hg + 0.0721 * hb;
    hr = lum + (hr - lum) * satMul;
    hg = lum + (hg - lum) * satMul;
    hb = lum + (hb - lum) * satMul;

    // 亮度偏移
    hr += brightness;
    hg += brightness;
    hb += brightness;

    out[i] = hr * 255;
    out[i + 1] = hg * 255;
    out[i + 2] = hb * 255;
    out[i + 3] = data[i + 3];
  }

  return writePixels({ data: out, width: w, height: h });
}
