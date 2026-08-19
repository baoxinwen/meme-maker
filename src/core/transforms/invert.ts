/** 反相图像颜色，保留原始 alpha 通道。 */

import { readPixels, writePixels } from "../utils/pixel";
import type { RuntimeCanvas, RuntimeImage } from "../utils/runtime";

export function invertImage(source: RuntimeImage | RuntimeCanvas): RuntimeCanvas {
  const { data, width, height } = readPixels(source);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = 255 - data[index];
    data[index + 1] = 255 - data[index + 1];
    data[index + 2] = 255 - data[index + 2];
  }
  return writePixels({ data, width, height });
}
