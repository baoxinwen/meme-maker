/**
 * 油画滤镜（OIL）。
 *
 * 对每个像素，在 [-range, range) 步进 skip 的邻域里采样，
 * 按「RGBA 平均值 × levels」分箱累计计数与颜色和，取计数最多的箱的平均色作为输出。
 * 这样颜色相近的邻域被合并，产生油画般的色块化效果。
 *
 * 与 shader 的唯一差异：用最近邻整数采样（shader 用浮点双线性），视觉差异可忽略。
 */

import { readPixels, writePixels } from "../utils/pixel";
import type { RuntimeCanvas, RuntimeImage } from "../utils/runtime";
import type { ResolvedOilFilter } from "./resolve-frame";

const MAX_LEVELS = 64; // 与 shader 的 colorArr[64] 上限一致

function clampi(v: number, max: number): number {
  return v < 0 ? 0 : v > max ? max : v;
}

/** 把声明的 skip/range 归一化为实现使用的采样参数；实现与计算量估算共用。 */
export function oilSamplingParams(
  skipRaw: number,
  rangeRaw: number,
): { skip: number; range: number } {
  return {
    skip: Math.max(1, skipRaw),
    // range 0 会让邻域采样数为 0，输出整帧全透明，钳到最小 1
    range: Math.max(1, Math.round(rangeRaw)),
  };
}

export function oilFilter(
  source: RuntimeImage | RuntimeCanvas,
  params: ResolvedOilFilter,
): RuntimeCanvas {
  const { skip, range } = oilSamplingParams(params.skip, params.range);
  const levels = Math.min(MAX_LEVELS, Math.max(1, Math.round(params.levels)));

  const { data, width: w, height: h } = readPixels(source);
  const out = new Uint8ClampedArray(data.length);

  // 复用缓冲，避免每像素分配
  const counts = new Float64Array(MAX_LEVELS);
  const sumR = new Float64Array(MAX_LEVELS);
  const sumG = new Float64Array(MAX_LEVELS);
  const sumB = new Float64Array(MAX_LEVELS);
  const sumA = new Float64Array(MAX_LEVELS);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      counts.fill(0, 0, levels);
      sumR.fill(0, 0, levels);
      sumG.fill(0, 0, levels);
      sumB.fill(0, 0, levels);
      sumA.fill(0, 0, levels);

      for (let dy = -range; dy < range; dy += skip) {
        const ny = clampi(y + dy, h - 1);
        for (let dx = -range; dx < range; dx += skip) {
          const nx = clampi(x + dx, w - 1);
          const ni = (ny * w + nx) * 4;
          const r = data[ni] / 255;
          const g = data[ni + 1] / 255;
          const b = data[ni + 2] / 255;
          const a = data[ni + 3] / 255;
          let lv = Math.floor(((r + g + b + a) / 4) * levels);
          if (lv >= levels) lv = levels - 1;
          counts[lv]++;
          sumR[lv] += r;
          sumG[lv] += g;
          sumB[lv] += b;
          sumA[lv] += a;
        }
      }

      let maxLv = 0;
      for (let lv = 1; lv < levels; lv++) {
        if (counts[lv] > counts[maxLv]) maxLv = lv;
      }
      const cnt = counts[maxLv] || 1;
      const ci = (y * w + x) * 4;
      out[ci] = (sumR[maxLv] / cnt) * 255;
      out[ci + 1] = (sumG[maxLv] / cnt) * 255;
      out[ci + 2] = (sumB[maxLv] / cnt) * 255;
      out[ci + 3] = (sumA[maxLv] / cnt) * 255;
    }
  }

  return writePixels({ data: out, width: w, height: h });
}
