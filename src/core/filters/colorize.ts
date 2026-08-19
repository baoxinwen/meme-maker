/**
 * 颜色化滤镜：复现 Skia BlendMode::Color 的核心语义。
 *
 * 使用目标色的色相、饱和度与原像素明度重新组合，透明度保持不变。
 */

import { readPixels, writePixels } from "../utils/pixel";
import type { RuntimeCanvas, RuntimeImage } from "../utils/runtime";
import type { ResolvedColorizeFilter } from "./resolve-frame";

type Color = readonly [number, number, number];

export function colorizeFilter(
  source: RuntimeImage | RuntimeCanvas,
  params: ResolvedColorizeFilter,
): RuntimeCanvas {
  const { data, width, height } = readPixels(source);
  const out = new Uint8ClampedArray(data.length);
  const target: Color = [params.color[0] / 255, params.color[1] / 255, params.color[2] / 255];

  for (let index = 0; index < data.length; index += 4) {
    const sourceColor: Color = [data[index] / 255, data[index + 1] / 255, data[index + 2] / 255];
    const result = setLum(target, lum(sourceColor));
    out[index] = result[0] * 255;
    out[index + 1] = result[1] * 255;
    out[index + 2] = result[2] * 255;
    out[index + 3] = data[index + 3];
  }

  return writePixels({ data: out, width, height });
}

function lum([red, green, blue]: Color): number {
  return 0.3 * red + 0.59 * green + 0.11 * blue;
}

function setLum(color: Color, targetLum: number): Color {
  const currentLum = lum(color);
  return clipColor([
    color[0] + targetLum - currentLum,
    color[1] + targetLum - currentLum,
    color[2] + targetLum - currentLum,
  ]);
}

function clipColor(color: Color): Color {
  const min = Math.min(...color);
  const max = Math.max(...color);
  const currentLum = lum(color);
  let result: Color = color;

  if (min < 0) {
    result = adjustColor(color, currentLum, currentLum / (currentLum - min));
  }
  if (max > 1) {
    result = adjustColor(result, currentLum, (1 - currentLum) / (max - currentLum));
  }
  return result;
}

function adjustColor(color: Color, base: number, factor: number): Color {
  return [
    base + (color[0] - base) * factor,
    base + (color[1] - base) * factor,
    base + (color[2] - base) * factor,
  ];
}
