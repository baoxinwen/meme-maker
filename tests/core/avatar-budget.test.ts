import type { Canvas as NCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";

import {
  createCanvas,
  encodeGif,
  getRuntime,
  parseTemplate,
  prepareScene,
  setRuntime,
} from "../../src/core";
import { prepareAvatar } from "../../src/core/renderer/avatar";
import type { AvatarTemplate } from "../../src/core/schema/template";

function pngBlob(width: number, height: number): Blob {
  const canvas = createCanvas(width, height) as unknown as NCanvas;
  return new Blob([new Uint8Array(canvas.toBuffer("image/png"))], { type: "image/png" });
}

function encodedImageBlob(
  width: number,
  height: number,
  type: "image/png" | "image/jpeg" | "image/webp",
): Blob {
  const canvas = createCanvas(width, height) as unknown as NCanvas;
  const buffer = type === "image/png" ? canvas.toBuffer(type) : canvas.toBuffer(type);
  return new Blob([new Uint8Array(buffer)], { type });
}

function pngHeader(width: number, height: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes.set([8, 6, 0, 0, 0], 24);
  return bytes;
}

function jpegHeader(width: number, height: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(21);
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 8]);
  const view = new DataView(bytes.buffer);
  view.setUint16(7, height);
  view.setUint16(9, width);
  bytes[11] = 3;
  bytes.set([1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0], 12);
  return bytes;
}

function webpHeader(
  width: number,
  height: number,
  format: "VP8 " | "VP8L" | "VP8X",
): Uint8Array<ArrayBuffer> {
  const chunkSize = format === "VP8L" ? 5 : 10;
  const paddedChunkSize = chunkSize + (chunkSize & 1);
  const bytes = new Uint8Array(20 + paddedChunkSize);
  bytes.set([0x52, 0x49, 0x46, 0x46]);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, bytes.length - 8, true);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  bytes.set(
    [...format].map((char) => char.charCodeAt(0)),
    12,
  );
  view.setUint32(16, chunkSize, true);
  if (format === "VP8X") {
    const widthMinusOne = width - 1;
    const heightMinusOne = height - 1;
    bytes.set(
      [
        0,
        0,
        0,
        0,
        widthMinusOne & 0xff,
        (widthMinusOne >>> 8) & 0xff,
        (widthMinusOne >>> 16) & 0xff,
        heightMinusOne & 0xff,
        (heightMinusOne >>> 8) & 0xff,
        (heightMinusOne >>> 16) & 0xff,
      ],
      20,
    );
  } else if (format === "VP8L") {
    const packed = (width - 1) | ((height - 1) << 14);
    bytes[20] = 0x2f;
    view.setUint32(21, packed, true);
  } else {
    bytes.set([0, 0, 0, 0x9d, 0x01, 0x2a], 20);
    view.setUint16(26, width, true);
    view.setUint16(28, height, true);
  }
  return bytes;
}

class TrackingBlob extends Blob {
  bytesRead = 0;

  override slice(start?: number, end?: number, contentType?: string): Blob {
    const sliced = super.slice(start, end, contentType);
    const read = sliced.arrayBuffer.bind(sliced);
    Object.defineProperty(sliced, "arrayBuffer", {
      value: async () => {
        this.bytesRead += sliced.size;
        return read();
      },
    });
    return sliced;
  }
}

function staticAvatarTemplate(): AvatarTemplate {
  return { type: "TO", pos: [0, 0, 1, 1] };
}

function userCycleTemplate() {
  return parseTemplate({
    type: "IMG",
    background: { size: [1, 1], color: "#ffffff" },
    avatar: [
      {
        type: "USER",
        pos: [0, 0, 1, 1],
        inputCycle: { framesPerInput: 1 },
      },
    ],
  }).avatar[0];
}

