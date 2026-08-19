/**
 * GIF 解码 —— 把 GIF 数据解码成逐帧 Canvas。
 *
 * 用 gifuct-js 解析，然后正确地按「处置方式」合成每一帧。
 *
 * 解码过程维护一张完整尺寸的画布，逐帧叠加 patch 并处理 disposal，
 * 因此只更新局部区域的 GIF 帧也能得到完整画面。
 */

import { decompressFrame, parseGIF } from "gifuct-js";
import { MAX_MEDIA_EDGE } from "../limits";
import { createCanvas } from "../utils/runtime";
import type { RuntimeCanvas, RuntimeContext } from "../utils/runtime";

export interface DecodedGif {
  readonly frames: RuntimeCanvas[];
  /** 每帧延迟（毫秒），逐帧 */
  readonly delays: number[];
}

export interface DecodeGifOptions {
  readonly maxFrames?: number;
  readonly maxEdge?: number;
  /** 所有逻辑帧画布与 patch 的像素预算。 */
  readonly maxTotalPixels?: number;
  /** 解码期间估算的 RGBA 内存预算。 */
  readonly maxMemoryBytes?: number;
}

export const DEFAULT_MAX_GIF_FRAMES = 120;
export const DEFAULT_MAX_GIF_TOTAL_PIXELS = 512 * 4_096 * 4_096;
export const DEFAULT_MAX_GIF_MEMORY_BYTES = 512 * 1024 * 1024;

const MAX_GIF_EXTENSION_BYTES = 1024 * 1024;
const MAX_GIF_SUB_BLOCKS = 128 * 1024;
const MAX_GIF_RECORDS = 2_048;
const GIF_JS_ARRAY_ELEMENT_BYTES = 8;
const GIF_PARSER_RECORD_OVERHEAD_BYTES = 256;
const GIF_PARSER_SUB_BLOCK_OVERHEAD_BYTES = 64;
const GIF_PARSER_COLOR_ENTRY_OVERHEAD_BYTES = 32;
const GIF_LZW_TABLE_ENTRIES = 4_096 + 4_096 + 4_097;

interface GifPreflightStats {
  readonly imageFrameCount: number;
  readonly extensionDataBytes: number;
  readonly parserStructureBytes: number;
}

function checkedAdd(left: number, right: number, errorMessage: string): number {
  if (
    !Number.isSafeInteger(left) ||
    !Number.isSafeInteger(right) ||
    left < 0 ||
    right < 0 ||
    left > Number.MAX_SAFE_INTEGER - right
  ) {
    throw new Error(errorMessage);
  }
  return left + right;
}

function checkedMultiply(left: number, right: number, errorMessage: string): number {
  if (
    !Number.isSafeInteger(left) ||
    !Number.isSafeInteger(right) ||
    left < 0 ||
    right < 0 ||
    (left !== 0 && right > Math.floor(Number.MAX_SAFE_INTEGER / left))
  ) {
    throw new Error(errorMessage);
  }
  return left * right;
}

function checkedSum(values: readonly number[], errorMessage: string): number {
  let total = 0;
  for (const value of values) {
    total = checkedAdd(total, value, errorMessage);
  }
  return total;
}

function requireBytes(
  bytes: Uint8Array,
  offset: number,
  length: number,
  errorMessage = "GIF 数据不完整",
): number {
  const end = checkedAdd(offset, length, "GIF 预扫描偏移超出安全整数范围");
  if (end > bytes.byteLength) {
    throw new Error(errorMessage);
  }
  return end;
}

