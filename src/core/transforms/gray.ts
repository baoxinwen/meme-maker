/**
 * 灰度化。
 *
 * 用 Canvas 2D 的 filter 属性（CSS filter）实现。
 * 浏览器与 @napi-rs/canvas 都支持 `filter = "grayscale(100%)"`。
 */

import { luminance601, readPixels, writePixels } from "../utils/pixel";
import { createCanvas } from "../utils/runtime";
import type { RuntimeCanvas, RuntimeContext, RuntimeImage } from "../utils/runtime";

export function grayImage(source: RuntimeImage | RuntimeCanvas): RuntimeCanvas {
  // 优先用 CSS filter（浏览器原生支持）
  const canvas = createCanvas(source.width, source.height);
  const ctx = canvas.getContext("2d") as RuntimeContext;
  if (typeof ctx.filter === "string") {
    ctx.filter = "grayscale(100%)";
    ctx.drawImage(source, 0, 0);
    return canvas;
  }

  // 像素级回退（用 ITU-R BT.601 加权平均）
  const { data, width, height } = readPixels(source);
  for (let i = 0; i < data.length; i += 4) {
    const gray = luminance601(data[i], data[i + 1], data[i + 2]);
    data[i] = data[i + 1] = data[i + 2] = gray;
  }
  return writePixels({ data, width, height });
}