describe("USER 多素材解码共享预算", () => {
  const inputs = { user: [pngBlob(2, 2), pngBlob(2, 2)] };

  it("累计扣减帧数预算", async () => {
    await expect(
      prepareAvatar(userCycleTemplate(), inputs, 1, undefined, {
        maxFrames: 1,
        maxEdge: 4096,
        maxTotalPixels: 100,
        maxMemoryBytes: 1_000,
      }),
    ).rejects.toThrow(/头像解码帧数预算超限/);
  });

  it("累计扣减总像素预算", async () => {
    await expect(
      prepareAvatar(userCycleTemplate(), inputs, 1, undefined, {
        maxFrames: 10,
        maxEdge: 4096,
        maxTotalPixels: 7,
        maxMemoryBytes: 1_000,
      }),
    ).rejects.toThrow(/头像解码像素总量超限/);
  });

  it("累计扣减内存预算", async () => {
    await expect(
      prepareAvatar(userCycleTemplate(), inputs, 1, undefined, {
        maxFrames: 10,
        maxEdge: 4096,
        maxTotalPixels: 100,
        maxMemoryBytes: 31,
      }),
    ).rejects.toThrow(/头像解码内存预算超限/);
  });

  it("核心层拒绝超过上限的 USER 输入集合，即使模板只消费一个", async () => {
    const excessiveInputs = Array.from({ length: 21 }, () => pngBlob(1, 1));

    await expect(prepareAvatar(userCycleTemplate(), { user: excessiveInputs }, 1)).rejects.toThrow(
      /USER 头像输入数量过多/,
    );
  });
});