function scanGifBeforeParse(
  buffer: ArrayBuffer,
  maxFrames: number,
  maxEdge: number,
  maxTotalPixels: number,
): GifPreflightStats {
  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength < 13) {
    throw new Error("GIF 数据不完整");
  }
  const isGif87a =
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    bytes[4] === 0x37 &&
    bytes[5] === 0x61;
  const isGif89a =
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    bytes[4] === 0x39 &&
    bytes[5] === 0x61;
  if (!isGif87a && !isGif89a) {
    throw new Error("GIF 文件头无效：仅支持 GIF87a 或 GIF89a");
  }

  const scanOverflow = "GIF 预扫描预算计算超出安全整数范围";
  const width = bytes[6] | (bytes[7] << 8);
  const height = bytes[8] | (bytes[9] << 8);
  if (width <= 0 || height <= 0) {
    throw new Error(`GIF 画布尺寸无效：${width}x${height}`);
  }
  if (width > maxEdge || height > maxEdge) {
    throw new Error(`GIF 尺寸过大：${width}x${height}，最大边长 ${maxEdge}px`);
  }
  const canvasPixels = checkedMultiply(width, height, scanOverflow);
  let offset = 13;
  let imageFrameCount = 0;
  let patchPixels = 0;
  let recordCount = 0;
  let subBlockCount = 0;
  let extensionDataBytes = 0;
  let colorTableEntries = 0;

  const addColorTable = (packed: number): void => {
    if ((packed & 0b1000_0000) === 0) {
      return;
    }
    const entries = 2 ** ((packed & 0b0000_0111) + 1);
    colorTableEntries = checkedAdd(colorTableEntries, entries, scanOverflow);
    offset = requireBytes(bytes, offset, checkedMultiply(entries, 3, scanOverflow));
  };

  const addExtensionBytes = (length: number): void => {
    extensionDataBytes = checkedAdd(extensionDataBytes, length, scanOverflow);
    if (extensionDataBytes > MAX_GIF_EXTENSION_BYTES) {
      throw new Error(
        `GIF 扩展数据过大：${extensionDataBytes} 字节，最多支持 ${MAX_GIF_EXTENSION_BYTES}`,
      );
    }
  };

  const scanSubBlocks = (isExtension: boolean): void => {
    while (true) {
      offset = requireBytes(bytes, offset, 1);
      const size = bytes[offset - 1];
      if (size === 0) {
        return;
      }

      subBlockCount = checkedAdd(subBlockCount, 1, scanOverflow);
      if (subBlockCount > MAX_GIF_SUB_BLOCKS) {
        throw new Error(`GIF sub-block 数量过多：${subBlockCount}，最多支持 ${MAX_GIF_SUB_BLOCKS}`);
      }
      offset = requireBytes(bytes, offset, size);
      if (isExtension) {
        addExtensionBytes(size);
      }
    }
  };

  addColorTable(bytes[10]);

  while (offset < bytes.byteLength) {
    const code = bytes[offset];
    if (code === 0x3b) {
      break;
    }
    if (code !== 0x21 && code !== 0x2c) {
      break;
    }

    recordCount = checkedAdd(recordCount, 1, scanOverflow);
    if (recordCount > MAX_GIF_RECORDS) {
      throw new Error(`GIF 记录数量过多：${recordCount}，最多支持 ${MAX_GIF_RECORDS}`);
    }

    if (code === 0x2c) {
      imageFrameCount = checkedAdd(imageFrameCount, 1, scanOverflow);
      if (imageFrameCount > maxFrames) {
        throw new Error(`GIF 帧数过多：${imageFrameCount} 帧，最多支持 ${maxFrames} 帧`);
      }
      const descriptorEnd = requireBytes(bytes, offset, 10);
      const left = bytes[offset + 1] | (bytes[offset + 2] << 8);
      const top = bytes[offset + 3] | (bytes[offset + 4] << 8);
      const patchWidth = bytes[offset + 5] | (bytes[offset + 6] << 8);
      const patchHeight = bytes[offset + 7] | (bytes[offset + 8] << 8);
      if (
        patchWidth <= 0 ||
        patchHeight <= 0 ||
        checkedAdd(left, patchWidth, "GIF patch 边界计算超出安全整数范围") > width ||
        checkedAdd(top, patchHeight, "GIF patch 边界计算超出安全整数范围") > height
      ) {
        throw new Error("GIF patch 超出画布边界");
      }
      patchPixels = checkedAdd(
        patchPixels,
        checkedMultiply(patchWidth, patchHeight, scanOverflow),
        scanOverflow,
      );
      const packed = bytes[offset + 9];
      offset = descriptorEnd;
      addColorTable(packed);
      offset = requireBytes(bytes, offset, 1);
      scanSubBlocks(false);
      continue;
    }

    requireBytes(bytes, offset, 2);
    const extensionLabel = bytes[offset + 1];
    if (extensionLabel === 0xf9) {
      const recordEnd = requireBytes(bytes, offset, 8);
      const blockSize = bytes[offset + 2];
      const terminator = bytes[offset + 7];
      if (blockSize !== 4 || terminator !== 0) {
        throw new Error("GIF 图形控制扩展无效：数据块长度必须为 4 且终止符必须为 0");
      }
      addExtensionBytes(4);
      offset = recordEnd;
      continue;
    }
    if (extensionLabel === 0xfe) {
      offset += 2;
      scanSubBlocks(true);
      continue;
    }
    if (extensionLabel === 0xff || extensionLabel === 0x01) {
      offset = requireBytes(bytes, offset, 3);
      const blockSize = bytes[offset - 1];
      addExtensionBytes(blockSize);
      offset = requireBytes(bytes, offset, blockSize);
      scanSubBlocks(true);
      continue;
    }

    throw new Error(`GIF 扩展类型不支持：0x${extensionLabel.toString(16)}`);
  }

  if (imageFrameCount === 0) {
    throw new Error("GIF 没有可解码的帧");
  }
  const totalPixels = checkedAdd(
    checkedMultiply(canvasPixels, imageFrameCount, scanOverflow),
    patchPixels,
    scanOverflow,
  );
  if (totalPixels > maxTotalPixels) {
    throw new Error(`GIF 解码像素总量过大：${totalPixels}，最多支持 ${maxTotalPixels}`);
  }

  const parserStructureBytes = checkedSum(
    [
      checkedMultiply(recordCount, GIF_PARSER_RECORD_OVERHEAD_BYTES, scanOverflow),
      checkedMultiply(subBlockCount, GIF_PARSER_SUB_BLOCK_OVERHEAD_BYTES, scanOverflow),
      checkedMultiply(colorTableEntries, GIF_PARSER_COLOR_ENTRY_OVERHEAD_BYTES, scanOverflow),
    ],
    scanOverflow,
  );
  return { imageFrameCount, extensionDataBytes, parserStructureBytes };
}

function assertPositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`GIF ${label}预算无效：${value}`);
  }
}

function assertInputMemoryBudget(compressedPeakBytes: number, maxMemoryBytes: number): void {
  if (compressedPeakBytes > maxMemoryBytes) {
    throw new Error(
      `GIF 输入缓冲内存预算超限：需要 ${compressedPeakBytes} 字节，最多支持 ${maxMemoryBytes}`,
    );
  }
}

async function prepareInputBuffer(
  source: Blob | ArrayBuffer | Uint8Array,
  maxMemoryBytes: number,
): Promise<{ buffer: ArrayBuffer; compressedPeakBytes: number }> {
  const inputOverflow = "GIF 输入缓冲内存预算超限：压缩输入驻留峰值超出安全整数范围";

  if (source instanceof Blob) {
    const compressedPeakBytes = checkedMultiply(source.size, 2, inputOverflow);
    assertInputMemoryBudget(compressedPeakBytes, maxMemoryBytes);
    return { buffer: await source.arrayBuffer(), compressedPeakBytes };
  }

  if (source instanceof Uint8Array) {
    const backing = source.buffer;
    if (
      backing instanceof ArrayBuffer &&
      source.byteOffset === 0 &&
      source.byteLength === backing.byteLength
    ) {
      const compressedPeakBytes = backing.byteLength;
      assertInputMemoryBudget(compressedPeakBytes, maxMemoryBytes);
      return { buffer: backing, compressedPeakBytes };
    }

    const compressedPeakBytes = checkedAdd(backing.byteLength, source.byteLength, inputOverflow);
    assertInputMemoryBudget(compressedPeakBytes, maxMemoryBytes);
    if (backing instanceof ArrayBuffer) {
      const viewEnd = checkedAdd(source.byteOffset, source.byteLength, inputOverflow);
      return {
        buffer: backing.slice(source.byteOffset, viewEnd),
        compressedPeakBytes,
      };
    }

    // SharedArrayBuffer 等非普通底层缓冲无法直接传给 parseGIF，只复制当前视图。
    const copy = new Uint8Array(source.byteLength);
    copy.set(source);
    return { buffer: copy.buffer, compressedPeakBytes };
  }

  const compressedPeakBytes = source.byteLength;
  assertInputMemoryBudget(compressedPeakBytes, maxMemoryBytes);
  return { buffer: source, compressedPeakBytes };
}

