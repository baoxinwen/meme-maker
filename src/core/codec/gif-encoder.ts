/**
 * GIF 编码 —— 把一组 Canvas 帧编码成 GIF Blob。
 *
 * 使用 gifenc：
 *   - 纯 JS、无 Worker、体积小、维护活跃
 *   - 支持透明度（rgba4444 量化）
 */

import { GIFEncoder, applyPalette, quantize } from "gifenc";
import type { RuntimeCanvas, RuntimeContext } from "../utils/runtime";

export interface GifEncodeOptions {
  /** 统一延迟或与输出帧一一对应的逐帧延迟（毫秒） */
  readonly delay: number | readonly number[];
  /** 量化颜色数上限（2-256），越大质量越高、体积越大 */
  readonly maxColors?: number;
  /** 是否保留透明度 */
  readonly transparent?: boolean;
  /** 循环次数，0 = 无限循环（默认） */
  readonly repeat?: number;
}

const TRANSPARENT_INDEX = 0;
const ALPHA_THRESHOLD = 127;

interface IndexedGifFrame {
  readonly palette: number[][];
  readonly index: Uint8Array;
}

/**
 * GIF 只有一个 1-bit 透明索引，不能直接使用包含 alpha 的调色板。
 * 保留索引 0 给透明像素，其余颜色用 RGB565 量化，避免普通颜色被误标为透明。
 */
function indexFrame(
  data: Uint8ClampedArray,
  maxColors: number,
  transparent: boolean,
): IndexedGifFrame {
  const colorLimit = Math.max(2, Math.min(256, Math.floor(maxColors)));
  if (!transparent) {
    const palette = quantize(data, colorLimit, { format: "rgb565" });
    return { palette, index: applyPalette(data, palette, "rgb565") };
  }

  let opaqueCount = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > ALPHA_THRESHOLD) opaqueCount += 1;
  }

  if (opaqueCount === 0) {
    return {
      palette: [[0, 0, 0]],
      index: new Uint8Array(data.length / 4),
    };
  }

  if (opaqueCount === data.length / 4) {
    const palette = quantize(data, colorLimit - 1, { format: "rgb565" });
    const index = applyPalette(data, palette, "rgb565");
    for (let pixel = 0; pixel < index.length; pixel += 1) {
      index[pixel] += 1;
    }
    return { palette: [[0, 0, 0], ...palette], index };
  }

  const opaquePixels = new Uint8ClampedArray(opaqueCount * 4);
  let writeOffset = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] <= ALPHA_THRESHOLD) continue;
    opaquePixels[writeOffset] = data[i];
    opaquePixels[writeOffset + 1] = data[i + 1];
    opaquePixels[writeOffset + 2] = data[i + 2];
    opaquePixels[writeOffset + 3] = 255;
    writeOffset += 4;
  }

  const opaquePalette = quantize(opaquePixels, colorLimit - 1, { format: "rgb565" });
  const index = applyPalette(data, opaquePalette, "rgb565");
  for (let pixel = 0; pixel < index.length; pixel += 1) {
    index[pixel] = data[pixel * 4 + 3] <= ALPHA_THRESHOLD ? TRANSPARENT_INDEX : index[pixel] + 1;
  }

  return {
    palette: [[0, 0, 0], ...opaquePalette],
    index,
  };
}

/**
 * 把逐帧 Canvas 编码为 GIF。
 */
export function encodeGif(frames: readonly RuntimeCanvas[], options: GifEncodeOptions): Blob {
  if (frames.length === 0) {
    throw new Error("没有可编码的帧");
  }

  const { delay, maxColors = 256, transparent = true, repeat = 0 } = options;
  const delays = typeof delay === "number" ? frames.map(() => delay) : [...delay];
  if (delays.length !== frames.length) {
    throw new Error(`GIF 逐帧延迟数量不匹配：收到 ${delays.length} 个，帧数为 ${frames.length}`);
  }
  if (delays.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error("GIF 帧延迟必须是大于 0 的有限数值");
  }
  const gif = GIFEncoder();

  for (const [frameIndex, frame] of frames.entries()) {
    const ctx = frame.getContext("2d", {
      willReadFrequently: true,
    }) as RuntimeContext;
    const { data, width, height } = ctx.getImageData(0, 0, frame.width, frame.height);

    const indexedFrame = indexFrame(data, maxColors, transparent);

    gif.writeFrame(indexedFrame.index, width, height, {
      palette: indexedFrame.palette,
      delay: Math.max(20, Math.round(delays[frameIndex])),
      repeat,
      transparent,
      transparentIndex: TRANSPARENT_INDEX,
      // `dispose=2`：每帧渲染后恢复透明背景，避免下一帧的透明区域残留旧画面。
      dispose: transparent ? 2 : -1,
    });
  }

  gif.finish();
  // `bytesView` 返回内部缓冲区的视图，这里复制成独立 Blob。
  const bytes = new Uint8Array(gif.bytes());
  return new Blob([bytes], { type: "image/gif" });
}
