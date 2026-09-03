/**
 * GIF 编解码测试 —— 编码一组帧成 GIF，再解码回来验证往返正确。
 */

import { GIFEncoder } from "gifenc";
import { decompressFrames, parseGIF } from "gifuct-js";
import { describe, expect, it, vi } from "vitest";
import { decodeGif } from "../../src/core/codec/gif-decoder";
import type { DecodeGifOptions } from "../../src/core/codec/gif-decoder";
import { encodeGif } from "../../src/core/codec/gif-encoder";
import { createCanvas, getRuntime, setRuntime } from "../../src/core/utils/runtime";

/** 造一张纯色 canvas */
function solidCanvas(w: number, h: number, color: string) {
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  return c;
}

const DISPOSAL_PALETTE = [
  [0, 255, 0],
  [255, 0, 0],
  [0, 0, 255],
  [0, 0, 0],
];

function disposalBackgroundGif(backgroundIsTransparent: boolean): Uint8Array<ArrayBuffer> {
  const encoder = GIFEncoder();
  const transparentIndex = backgroundIsTransparent ? 0 : 3;
  encoder.writeFrame(new Uint8Array([1, 1, 1, 1]), 2, 2, {
    palette: DISPOSAL_PALETTE,
    delay: 100,
    dispose: 2,
    transparent: backgroundIsTransparent,
    transparentIndex,
  });
  encoder.writeFrame(
    new Uint8Array([2, transparentIndex, transparentIndex, transparentIndex]),
    2,
    2,
    {
      delay: 100,
      dispose: 1,
      transparent: true,
      transparentIndex,
    },
  );
  encoder.finish();
  return new Uint8Array(encoder.bytes());
}

function partialFirstFrameGif(): Uint8Array<ArrayBuffer> {
  const bytes = disposalBackgroundGif(false);
  const descriptor = bytes.indexOf(0x2c);
  if (descriptor < 0) {
    throw new Error("测试 GIF 缺少图像描述符");
  }

  // 把首帧从 2x2 改为位于 (1, 1) 的 1x1 patch；压缩数据的首个像素仍为红色。
  bytes[descriptor + 1] = 1;
  bytes[descriptor + 2] = 0;
  bytes[descriptor + 3] = 1;
  bytes[descriptor + 4] = 0;
  bytes[descriptor + 5] = 1;
  bytes[descriptor + 6] = 0;
  bytes[descriptor + 7] = 1;
  bytes[descriptor + 8] = 0;
  return bytes;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function insertBytes(
  source: Uint8Array,
  offset: number,
  insertion: Uint8Array,
): Uint8Array<ArrayBuffer> {
  return concatBytes(source.subarray(0, offset), insertion, source.subarray(offset));
}

function insertBeforeFirstImage(
  source: Uint8Array,
  insertion: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const descriptor = source.indexOf(0x2c);
  if (descriptor < 0) {
    throw new Error("测试 GIF 缺少图像描述符");
  }
  return insertBytes(source, descriptor, insertion);
}

function firstGraphicControlExtension(source: Uint8Array): number {
  for (let offset = 0; offset < source.byteLength - 1; offset += 1) {
    if (source[offset] === 0x21 && source[offset + 1] === 0xf9) {
      return offset;
    }
  }
  throw new Error("测试 GIF 缺少图形控制扩展");
}

function subBlocks(payloadBytes: number, blockSize = 255): Uint8Array<ArrayBuffer> {
  const blockCount = Math.ceil(payloadBytes / blockSize);
  const result = new Uint8Array(payloadBytes + blockCount + 1);
  let remaining = payloadBytes;
  let offset = 0;
  while (remaining > 0) {
    const size = Math.min(blockSize, remaining);
    result[offset] = size;
    result.fill(0x5a, offset + 1, offset + 1 + size);
    offset += size + 1;
    remaining -= size;
  }
  return result;
}

function commentExtension(payloadBytes: number): Uint8Array<ArrayBuffer> {
  return concatBytes(new Uint8Array([0x21, 0xfe]), subBlocks(payloadBytes));
}

function applicationExtension(payloadBytes: number, blockSize = 255): Uint8Array<ArrayBuffer> {
  const identifier = new TextEncoder().encode("MEMETEST001");
  return concatBytes(
    new Uint8Array([0x21, 0xff, identifier.byteLength]),
    identifier,
    subBlocks(payloadBytes, blockSize),
  );
}

function plainTextRecords(count: number): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(count * 4);
  for (let index = 0; index < count; index += 1) {
    const offset = index * 4;
    result[offset] = 0x21;
    result[offset + 1] = 0x01;
    // blockSize=0，紧随其后的 0 同时是 sub-block terminator。
    result[offset + 2] = 0;
    result[offset + 3] = 0;
  }
  return result;
}

