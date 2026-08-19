/**
 * 降噪滤镜（DENOISE）。
 *
 * 使用 9×9 双边滤波，在平滑噪声的同时尽量保留边缘。
 * 邻域内每个样本的权重 = (1 - 与中心像素的平均绝对差)^exponent，
 * 差越大权重越小，从而在降噪的同时保留边缘。
 */

import { readPixels, writePixels } from "../utils/pixel";
import type { RuntimeCanvas, RuntimeImage } from "../utils/runtime";
import type { ResolvedDenoiseFilter } from "./resolve-frame";

/** 邻域半径 [-DENOISE_RADIUS, DENOISE_RADIUS]；实现与计算量估算共用。 */
export const DENOISE_RADIUS = 4;

export function denoiseFilter(
  source: RuntimeImage | RuntimeCanvas,
  params: ResolvedDenoiseFilter,
): RuntimeCanvas {
  const exponent = params.exponent;
  const { data, width: w, height: h } = readPixels(source);
  const out = new Uint8ClampedArray(data.length);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ci = (y * w + x) * 4;
      const cr = data[ci] / 255;
      const cg = data[ci + 1] / 255;
      const cb = data[ci + 2] / 255;
      const ca = data[ci + 3] / 255;

      let R = 0;
      let G = 0;
      let B = 0;
      let A = 0;
      let total = 0;

      for (let dy = -DENOISE_RADIUS; dy <= DENOISE_RADIUS; dy++) {
        const ny = y + dy < 0 ? 0 : y + dy >= h ? h - 1 : y + dy;
        for (let dx = -DENOISE_RADIUS; dx <= DENOISE_RADIUS; dx++) {
          const nx = x + dx < 0 ? 0 : x + dx >= w ? w - 1 : x + dx;
          const ni = (ny * w + nx) * 4;
          const sr = data[ni] / 255;
          const sg = data[ni + 1] / 255;
          const sb = data[ni + 2] / 255;
          const sa = data[ni + 3] / 255;
          const diff =
            Math.abs(sr - cr) + Math.abs(sg - cg) + Math.abs(sb - cb) + Math.abs(sa - ca);
          const weight = (1 - diff / 4) ** exponent;
          R += sr * weight;
          G += sg * weight;
          B += sb * weight;
          A += sa * weight;
          total += weight;
        }
      }

      out[ci] = (R / total) * 255;
      out[ci + 1] = (G / total) * 255;
      out[ci + 2] = (B / total) * 255;
      out[ci + 3] = (A / total) * 255;
    }
  }

  return writePixels({ data: out, width: w, height: h });
}
