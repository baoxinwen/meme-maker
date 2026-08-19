/**
 * 模糊滤镜（BLUR）。
 *
 * 使用可分离 box blur（两趟 1D 平均），适合表情包尺寸且无需 WebGL。
 * 不走 CSS filter `blur()`：那样浏览器与 @napi-rs/canvas 行为会不一致，测试不可靠。
 */

import { readPixels, writePixels } from "../utils/pixel";
import type { RuntimeCanvas, RuntimeImage } from "../utils/runtime";
import type { ResolvedBlurFilter } from "./resolve-frame";

/** 把声明的 radius 归一化为实现使用的整数半径；实现与计算量估算共用。 */
export function normalizedBlurRadius(radius: number): number {
  return Math.max(0, Math.round(radius));
}

export function blurFilter(
  source: RuntimeImage | RuntimeCanvas,
  params: ResolvedBlurFilter,
): RuntimeCanvas {
  const r = normalizedBlurRadius(params.radius);
  const { data, width: w, height: h } = readPixels(source);
  if (r === 0) {
    return writePixels({ data, width: w, height: h });
  }

  // 水平趟
  const tmp = new Uint8ClampedArray(data.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let R = 0;
      let G = 0;
      let B = 0;
      let A = 0;
      const c = 2 * r + 1;
      for (let dx = -r; dx <= r; dx++) {
        const xi = x + dx < 0 ? 0 : x + dx >= w ? w - 1 : x + dx;
        const i = (y * w + xi) * 4;
        R += data[i];
        G += data[i + 1];
        B += data[i + 2];
        A += data[i + 3];
      }
      const o = (y * w + x) * 4;
      tmp[o] = R / c;
      tmp[o + 1] = G / c;
      tmp[o + 2] = B / c;
      tmp[o + 3] = A / c;
    }
  }

  // 竖直趟
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let R = 0;
      let G = 0;
      let B = 0;
      let A = 0;
      const c = 2 * r + 1;
      for (let dy = -r; dy <= r; dy++) {
        const yi = y + dy < 0 ? 0 : y + dy >= h ? h - 1 : y + dy;
        const i = (yi * w + x) * 4;
        R += tmp[i];
        G += tmp[i + 1];
        B += tmp[i + 2];
        A += tmp[i + 3];
      }
      const o = (y * w + x) * 4;
      out[o] = R / c;
      out[o + 1] = G / c;
      out[o + 2] = B / c;
      out[o + 3] = A / c;
    }
  }

  return writePixels({ data: out, width: w, height: h });
}