describe("静态头像解码前元数据预检", () => {
  it.each([
    ["PNG", "image/png", pngHeader(4097, 1)],
    ["JPEG", "image/jpeg", jpegHeader(4097, 1)],
    ["WebP VP8", "image/webp", webpHeader(4097, 1, "VP8 ")],
    ["WebP VP8L", "image/webp", webpHeader(4097, 1, "VP8L")],
    ["WebP VP8X", "image/webp", webpHeader(4097, 1, "VP8X")],
  ])("%s 单边超限时不调用完整图片解码器", async (_name, type, bytes) => {
    const source = new TrackingBlob([bytes], { type });
    const runtime = getRuntime();
    let loadImageCalls = 0;
    setRuntime({
      ...runtime,
      async loadImage() {
        loadImageCalls += 1;
        return createCanvas(1, 1) as unknown as HTMLImageElement;
      },
    });

    try {
      await expect(prepareAvatar(staticAvatarTemplate(), { to: source })).rejects.toThrow(
        /头像解码源图尺寸过大/,
      );
      expect(loadImageCalls).toBe(0);
      expect(source.bytesRead).toBeGreaterThan(0);
      expect(source.bytesRead).toBeLessThanOrEqual(64);
    } finally {
      setRuntime(runtime);
    }
  });

  it.each([
    ["像素", { maxTotalPixels: 7, maxMemoryBytes: 1_000 }, /像素总量超限/],
    ["内存", { maxTotalPixels: 100, maxMemoryBytes: 31 }, /内存预算超限/],
  ])("源图与目标 Canvas 的%s峰值超限时不调用完整解码器", async (_name, limits, error) => {
    const source = new TrackingBlob([pngHeader(2, 2)], { type: "image/png" });
    const runtime = getRuntime();
    let loadImageCalls = 0;
    setRuntime({
      ...runtime,
      async loadImage() {
        loadImageCalls += 1;
        return createCanvas(2, 2) as unknown as HTMLImageElement;
      },
    });

    try {
      await expect(
        prepareAvatar(staticAvatarTemplate(), { to: source }, 1, undefined, {
          maxFrames: 10,
          maxEdge: 4096,
          ...limits,
        }),
      ).rejects.toThrow(error);
      expect(loadImageCalls).toBe(0);
    } finally {
      setRuntime(runtime);
    }
  });

  it.each([
    ["截断 PNG", "image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47])],
    ["超长 JPEG segment", "image/jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff])],
    ["SOF 前出现 SOS 的 JPEG", "image/jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02])],
    [
      "越界 WebP chunk",
      "image/webp",
      new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 0x16, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58, 0xff,
        0xff, 0xff, 0xff,
      ]),
    ],
  ])("%s 在完整解码前按结构拒绝", async (_name, type, bytes) => {
    const source = new TrackingBlob([bytes], { type });
    const runtime = getRuntime();
    let loadImageCalls = 0;
    setRuntime({
      ...runtime,
      async loadImage() {
        loadImageCalls += 1;
        return createCanvas(1, 1) as unknown as HTMLImageElement;
      },
    });

    try {
      await expect(prepareAvatar(staticAvatarTemplate(), { to: source })).rejects.toThrow(
        /PNG|JPEG|WebP|静态图片/,
      );
      expect(loadImageCalls).toBe(0);
      expect(source.bytesRead).toBeLessThanOrEqual(64);
    } finally {
      setRuntime(runtime);
    }
  });

  it("按 magic bytes 识别实际格式，而不是信任 MIME", async () => {
    const source = new TrackingBlob([jpegHeader(4097, 1)], { type: "image/png" });
    const runtime = getRuntime();
    let loadImageCalls = 0;
    setRuntime({
      ...runtime,
      async loadImage() {
        loadImageCalls += 1;
        return createCanvas(1, 1) as unknown as HTMLImageElement;
      },
    });

    try {
      await expect(prepareAvatar(staticAvatarTemplate(), { to: source })).rejects.toThrow(
        /头像解码源图尺寸过大/,
      );
      expect(loadImageCalls).toBe(0);
    } finally {
      setRuntime(runtime);
    }
  });

  it.each(["image/svg+xml", "image/avif", "image/bmp"])(
    "不支持的静态格式 %s 在完整解码前明确拒绝",
    async (type) => {
      const runtime = getRuntime();
      let loadImageCalls = 0;
      setRuntime({
        ...runtime,
        async loadImage() {
          loadImageCalls += 1;
          return createCanvas(1, 1) as unknown as HTMLImageElement;
        },
      });

      try {
        await expect(
          prepareAvatar(staticAvatarTemplate(), {
            to: new Blob([pngHeader(1, 1)], { type }),
          }),
        ).rejects.toThrow(/不支持的头像格式/);
        expect(loadImageCalls).toBe(0);
      } finally {
        setRuntime(runtime);
      }
    },
  );

  it.each(["image/png", "image/jpeg", "image/webp"] as const)(
    "合法 %s 仍可通过真实运行时解码",
    async (type) => {
      const prepared = await prepareAvatar(staticAvatarTemplate(), {
        to: encodedImageBlob(2, 3, type),
      });

      expect(prepared.frames).toHaveLength(1);
      expect(prepared.frames[0]).toMatchObject({ width: 2, height: 3 });
    },
  );
});

describe("场景头像共享预算", () => {
  it("多个头像图层共享总像素预算", async () => {
    const avatar = pngBlob(2, 2);

    await expect(
      prepareScene(
        {
          type: "IMG",
          background: { size: [1, 1], color: "#ffffff" },
          avatar: [
            { type: "TO", pos: [0, 0, 1, 1] },
            { type: "TO", pos: [0, 0, 1, 1] },
          ],
        },
        { inputs: { to: avatar }, maxTotalPixels: 7 },
      ),
    ).rejects.toThrow(/头像解码像素总量超限/);
  });

  it("多个头像图层共享内存预算", async () => {
    const avatar = pngBlob(2, 2);

    await expect(
      prepareScene(
        {
          type: "IMG",
          background: { size: [1, 1], color: "#ffffff" },
          avatar: [
            { type: "TO", pos: [0, 0, 1, 1] },
            { type: "TO", pos: [0, 0, 1, 1] },
          ],
        },
        { inputs: { to: avatar }, maxTotalPixels: 100, maxMediaMemoryBytes: 31 },
      ),
    ).rejects.toThrow(/头像解码内存预算超限/);
  });

  it("拒绝 20 个 USER 静态输入各自扩张为 512 帧", async () => {
    const avatars = Array.from({ length: 20 }, () => pngBlob(1, 1));

    await expect(
      prepareScene(
        {
          type: "IMG",
          background: { size: [1, 1], color: "#ffffff" },
          avatar: [
            {
              type: "USER",
              pos: [0, 0, 1, 1],
              inputCycle: { framesPerInput: 1 },
              filter: [
                {
                  type: "CONTRAST",
                  brightness: Array.from({ length: 512 }, () => 0),
                  contrast: 0,
                },
              ],
            },
          ],
        },
        { inputs: { user: avatars } },
      ),
    ).rejects.toThrow(/头像.*帧数预算超限/);
  });
});

describe("场景外部资源与头像解码峰值", () => {
  it("静态 Image 与目标 Canvas 共存超限时在复制分配前拒绝", async () => {
    const external = createCanvas(1, 1) as HTMLCanvasElement;
    const avatar = pngBlob(2, 2);
    const runtime = getRuntime();
    let attemptedCopyAllocation = false;
    setRuntime({
      ...runtime,
      createCanvas(width, height) {
        if (width === 2 && height === 2) {
          attemptedCopyAllocation = true;
          throw new Error("不应执行超预算静态头像复制");
        }
        return runtime.createCanvas(width, height);
      },
    });

    let caught: unknown;
    try {
      await prepareScene(
        {
          type: "IMG",
          avatar: [{ type: "TO", pos: [0, 0, 1, 1] }],
          text: [],
          background: { size: [1, 1], color: "#ffffff" },
        },
        {
          inputs: { to: avatar },
          backgroundImages: [external],
          maxTotalPixels: 5,
        },
      );
    } catch (error) {
      caught = error;
    } finally {
      setRuntime(runtime);
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/场景累计像素预算超限/);
    expect(attemptedCopyAllocation).toBe(false);
  });

  it.each([
    ["像素", { maxTotalPixels: 16, maxMediaMemoryBytes: 1_000 }, /场景累计像素预算超限/],
    ["内存", { maxTotalPixels: 1_000, maxMediaMemoryBytes: 144 }, /场景累计内存预算超限/],
  ])("GIF 解码%s超限时保留场景外部占用上下文", async (_name, limits, error) => {
    const external = createCanvas(1, 1) as HTMLCanvasElement;
    const first = createCanvas(2, 2) as HTMLCanvasElement;
    const second = createCanvas(2, 2) as HTMLCanvasElement;
    const avatar = encodeGif([first, second], { delay: 100, transparent: false });

    let caught: unknown;
    try {
      await prepareScene(
        {
          type: "IMG",
          avatar: [{ type: "TO", pos: [0, 0, 1, 1] }],
          text: [],
          background: { size: [1, 1], color: "#ffffff" },
        },
        { inputs: { to: avatar }, backgroundImages: [external], ...limits },
      );
    } catch (decodeError) {
      caught = decodeError;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(error);
    expect((caught as Error).message).toMatch(/外部资源已占/);
    expect((caught as Error).message).toMatch(
      /GIF (?:解码(?:像素总量过大|内存预算超限)|输入缓冲内存预算超限)/,
    );
  });
});

describe("头像变换分配前预算", () => {
  it("滤镜扩张帧数组前检查帧数预算", async () => {
    const template = parseTemplate({
      type: "IMG",
      avatar: [
        {
          type: "TO",
          pos: [0, 0, 1, 1],
          filter: [{ type: "CONTRAST", brightness: [0, 0], contrast: 0 }],
        },
      ],
    }).avatar[0];

    await expect(
      prepareAvatar(template, { to: pngBlob(1, 1) }, 2, undefined, {
        maxFrames: 2,
        maxEdge: 4096,
        maxTotalPixels: 100,
        maxMemoryBytes: 100,
      }),
    ).rejects.toThrow(/头像.*帧数预算超限/);
  });

  it.each(["preFitSize", "deformSize"] as const)("在 %s 分配前拒绝超边长尺寸", async (field) => {
    const template = {
      type: "TO",
      pos: [0, 0, 1, 1],
      [field]: [4097, 1],
    } as AvatarTemplate;

    await expect(prepareAvatar(template, { to: pngBlob(1, 1) })).rejects.toThrow(
      /preFitSize|deformSize|头像.*尺寸过大/,
    );
  });

  it("在 preFitSize 画布分配前检查像素峰值预算", async () => {
    const template = parseTemplate({
      type: "IMG",
      avatar: [{ type: "TO", pos: [0, 0, 1, 1], preFitSize: [3, 3] }],
    }).avatar[0];

    await expect(
      prepareAvatar(template, { to: pngBlob(1, 1) }, 1, undefined, {
        maxFrames: 10,
        maxEdge: 4096,
        maxTotalPixels: 9,
        maxMemoryBytes: 100,
      }),
    ).rejects.toThrow(/头像.*像素.*超限/);
  });

  it("在 EXPAND 预旋转分配前检查输出边长", async () => {
    const template = parseTemplate({
      type: "IMG",
      avatar: [
        {
          type: "TO",
          pos: [0, 0, 1, 1],
          preRotate: 45,
          preRotateMode: "EXPAND",
        },
      ],
    }).avatar[0];

    await expect(
      prepareAvatar(template, { to: pngBlob(4, 4) }, 1, undefined, {
        maxFrames: 10,
        maxEdge: 4,
        maxTotalPixels: 100,
        maxMemoryBytes: 1_000,
      }),
    ).rejects.toThrow(/头像.*尺寸过大/);
  });

  it("在预旋转画布分配前检查内存峰值预算", async () => {
    const template = parseTemplate({
      type: "IMG",
      avatar: [{ type: "TO", pos: [0, 0, 1, 1], preRotate: 90 }],
    }).avatar[0];

    await expect(
      prepareAvatar(template, { to: pngBlob(2, 2) }, 1, undefined, {
        maxFrames: 10,
        maxEdge: 4096,
        maxTotalPixels: 100,
        maxMemoryBytes: 31,
      }),
    ).rejects.toThrow(/头像.*内存预算超限/);
  });

  it("在渲染前拒绝超过边长上限的投影临时画布", async () => {
    await expect(
      prepareScene(
        {
          type: "IMG",
          background: { size: [1, 1], color: "#ffffff" },
          avatar: [
            {
              type: "TO",
              pos: [0, 0, 4097, 1],
              projection: { type: "ROTATE_Y", angle: 0 },
            },
          ],
        },
        { inputs: { to: pngBlob(1, 1) } },
      ),
    ).rejects.toThrow(/头像投影.*尺寸过大/);
  });

  it("在渲染前按保留帧与投影临时画布检查共享内存峰值", async () => {
    await expect(
      prepareScene(
        {
          type: "IMG",
          background: { size: [1, 1], color: "#ffffff" },
          avatar: [
            {
              type: "TO",
              pos: [0, 0, 3, 3],
              projection: { type: "ROTATE_Y", angle: 0 },
            },
          ],
        },
        {
          inputs: { to: pngBlob(1, 1) },
          maxTotalPixels: 100,
          maxMediaMemoryBytes: 39,
        },
      ),
    ).rejects.toThrow(/头像投影.*内存预算超限/);
  });

  it("像素滤镜的 RGBA 临时缓冲计入内存峰值预算", async () => {
    const template = parseTemplate({
      type: "IMG",
      avatar: [
        {
          type: "TO",
          pos: [0, 0, 1, 1],
          filter: [{ type: "CONTRAST", brightness: 0, contrast: 0 }],
        },
      ],
    }).avatar[0];

    await expect(
      prepareAvatar(template, { to: pngBlob(2, 2) }, 1, undefined, {
        maxFrames: 10,
        maxEdge: 4096,
        maxTotalPixels: 100,
        maxMemoryBytes: 80,
      }),
    ).rejects.toThrow(/头像滤镜.*内存预算超限/);
  });

  it("GRAY 样式回退的 RGBA 临时缓冲计入内存峰值预算", async () => {
    const template = parseTemplate({
      type: "IMG",
      avatar: [{ type: "TO", pos: [0, 0, 1, 1], style: ["GRAY"] }],
    }).avatar[0];

    await expect(
      prepareAvatar(template, { to: pngBlob(2, 2) }, 1, undefined, {
        maxFrames: 10,
        maxEdge: 4096,
        maxTotalPixels: 100,
        maxMemoryBytes: 48,
      }),
    ).rejects.toThrow(/头像 GRAY 样式.*内存预算超限/);
  });
});

describe("位置帧数与场景画布单边上限", () => {
  it("拒绝超过场景帧数上限的 ZOOM 位置", async () => {
    const template = parseTemplate({
      type: "IMG",
      avatar: [{ type: "TO", pos: Array.from({ length: 513 }, () => [0, 0, 1, 1]) }],
    }).avatar[0];

    await expect(prepareAvatar(template, { to: pngBlob(1, 1) })).rejects.toThrow(
      /头像位置帧数过多：513 帧/,
    );
  });

  it("拒绝超过场景帧数上限的 DEFORM 位置", async () => {
    const template = parseTemplate({
      type: "IMG",
      avatar: [
        {
          type: "TO",
          posType: "DEFORM",
          pos: Array.from({ length: 513 }, () => [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0],
          ]),
        },
      ],
    }).avatar[0];

    await expect(prepareAvatar(template, { to: pngBlob(1, 1) })).rejects.toThrow(
      /头像位置帧数过多：513 帧/,
    );
  });

  it("拒绝超过单边上限的场景画布", async () => {
    await expect(
      prepareScene(
        {
          type: "IMG",
          background: { size: [4097, 1], color: "#ffffff" },
          avatar: [{ type: "TO", pos: [0, 0, 1, 1] }],
        },
        { inputs: { to: pngBlob(1, 1) } },
      ),
    ).rejects.toThrow(/场景画布尺寸过大：4097x1/);
  });
});

describe("静态滤镜的逐帧画布共享", () => {
  // 回归：静态头像 + 单值滤镜/预旋转在多帧场景下逐帧复制相同画布，
  // 内存放大 N 倍并可耗尽像素预算（评审意见 I2）。
  it("静态头像 + 单值滤镜在多帧下共享同一画布", async () => {
    const prepared = await prepareAvatar(
      { type: "TO", pos: [0, 0, 4, 4], filter: [{ type: "BLUR", radius: 2 }] } as AvatarTemplate,
      { to: pngBlob(4, 4) },
      4,
    );

    expect(prepared.frames).toHaveLength(4);
    expect(prepared.frames[1]).toBe(prepared.frames[0]);
    expect(prepared.frames[3]).toBe(prepared.frames[0]);
  });

  it("静态头像 + 单值预旋转在多帧下共享同一画布", async () => {
    const prepared = await prepareAvatar(
      { type: "TO", pos: [0, 0, 4, 4], preRotate: 30 } as AvatarTemplate,
      { to: pngBlob(4, 4) },
      4,
    );

    expect(prepared.frames).toHaveLength(4);
    expect(prepared.frames[2]).toBe(prepared.frames[0]);
  });

  it("逐帧滤镜参数仍按帧展开为不同画布", async () => {
    const prepared = await prepareAvatar(
      {
        type: "TO",
        pos: [0, 0, 4, 4],
        filter: [{ type: "SWIRL", angle: [0, 0.6] }],
      } as AvatarTemplate,
      { to: pngBlob(4, 4) },
      4,
    );

    expect(prepared.frames).toHaveLength(4);
    expect(prepared.frames[1]).not.toBe(prepared.frames[0]);
  });
});
