/**
 * 二值化（黑白阈值）。阈值默认 128。
 */

import { luminance601, readPixels, writePixels } from "../utils/pixel";
import type { RuntimeCanvas, RuntimeImage } from "../utils/runtime";

export function binarizeImage(
  source: RuntimeImage | RuntimeCanvas,
  threshold = 128,
): RuntimeCanvas {
  const { data, width, height } = readPixels(source);
  for (let i = 0; i < data.length; i += 4) {
    const v = luminance601(data[i], data[i + 1], data[i + 2]) >= threshold ? 255 : 0;
    data[i] = data[i + 1] = data[i + 2] = v;
  }
  return writePixels({ data, width, height });
}