function addImageDataPadding(source: Uint8Array, payloadBytes: number): Uint8Array<ArrayBuffer> {
  const descriptor = source.indexOf(0x2c);
  if (descriptor < 0) {
    throw new Error("测试 GIF 缺少图像描述符");
  }

  const packed = source[descriptor + 9];
  const localColorTableBytes = packed & 0x80 ? 3 * 2 ** ((packed & 0b0000_0111) + 1) : 0;
  let offset = descriptor + 10 + localColorTableBytes + 1;
  while (source[offset] !== 0) {
    offset += source[offset] + 1;
  }
  const padding = subBlocks(payloadBytes);
  return insertBytes(source, offset, padding.subarray(0, padding.byteLength - 1));
}

function localColorTableBackgroundGif(): Uint8Array<ArrayBuffer> {
  const source = disposalBackgroundGif(true);
  const descriptor = source.indexOf(0x2c);
  if (descriptor < 0) {
    throw new Error("测试 GIF 缺少图像描述符");
  }

  source[descriptor + 1] = 1;
  source[descriptor + 2] = 0;
  source[descriptor + 3] = 1;
  source[descriptor + 4] = 0;
  source[descriptor + 5] = 1;
  source[descriptor + 6] = 0;
  source[descriptor + 7] = 1;
  source[descriptor + 8] = 0;
  source[descriptor + 9] = (source[descriptor + 9] & 0b0111_1000) | 0b1000_0000;

  // LCT 0 是透明蓝色，LCT 1 是红色；GCT 0 仍是逻辑背景绿色。
  return insertBytes(source, descriptor + 10, new Uint8Array([0, 0, 255, 255, 0, 0]));
}

function disposalPreviousGif(): Uint8Array<ArrayBuffer> {
  const encoder = GIFEncoder();
  encoder.writeFrame(new Uint8Array([0, 0, 0, 0]), 2, 2, {
    palette: DISPOSAL_PALETTE,
    delay: 100,
    dispose: 1,
  });
  encoder.writeFrame(new Uint8Array([1, 3, 3, 3]), 2, 2, {
    delay: 100,
    dispose: 3,
    transparent: true,
    transparentIndex: 3,
  });
  encoder.writeFrame(new Uint8Array([3, 2, 3, 3]), 2, 2, {
    delay: 100,
    dispose: 1,
    transparent: true,
    transparentIndex: 3,
  });
  encoder.finish();
  return new Uint8Array(encoder.bytes());
}

async function expectRejectedBeforeParserCopy(
  source: Blob | ArrayBuffer | Uint8Array,
  options: DecodeGifOptions,
  error: RegExp,
): Promise<void> {
  const setSpy = vi.spyOn(Uint8Array.prototype, "set");
  let thrown: unknown;
  try {
    await decodeGif(source, options);
  } catch (caught) {
    thrown = caught;
  }

  try {
    expect(setSpy.mock.calls).toHaveLength(0);
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(error);
  } finally {
    setSpy.mockRestore();
  }
}

function rgbaAt(frame: ReturnType<typeof createCanvas>, x: number, y: number): number[] {
  const data = frame.getContext("2d", { willReadFrequently: true })!.getImageData(x, y, 1, 1).data;
  return Array.from(data);
}

class TrackingBlob extends Blob {
  arrayBufferCalls = 0;

  override async arrayBuffer(): Promise<ArrayBuffer> {
    this.arrayBufferCalls += 1;
    return super.arrayBuffer();
  }
}

describe("encodeGif", () => {
  it("单帧也能编码成合法 GIF", () => {
    const blob = encodeGif([solidCanvas(8, 8, "#ff0000")], { delay: 100 });
    expect(blob.type).toBe("image/gif");
    expect(blob.size).toBeGreaterThan(0);
  });

  it("多帧编码，体积随帧数增长", () => {
    const one = encodeGif([solidCanvas(16, 16, "#ff0000")], { delay: 100 });
    const three = encodeGif(
      [
        solidCanvas(16, 16, "#ff0000"),
        solidCanvas(16, 16, "#00ff00"),
        solidCanvas(16, 16, "#0000ff"),
      ],
      { delay: 100 },
    );
    expect(three.size).toBeGreaterThan(one.size);
  });

  it("空帧数组抛错", () => {
    expect(() => encodeGif([], { delay: 100 })).toThrow(/没有可编码的帧/);
  });
});