/**
 * 通过像素数据创建独立快照，避免 Canvas 后续清空时影响 GIF 帧处置所需的历史画面。
 */
function snapshotCanvas(source: RuntimeCanvas): RuntimeCanvas {
  const snapshot = createCanvas(source.width, source.height);
  const sourceCtx = source.getContext("2d", { willReadFrequently: true }) as RuntimeContext;
  const snapshotCtx = snapshot.getContext("2d") as RuntimeContext;
  snapshotCtx.putImageData(sourceCtx.getImageData(0, 0, source.width, source.height), 0, 0);
  return snapshot;
}

/**
 * 解码 GIF。source 可以是 Blob、ArrayBuffer 或 Uint8Array。
 */
export async function decodeGif(
  source: Blob | ArrayBuffer | Uint8Array,
  options: DecodeGifOptions = {},
): Promise<DecodedGif> {
  const maxFrames = options.maxFrames ?? DEFAULT_MAX_GIF_FRAMES;
  const maxTotalPixels = options.maxTotalPixels ?? DEFAULT_MAX_GIF_TOTAL_PIXELS;
  const maxMemoryBytes = options.maxMemoryBytes ?? DEFAULT_MAX_GIF_MEMORY_BYTES;
  const maxEdge = options.maxEdge ?? MAX_MEDIA_EDGE;
  assertPositiveSafeInteger(maxFrames, "帧数");
  assertPositiveSafeInteger(maxEdge, "边长");
  assertPositiveSafeInteger(maxTotalPixels, "总像素");
  assertPositiveSafeInteger(maxMemoryBytes, "内存");

  const { buffer, compressedPeakBytes } = await prepareInputBuffer(source, maxMemoryBytes);
  const preflight = scanGifBeforeParse(buffer, maxFrames, maxEdge, maxTotalPixels);
  const parserMemoryOverflow = "GIF 解码内存预算超限：解析阶段估算值超出安全整数范围";
  const parserPeakMemory = checkedSum(
    [compressedPeakBytes, buffer.byteLength, preflight.parserStructureBytes],
    parserMemoryOverflow,
  );
  if (parserPeakMemory > maxMemoryBytes) {
    throw new Error(
      `GIF 解码内存预算超限：解析阶段需要 ${parserPeakMemory}，最多支持 ${maxMemoryBytes}`,
    );
  }

  const gif = parseGIF(buffer);
  const imageFrameCount = preflight.imageFrameCount;
  const width = gif.lsd.width;
  const height = gif.lsd.height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`GIF 画布尺寸无效：${width}x${height}`);
  }
  if (width > maxEdge || height > maxEdge) {
    throw new Error(`GIF 尺寸过大：${width}x${height}，最大边长 ${maxEdge}px`);
  }
  const pixelOverflow = "GIF 解码像素预算计算超出安全整数范围";
  const memoryOverflow = "GIF 解码内存预算超限：估算值超出安全整数范围";
  const canvasPixels = checkedMultiply(width, height, pixelOverflow);
  if (canvasPixels > DEFAULT_MAX_GIF_TOTAL_PIXELS) {
    throw new Error(`GIF 画布像素过大：${canvasPixels}`);
  }
  const imageFrames = gif.frames.filter((frame) => "image" in frame);
  if (imageFrames.length !== imageFrameCount) {
    throw new Error(
      `GIF 解析帧数不一致：预扫描得到 ${imageFrameCount} 帧，解析得到 ${imageFrames.length} 帧`,
    );
  }
  if (imageFrames.length > maxFrames) {
    throw new Error(`GIF 帧数过多：${imageFrames.length} 帧，最多支持 ${maxFrames} 帧`);
  }
  let patchPixels = 0;
  let maxPatchPixels = 0;
  let maxInterlacedPatchPixels = 0;
  let maxInterlacedPatchWidth = 0;
  let compressedBlockBytes = 0;
  for (const frame of imageFrames) {
    const { left, top, width: patchWidth, height: patchHeight } = frame.image.descriptor;
    if (
      !Number.isInteger(left) ||
      !Number.isInteger(top) ||
      !Number.isInteger(patchWidth) ||
      !Number.isInteger(patchHeight) ||
      patchWidth <= 0 ||
      patchHeight <= 0 ||
      left < 0 ||
      top < 0 ||
      checkedAdd(left, patchWidth, "GIF patch 边界计算超出安全整数范围") > width ||
      checkedAdd(top, patchHeight, "GIF patch 边界计算超出安全整数范围") > height
    ) {
      throw new Error("GIF patch 超出画布边界");
    }
    const pixels = checkedMultiply(patchWidth, patchHeight, pixelOverflow);
    patchPixels = checkedAdd(patchPixels, pixels, pixelOverflow);
    maxPatchPixels = Math.max(maxPatchPixels, pixels);
    if (frame.image.descriptor.lct.interlaced) {
      maxInterlacedPatchPixels = Math.max(maxInterlacedPatchPixels, pixels);
      maxInterlacedPatchWidth = Math.max(maxInterlacedPatchWidth, patchWidth);
    }
    const blocks = frame.image.data.blocks as number[] | Uint8Array;
    compressedBlockBytes = checkedAdd(
      compressedBlockBytes,
      blocks instanceof Uint8Array ? blocks.byteLength : blocks.length,
      memoryOverflow,
    );
  }
  const totalPixels = checkedAdd(
    checkedMultiply(canvasPixels, imageFrameCount, pixelOverflow),
    patchPixels,
    pixelOverflow,
  );
  if (totalPixels > maxTotalPixels) {
    throw new Error(`GIF 解码像素总量过大：${totalPixels}，最多支持 ${maxTotalPixels}`);
  }
  const rgbaPixels = checkedAdd(
    checkedMultiply(canvasPixels, checkedAdd(imageFrameCount, 3, memoryOverflow), memoryOverflow),
    checkedMultiply(maxPatchPixels, 3, memoryOverflow),
    memoryOverflow,
  );
  const rgbaMemoryBytes = checkedMultiply(rgbaPixels, 4, memoryOverflow);
  const lzwPixelsMemoryBytes = checkedMultiply(
    maxPatchPixels,
    GIF_JS_ARRAY_ELEMENT_BYTES,
    memoryOverflow,
  );
  const lzwFixedScratchBytes = checkedMultiply(
    GIF_LZW_TABLE_ENTRIES,
    GIF_JS_ARRAY_ELEMENT_BYTES,
    memoryOverflow,
  );
  const deinterlaceMemoryBytes = checkedMultiply(
    maxInterlacedPatchPixels,
    GIF_JS_ARRAY_ELEMENT_BYTES,
    memoryOverflow,
  );
  const deinterlaceRowElements =
    maxInterlacedPatchWidth === 0
      ? 0
      : checkedAdd(checkedMultiply(maxInterlacedPatchWidth, 2, memoryOverflow), 2, memoryOverflow);
  const deinterlaceRowMemoryBytes = checkedMultiply(
    deinterlaceRowElements,
    GIF_JS_ARRAY_ELEMENT_BYTES,
    memoryOverflow,
  );
  const estimatedMemory = checkedSum(
    [
      compressedPeakBytes,
      preflight.extensionDataBytes,
      preflight.parserStructureBytes,
      compressedBlockBytes,
      rgbaMemoryBytes,
      lzwPixelsMemoryBytes,
      lzwFixedScratchBytes,
      deinterlaceMemoryBytes,
      deinterlaceRowMemoryBytes,
    ],
    memoryOverflow,
  );
  if (estimatedMemory > maxMemoryBytes) {
    throw new Error(`GIF 解码内存预算超限：${estimatedMemory}，最多支持 ${maxMemoryBytes}`);
  }

  // 逻辑屏幕尺寸 = 完整画面尺寸
  const full = createCanvas(width, height);
  const fullCtx = full.getContext("2d", { willReadFrequently: true }) as RuntimeContext;
  const backgroundColorIndex = gif.lsd.backgroundColorIndex;
  const backgroundColor =
    gif.lsd.gct.exists &&
    Number.isInteger(backgroundColorIndex) &&
    backgroundColorIndex >= 0 &&
    backgroundColorIndex < gif.gct.length
      ? gif.gct[backgroundColorIndex]
      : null;

  const frames: RuntimeCanvas[] = [];
  const delays: number[] = [];

  // 用于 disposalType===3（恢复到上一帧）
  let previousSnapshot: RuntimeCanvas | null = null;
  let isLogicalScreenInitialized = false;

  // 必须在所有预算检查完成后再逐帧解压，避免同时保留所有帧的 pixels 与 RGBA patch。
  for (const rawFrame of imageFrames) {
    const frame = decompressFrame(rawFrame, gif.gct, true);
    const { dims, disposalType, delay } = frame;
    const transparentIndex =
      Object.hasOwn(frame, "transparentIndex") && Number.isInteger(frame.transparentIndex)
        ? frame.transparentIndex
        : undefined;
    const logicalBackgroundIsTransparent =
      !rawFrame.image.descriptor.lct.exists && backgroundColorIndex === transparentIndex;

    if (!isLogicalScreenInitialized) {
      if (backgroundColor && !logicalBackgroundIsTransparent) {
        fullCtx.fillStyle = `rgb(${backgroundColor[0]}, ${backgroundColor[1]}, ${backgroundColor[2]})`;
        fullCtx.fillRect(0, 0, width, height);
      }
      isLogicalScreenInitialized = true;
    }

    // `disposalType === 3`：先保存当前完整画面，供本帧渲染后恢复。
    if (disposalType === 3) {
      previousSnapshot = snapshotCanvas(full);
    }

    // 把本帧的 patch 画到完整画布的正确位置
    const patch = createCanvas(dims.width, dims.height);
    const patchCtx = patch.getContext("2d") as RuntimeContext;
    // 用 createImageData 而非 new ImageData()，浏览器/Node 都兼容
    const imgData = patchCtx.createImageData(dims.width, dims.height);
    imgData.data.set(frame.patch);
    patchCtx.putImageData(imgData, 0, 0);
    fullCtx.drawImage(patch, dims.left, dims.top);

    // 快照当前完整画面作为这一帧的成品
    frames.push(snapshotCanvas(full));
    // gifuct 的 `delay` 单位是毫秒（已换算），下限设为 20 毫秒以避免零延迟。
    delays.push(Math.max(20, delay || 100));

    // 处理处置方式，为下一帧准备画布
    if (disposalType === 2) {
      if (backgroundColor && !logicalBackgroundIsTransparent) {
        fullCtx.fillStyle = `rgb(${backgroundColor[0]}, ${backgroundColor[1]}, ${backgroundColor[2]})`;
        fullCtx.fillRect(dims.left, dims.top, dims.width, dims.height);
      } else {
        fullCtx.clearRect(dims.left, dims.top, dims.width, dims.height);
      }
    } else if (disposalType === 3 && previousSnapshot) {
      // 恢复到上一帧
      fullCtx.clearRect(0, 0, width, height);
      fullCtx.drawImage(previousSnapshot, 0, 0);
    }
    // `disposalType` 为 0 或 1：保留当前画面，不做处理。
  }

  return { frames, delays };
}