describe("encodeGif → decodeGif 往返", () => {
  it("逐帧延迟数组编码后保持每一帧的时序", async () => {
    const blob = encodeGif([solidCanvas(8, 8, "#ff0000"), solidCanvas(8, 8, "#00ff00")], {
      delay: [40, 120],
      transparent: false,
    });

    expect((await decodeGif(blob)).delays).toEqual([40, 120]);
  });

  it("帧数保持一致，尺寸正确", async () => {
    const src = [
      solidCanvas(20, 12, "#ff0000"),
      solidCanvas(20, 12, "#00ff00"),
      solidCanvas(20, 12, "#0000ff"),
    ];
    const blob = encodeGif(src, { delay: 80, transparent: false });

    const { frames, delays } = await decodeGif(blob);
    expect(frames).toHaveLength(3);
    expect(frames[0].width).toBe(20);
    expect(frames[0].height).toBe(12);
    expect(delays).toHaveLength(3);
    // 延迟约 80ms（GIF 精度是 10ms，允许误差）
    expect(delays[0]).toBeGreaterThanOrEqual(20);
  });

  it("解码后第一帧的主色接近红色", async () => {
    const blob = encodeGif([solidCanvas(16, 16, "#ff0000")], {
      delay: 100,
      transparent: false,
    });
    const { frames } = await decodeGif(blob);
    const ctx = frames[0].getContext("2d", { willReadFrequently: true })!;
    const [r, g, b] = ctx.getImageData(8, 8, 1, 1).data;
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(80);
    expect(b).toBeLessThan(80);
  });

  it("透明 GIF 会保留透明像素，且不会把黑色内容误作透明色", async () => {
    const canvas = createCanvas(32, 32);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const imageData = ctx.createImageData(32, 32);

    for (let y = 0; y < 32; y += 1) {
      for (let x = 0; x < 32; x += 1) {
        const offset = (y * 32 + x) * 4;
        imageData.data[offset] = (x * 29 + y * 7) % 256;
        imageData.data[offset + 1] = (x * 11 + y * 31) % 256;
        imageData.data[offset + 2] = (x * 17 + y * 13) % 256;
        imageData.data[offset + 3] = 255;
      }
    }
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        imageData.data[(y * 32 + x) * 4 + 3] = 0;
      }
    }
    for (let y = 12; y < 20; y += 1) {
      for (let x = 12; x < 20; x += 1) {
        const offset = (y * 32 + x) * 4;
        imageData.data[offset] = 0;
        imageData.data[offset + 1] = 0;
        imageData.data[offset + 2] = 0;
      }
    }
    ctx.putImageData(imageData, 0, 0);

    const blob = encodeGif([canvas], { delay: 100, transparent: true });
    const { frames } = await decodeGif(blob);
    const decoded = frames[0].getContext("2d", { willReadFrequently: true })!;
    const transparent = decoded.getImageData(2, 2, 1, 1).data;
    const black = decoded.getImageData(16, 16, 1, 1).data;

    expect(transparent[3]).toBe(0);
    expect(black[3]).toBe(255);
    expect(black[0] + black[1] + black[2]).toBeLessThan(40);
  });

  it("动画中完全不透明的帧不会被错误标记为透明", async () => {
    const transparentFrame = createCanvas(8, 8);
    const transparentCtx = transparentFrame.getContext("2d")!;
    transparentCtx.fillStyle = "#ff0000";
    transparentCtx.fillRect(2, 2, 4, 4);
    const opaqueFrame = solidCanvas(8, 8, "#ffffff");

    const blob = encodeGif([transparentFrame, opaqueFrame], {
      delay: 100,
      transparent: true,
    });
    const { frames } = await decodeGif(blob);
    const opaquePixel = frames[1]
      .getContext("2d", { willReadFrequently: true })!
      .getImageData(0, 0, 1, 1).data;

    expect(opaquePixel).toEqual(new Uint8ClampedArray([255, 255, 255, 255]));
  });

  it("透明帧不会显示上一帧残留的像素", async () => {
    const opaqueFrame = solidCanvas(8, 8, "#ffffff");
    const transparentFrame = createCanvas(8, 8);
    const transparentCtx = transparentFrame.getContext("2d")!;
    transparentCtx.fillStyle = "#ff0000";
    transparentCtx.fillRect(2, 2, 4, 4);

    const blob = encodeGif([opaqueFrame, transparentFrame], {
      delay: 100,
      transparent: true,
    });
    const { frames } = await decodeGif(blob);
    const transparentCorner = frames[1]
      .getContext("2d", { willReadFrequently: true })!
      .getImageData(0, 0, 1, 1).data;
    const redCenter = frames[1]
      .getContext("2d", { willReadFrequently: true })!
      .getImageData(4, 4, 1, 1).data;

    expect(transparentCorner[3]).toBe(0);
    expect(redCenter[0]).toBeGreaterThan(200);
    expect(redCenter[3]).toBe(255);
  });

  it("disposal=2 将帧区域恢复为 GCT 中的逻辑背景色", async () => {
    const bytes = disposalBackgroundGif(false);
    const parsed = parseGIF(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    const parsedFrames = decompressFrames(parsed, false);

    expect(parsed.lsd.backgroundColorIndex).toBe(0);
    expect(Array.from(parsed.gct[0])).toEqual([0, 255, 0]);
    expect(parsedFrames[0].disposalType).toBe(2);
    expect(Object.hasOwn(parsedFrames[0], "transparentIndex")).toBe(false);

    const { frames } = await decodeGif(bytes);
    expect(rgbaAt(frames[1], 0, 0)).toEqual([0, 0, 255, 255]);
    expect(rgbaAt(frames[1], 1, 1)).toEqual([0, 255, 0, 255]);
  });

  it("disposal=2 的逻辑背景索引等于真实透明索引时恢复透明", async () => {
    const bytes = disposalBackgroundGif(true);
    const parsed = parseGIF(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    const parsedFrames = decompressFrames(parsed, false);

    expect(parsed.lsd.backgroundColorIndex).toBe(0);
    expect(parsedFrames[0].transparentIndex).toBe(0);

    const { frames } = await decodeGif(bytes);
    expect(rgbaAt(frames[1], 0, 0)).toEqual([0, 0, 255, 255]);
    expect(rgbaAt(frames[1], 1, 1)).toEqual([0, 0, 0, 0]);
  });

  it("首帧为局部 patch 时先用 GCT 逻辑背景初始化完整画布", async () => {
    const bytes = partialFirstFrameGif();

    const { frames } = await decodeGif(bytes);
    expect(rgbaAt(frames[0], 0, 0)).toEqual([0, 255, 0, 255]);
    expect(rgbaAt(frames[0], 1, 1)).toEqual([255, 0, 0, 255]);
  });

  it("LCT 透明索引不影响首帧的 GCT 逻辑背景初始化", async () => {
    const bytes = localColorTableBackgroundGif();

    const { frames } = await decodeGif(bytes);
    expect(rgbaAt(frames[0], 0, 0)).toEqual([0, 255, 0, 255]);
    expect(rgbaAt(frames[0], 1, 1)).toEqual([255, 0, 0, 255]);
  });

  it("LCT 帧 disposal=2 时恢复 GCT 逻辑背景而不是透明", async () => {
    const bytes = localColorTableBackgroundGif();

    const { frames } = await decodeGif(bytes);
    expect(rgbaAt(frames[1], 0, 0)).toEqual([0, 0, 255, 255]);
    expect(rgbaAt(frames[1], 1, 1)).toEqual([0, 255, 0, 255]);
  });

  it("disposal=3 在第三帧绘制前恢复第二帧之前的完整画面", async () => {
    const { frames } = await decodeGif(disposalPreviousGif());

    expect(rgbaAt(frames[1], 0, 0)).toEqual([255, 0, 0, 255]);
    expect(rgbaAt(frames[1], 1, 1)).toEqual([0, 255, 0, 255]);
    expect(rgbaAt(frames[2], 0, 0)).toEqual([0, 255, 0, 255]);
    expect(rgbaAt(frames[2], 1, 0)).toEqual([0, 0, 255, 255]);
  });

  it("解码时拒绝超过 maxFrames 的 GIF", async () => {
    const blob = encodeGif(
      [
        solidCanvas(16, 16, "#ff0000"),
        solidCanvas(16, 16, "#00ff00"),
        solidCanvas(16, 16, "#0000ff"),
      ],
      { delay: 100, transparent: false },
    );

    await expectRejectedBeforeParserCopy(blob, { maxFrames: 2 }, /GIF 帧数过多/);
  });

  it("parseGIF 前拒绝错误的 GIF 签名或版本", async () => {
    const source = disposalBackgroundGif(false);
    source[0] = 0x42;

    await expectRejectedBeforeParserCopy(source, {}, /GIF 文件头无效/);
  });

  it("parseGIF 前拒绝非标准长度的图形控制扩展", async () => {
    const source = disposalBackgroundGif(false);
    const gceOffset = firstGraphicControlExtension(source);
    source[gceOffset + 2] = 5;

    await expectRejectedBeforeParserCopy(source, {}, /GIF 图形控制扩展无效/);
  });

  it("parseGIF 前拒绝非零终止符的图形控制扩展", async () => {
    const source = disposalBackgroundGif(false);
    const gceOffset = firstGraphicControlExtension(source);
    source[gceOffset + 7] = 1;

    await expectRejectedBeforeParserCopy(source, {}, /GIF 图形控制扩展无效/);
  });

  it("parseGIF 返回的图像帧数与预扫描不一致时拒绝继续解码", async () => {
    const source = disposalBackgroundGif(false);
    vi.doMock("gifuct-js", async () => {
      const actual = await vi.importActual<typeof import("gifuct-js")>("gifuct-js");
      return {
        ...actual,
        parseGIF(buffer: ArrayBuffer) {
          const parsed = actual.parseGIF(buffer);
          const imageFrame = parsed.frames.find((frame) => "image" in frame);
          if (!imageFrame) {
            throw new Error("测试 GIF 缺少图像帧");
          }
          return { ...parsed, frames: [...parsed.frames, imageFrame] };
        },
      };
    });
    vi.resetModules();

    try {
      const { decodeGif: decodeGifWithMockedParser } = await import(
        "../../src/core/codec/gif-decoder"
      );
      await expect(decodeGifWithMockedParser(source)).rejects.toThrow(/GIF 解析帧数不一致/);
    } finally {
      vi.doUnmock("gifuct-js");
      vi.resetModules();
    }
  });

  it("ArrayBuffer 在 parseGIF 前预留至少一份完整输入的 parser copy", async () => {
    const source = insertBeforeFirstImage(disposalBackgroundGif(false), commentExtension(4_096));

    await expectRejectedBeforeParserCopy(
      source.buffer,
      { maxMemoryBytes: source.byteLength * 2 - 1 },
      /GIF 解码内存预算超限：解析阶段/,
    );
  });

  it("Blob 在 parseGIF 前同时预留 Blob、ArrayBuffer 与 parser copy", async () => {
    const bytes = insertBeforeFirstImage(disposalBackgroundGif(false), applicationExtension(4_096));
    const source = new Blob([bytes], { type: "image/gif" });

    await expectRejectedBeforeParserCopy(
      source,
      { maxMemoryBytes: bytes.byteLength * 3 - 1 },
      /GIF 解码内存预算超限：解析阶段/,
    );
  });

  it("parseGIF 前拒绝扩展数据总量过大的 comment", async () => {
    const source = insertBeforeFirstImage(
      disposalBackgroundGif(false),
      commentExtension(1_048_577),
    );

    await expectRejectedBeforeParserCopy(source, {}, /GIF 扩展数据过大/);
  });

  it("parseGIF 前拒绝 sub-block 数量过多的 application", async () => {
    const source = insertBeforeFirstImage(
      disposalBackgroundGif(false),
      applicationExtension(131_073, 1),
    );

    await expectRejectedBeforeParserCopy(source, {}, /GIF sub-block 数量过多/);
  });

  it("parseGIF 前拒绝产生过多解析对象的 plain-text 记录", async () => {
    const source = insertBeforeFirstImage(disposalBackgroundGif(false), plainTextRecords(2_049));

    await expectRejectedBeforeParserCopy(source, {}, /GIF 记录数量过多/);
  });

  it("解码前拒绝超过总像素预算的 GIF", async () => {
    const blob = encodeGif([solidCanvas(16, 16, "#ff0000"), solidCanvas(16, 16, "#00ff00")], {
      delay: 100,
      transparent: false,
    });

    await expect(decodeGif(blob, { maxTotalPixels: 1_000 })).rejects.toThrow(
      /GIF 解码像素总量过大/,
    );
  });

  it("解码前拒绝越过逻辑画布边界的 patch", async () => {
    const blob = encodeGif([solidCanvas(8, 8, "#ff0000")], {
      delay: 100,
      transparent: false,
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const descriptor = bytes.indexOf(0x2c);
    expect(descriptor).toBeGreaterThan(0);

    // Image Descriptor: 0x2c + left(2) + top(2) + width(2) + height(2)
    bytes[descriptor + 1] = 7;
    bytes[descriptor + 2] = 0;

    await expect(decodeGif(bytes)).rejects.toThrow(/GIF patch 超出画布边界/);
  });

  it("拒绝无效的帧数预算", async () => {
    const blob = encodeGif([solidCanvas(8, 8, "#ff0000")], {
      delay: 100,
      transparent: false,
    });

    await expect(decodeGif(blob, { maxFrames: Number.NaN })).rejects.toThrow(/GIF 帧数预算无效/);
    await expect(decodeGif(blob, { maxFrames: 1.5 })).rejects.toThrow(/GIF 帧数预算无效/);
  });

  it("内存预算累计所有解压 patch 与峰值临时副本", async () => {
    const blob = encodeGif(
      [
        solidCanvas(16, 16, "#ff0000"),
        solidCanvas(16, 16, "#00ff00"),
        solidCanvas(16, 16, "#0000ff"),
      ],
      { delay: 100, transparent: false },
    );

    await expect(decodeGif(blob, { maxMemoryBytes: 8_000 })).rejects.toThrow(
      /GIF 解码内存预算超限/,
    );
  });

  it("内存预算计入 parseGIF 压缩数组与逐帧 LZW 像素数组", async () => {
    const bytes = new Uint8Array(
      await encodeGif([solidCanvas(8, 8, "#ff0000")], {
        delay: 100,
        transparent: false,
      }).arrayBuffer(),
    );
    const parsed = parseGIF(bytes.buffer);
    const imageFrames = parsed.frames.filter((frame) => "image" in frame);
    const canvasPixels = parsed.lsd.width * parsed.lsd.height;
    const patchPixels = imageFrames.reduce(
      (total, frame) => total + frame.image.descriptor.width * frame.image.descriptor.height,
      0,
    );
    const maxPatchPixels = Math.max(
      ...imageFrames.map((frame) => frame.image.descriptor.width * frame.image.descriptor.height),
    );
    const oldEstimatedMemory =
      (canvasPixels * (imageFrames.length + 3) + patchPixels + 2 * maxPatchPixels) * 4 +
      bytes.byteLength;

    await expect(decodeGif(bytes, { maxMemoryBytes: oldEstimatedMemory })).rejects.toThrow(
      /GIF 解码内存预算超限/,
    );
  });

  it("image.data.blocks 按 Uint8Array 的实际 byteLength 计入预算", async () => {
    const encoded = new Uint8Array(
      await encodeGif([solidCanvas(1, 1, "#ff0000")], {
        delay: 100,
        transparent: false,
      }).arrayBuffer(),
    );
    const source = addImageDataPadding(encoded, 256 * 1024);

    const { frames } = await decodeGif(source, { maxMemoryBytes: 1_500_000 });
    expect(frames).toHaveLength(1);
  });

  it("1x1 单帧也计入 LZW 的固定 scratch 数组峰值", async () => {
    const source = await encodeGif([solidCanvas(1, 1, "#ff0000")], {
      delay: 100,
      transparent: false,
    }).arrayBuffer();

    await expect(decodeGif(source, { maxMemoryBytes: 90_000 })).rejects.toThrow(
      /GIF 解码内存预算超限/,
    );
  });

  it("宽矮交错 patch 计入 deinterlace 的行 slice 与 concat 临时数组", async () => {
    const encoded = new Uint8Array(
      await encodeGif([solidCanvas(2_048, 1, "#ff0000")], {
        delay: 100,
        transparent: false,
      }).arrayBuffer(),
    );
    const descriptor = encoded.indexOf(0x2c);
    expect(descriptor).toBeGreaterThan(0);
    encoded[descriptor + 9] |= 0b0100_0000;

    await expect(decodeGif(encoded, { maxMemoryBytes: 215_000 })).rejects.toThrow(
      /GIF 解码内存预算超限/,
    );
  });

  it("在任何 Canvas 分配前拒绝超过边长预算的畸形 GIF", async () => {
    const blob = encodeGif([solidCanvas(8, 8, "#ff0000")], {
      delay: 100,
      transparent: false,
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    bytes[6] = 0xff;
    bytes[7] = 0xff;

    const runtime = getRuntime();
    let createCanvasCalls = 0;
    setRuntime({
      ...runtime,
      createCanvas: (width, height) => {
        createCanvasCalls += 1;
        return runtime.createCanvas(width, height);
      },
    });
    try {
      await expect(decodeGif(bytes, { maxEdge: 4096 })).rejects.toThrow(/GIF 尺寸过大/);
      expect(createCanvasCalls).toBe(0);
    } finally {
      setRuntime(runtime);
    }
  });

  it("Blob 的输入缓冲峰值超过预算时不读取内容", async () => {
    const source = new TrackingBlob([new Uint8Array(32)], { type: "image/gif" });

    await expect(decodeGif(source, { maxMemoryBytes: 63 })).rejects.toThrow(
      /GIF 输入缓冲内存预算超限：需要 64 字节，最多支持 63/,
    );
    expect(source.arrayBufferCalls).toBe(0);
  });

  it("部分 Uint8Array 视图的 backing 与复制峰值超限时不执行 slice", async () => {
    const encoded = new Uint8Array(
      await encodeGif([solidCanvas(8, 8, "#ff0000")], {
        delay: 100,
        transparent: false,
      }).arrayBuffer(),
    );
    const backing = new ArrayBuffer(encoded.byteLength + 16);
    const source = new Uint8Array(backing, 8, encoded.byteLength);
    source.set(encoded);
    const compressedPeak = backing.byteLength + source.byteLength;
    const sliceSpy = vi.spyOn(ArrayBuffer.prototype, "slice");

    try {
      await expect(decodeGif(source, { maxMemoryBytes: compressedPeak - 1 })).rejects.toThrow(
        /GIF 输入缓冲内存预算超限/,
      );
      expect(sliceSpy).not.toHaveBeenCalled();
    } finally {
      sliceSpy.mockRestore();
    }
  });

  it("完整覆盖 ArrayBuffer 的 Uint8Array 直接复用底层缓冲", async () => {
    const buffer = await encodeGif([solidCanvas(8, 8, "#ff0000")], {
      delay: 100,
      transparent: false,
    }).arrayBuffer();
    const source = new Uint8Array(buffer);
    const sliceSpy = vi.spyOn(ArrayBuffer.prototype, "slice");

    try {
      const { frames } = await decodeGif(source);
      expect(frames).toHaveLength(1);
      expect(sliceSpy).not.toHaveBeenCalled();
    } finally {
      sliceSpy.mockRestore();
    }
  });

  it("RGBA 旧估算有余量但未包含压缩输入时仍拒绝", async () => {
    const buffer = await encodeGif([solidCanvas(8, 8, "#ff0000")], {
      delay: 100,
      transparent: false,
    }).arrayBuffer();
    const canvasPixels = 8 * 8;
    const oldRgbaEstimate = (canvasPixels * (1 + 3) + canvasPixels + 2 * canvasPixels) * 4;

    expect(oldRgbaEstimate).toBe(1_792);
    expect(buffer.byteLength).toBeLessThan(oldRgbaEstimate);
    await expect(decodeGif(buffer, { maxMemoryBytes: oldRgbaEstimate })).rejects.toThrow(
      /GIF 解码内存预算超限/,
    );
  });

  it.each<[name: string, options: DecodeGifOptions, error: RegExp]>([
    ["帧数", { maxFrames: Number.MAX_SAFE_INTEGER + 1 }, /GIF 帧数预算无效/],
    ["边长", { maxEdge: Number.MAX_SAFE_INTEGER + 1 }, /GIF 边长预算无效/],
    ["总像素", { maxTotalPixels: 1.5 }, /GIF 总像素预算无效/],
    ["内存", { maxMemoryBytes: Number.POSITIVE_INFINITY }, /GIF 内存预算无效/],
  ])("%s预算无效时在读取 Blob 前拒绝", async (_name, options, error) => {
    const validGif = await encodeGif([solidCanvas(2, 2, "#ff0000")], {
      delay: 100,
      transparent: false,
    }).arrayBuffer();
    const source = new TrackingBlob([validGif], { type: "image/gif" });

    await expect(decodeGif(source, options)).rejects.toThrow(error);
    expect(source.arrayBufferCalls).toBe(0);
  });
});
