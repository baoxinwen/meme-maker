/**
 * 集成测试 —— 用真实模板渲染出 PNG。
 *
 * 这一组测试覆盖核心模板渲染管线：
 * 跑通即代表整个合成引擎从模板加载到像素合成的链路是通的。
 *
 * 输出 PNG 会写到 tests/output/，便于人工肉眼检查。
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadImage as nLoadImage } from "@napi-rs/canvas";
import type { Canvas as NCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import {
  createCanvas,
  decodeGif,
  encodeGif,
  getRuntime,
  prepareScene,
  renderAllFrames,
  setRuntime,
} from "../../src/core";

describe("场景资源预算", () => {
  it("背景与全部输出帧各自未超限时仍按同时驻留的累计像素拒绝", async () => {
    await expect(
      prepareScene(
        {
          type: "GIF",
          avatar: [],
          text: [],
          background: { size: [16, 16], color: "#ffffff", length: 2 },
        },
        { maxTotalPixels: 1_023 },
      ),
    ).rejects.toThrow(/场景累计像素预算超限/);
  });

  it("背景、前景与输出帧按三组驻留像素检查精确边界", async () => {
    const foreground = createCanvas(1, 1) as HTMLCanvasElement;
    const template = {
      type: "GIF",
      avatar: [],
      text: [],
      background: {
        size: [16, 16],
        color: "#ffffff",
        length: 2,
        foregroundLayers: [{ asset: "foreground.png" }],
      },
    };
    const options = { backgroundLayerImages: { "foreground.png": foreground } };

    await expect(prepareScene(template, { ...options, maxTotalPixels: 1_536 })).rejects.toThrow(
      /场景累计像素预算超限/,
    );

    const scene = await prepareScene(template, { ...options, maxTotalPixels: 1_537 });
    expect(renderAllFrames(scene)).toHaveLength(2);
  });

  it("模板背景合成时把外部源帧计入场景累计峰值", async () => {
    const source = createCanvas(2, 2) as HTMLCanvasElement;

    await expect(
      prepareScene(
        {
          type: "IMG",
          avatar: [],
          text: [],
          background: { size: [1, 1], color: "#ffffff" },
        },
        { backgroundImages: [source], maxTotalPixels: 5 },
      ),
    ).rejects.toThrow(/场景累计像素预算超限/);
  });

  it("背景源、背景层、前景层与活动蒙版复用同一对象时只计一次", async () => {
    const shared = createCanvas(1, 1) as HTMLCanvasElement;
    const avatarSource = createCanvas(1, 1) as HTMLCanvasElement;
    const avatarBlob = new Blob(
      [new Uint8Array((avatarSource as unknown as NCanvas).toBuffer("image/png"))],
      {
        type: "image/png",
      },
    );
    const scene = await prepareScene(
      {
        type: "IMG",
        avatar: [{ type: "TO", pos: [0, 0, 1, 1], mask: "shared.png" }],
        text: [],
        background: {
          size: [1, 1],
          color: "#ffffff",
          layers: [{ asset: "shared.png" }],
          foregroundLayers: [{ asset: "shared.png" }],
        },
      },
      {
        inputs: { to: avatarBlob },
        backgroundImages: [shared],
        backgroundLayerImages: { "shared.png": shared },
        avatarMaskImages: { "shared.png": shared },
        maxTotalPixels: 5,
        maxMediaMemoryBytes: 20,
      },
    );

    expect(renderAllFrames(scene)).toHaveLength(1);
  });

  it("忽略未引用资源和缺少输入的可选头像蒙版", async () => {
    const unused = createCanvas(16, 16) as HTMLCanvasElement;
    const scene = await prepareScene(
      {
        type: "IMG",
        avatar: [{ type: "TO", pos: [0, 0, 1, 1], optional: true, mask: "optional-mask.png" }],
        text: [],
        background: { size: [1, 1], color: "#ffffff" },
      },
      {
        backgroundLayerImages: { "unused.png": unused },
        avatarMaskImages: { "optional-mask.png": unused, "unused-mask.png": unused },
        maxTotalPixels: 2,
        maxMediaMemoryBytes: 8,
      },
    );

    expect(renderAllFrames(scene)).toHaveLength(1);
  });

  it("无模板时直接成为场景背景的外部 Canvas 不重复计数", async () => {
    const source = createCanvas(1, 1) as HTMLCanvasElement;
    const scene = await prepareScene(
      { type: "IMG", avatar: [], text: [] },
      {
        backgroundImages: [source],
        maxTotalPixels: 2,
        maxMediaMemoryBytes: 8,
      },
    );

    expect(scene.backgrounds[0]).toBe(source);
    expect(renderAllFrames(scene)).toHaveLength(1);
  });

  it("头像变换分配前先为外部常驻资源预留累计预算", async () => {
    const external = createCanvas(2, 2) as HTMLCanvasElement;
    const avatarSource = createCanvas(1, 1) as HTMLCanvasElement;
    const avatarBlob = new Blob(
      [new Uint8Array((avatarSource as unknown as NCanvas).toBuffer("image/png"))],
      {
        type: "image/png",
      },
    );
    const runtime = getRuntime();
    let attemptedOversizedAllocation = false;
    setRuntime({
      ...runtime,
      createCanvas(width, height) {
        if (width === 3 && height === 2) {
          attemptedOversizedAllocation = true;
          throw new Error("不应执行超预算头像画布分配");
        }
        return runtime.createCanvas(width, height);
      },
    });

    let caught: unknown;
    try {
      await prepareScene(
        {
          type: "IMG",
          avatar: [{ type: "TO", pos: [0, 0, 1, 1], preFitSize: [3, 2] }],
          text: [],
          background: { size: [1, 1], color: "#ffffff" },
        },
        {
          inputs: { to: avatarBlob },
          backgroundImages: [external],
          maxTotalPixels: 7,
        },
      );
    } catch (error) {
      caught = error;
    } finally {
      setRuntime(runtime);
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/场景累计像素预算超限/);
    expect(attemptedOversizedAllocation).toBe(false);
  });

  it.each([
    ["像素", { maxTotalPixels: 1, maxMediaMemoryBytes: 100 }, /场景累计像素预算超限/],
    ["内存", { maxTotalPixels: 100, maxMediaMemoryBytes: 4 }, /场景累计内存预算超限/],
  ])("外部资源耗尽头像%s预算时保持场景累计错误", async (_name, limits, error) => {
    const external = createCanvas(1, 1) as HTMLCanvasElement;
    const avatarSource = createCanvas(1, 1) as HTMLCanvasElement;
    const avatarBlob = new Blob(
      [new Uint8Array((avatarSource as unknown as NCanvas).toBuffer("image/png"))],
      {
        type: "image/png",
      },
    );

    await expect(
      prepareScene(
        {
          type: "IMG",
          avatar: [{ type: "TO", pos: [0, 0, 1, 1] }],
          text: [],
          background: { size: [1, 1], color: "#ffffff" },
        },
        { inputs: { to: avatarBlob }, backgroundImages: [external], ...limits },
      ),
    ).rejects.toThrow(error);
  });

  it("渲染前按被篡改场景中的真实常驻画布和单帧临时峰值重算", async () => {
    const avatarSource = createCanvas(1, 1) as HTMLCanvasElement;
    const avatarBlob = new Blob(
      [new Uint8Array((avatarSource as unknown as NCanvas).toBuffer("image/png"))],
      {
        type: "image/png",
      },
    );
    const foregroundAsset = createCanvas(1, 1) as HTMLCanvasElement;
    const scene = await prepareScene(
      {
        type: "IMG",
        avatar: [{ type: "TO", pos: [0, 0, 1, 1] }],
        text: [],
        background: {
          size: [1, 1],
          color: "#ffffff",
          foregroundLayers: [{ asset: "foreground.png" }],
        },
        frameTransform: { type: "ROTATE_CROP", angle: 0, crop: [0, 0, 1, 1] },
      },
      {
        inputs: { to: avatarBlob },
        backgroundLayerImages: { "foreground.png": foregroundAsset },
        maxTotalPixels: 14,
      },
    );
    const avatarFrame = createCanvas(2, 2) as HTMLCanvasElement;
    const tamperedAvatar = {
      ...scene.topAvatars[0],
      frames: [avatarFrame],
      sourceFrames: [[avatarFrame]],
    };

    expect(() =>
      renderAllFrames({
        ...scene,
        backgrounds: [createCanvas(2, 2)],
        foregrounds: [createCanvas(2, 2)],
        topAvatars: [tamperedAvatar],
      }),
    ).toThrow(/场景累计像素预算超限/);
  });

  it("头像 frames 与 sourceFrames 引用同一画布时只计一次", async () => {
    const avatarSource = createCanvas(1, 1) as HTMLCanvasElement;
    const avatarBlob = new Blob(
      [new Uint8Array((avatarSource as unknown as NCanvas).toBuffer("image/png"))],
      {
        type: "image/png",
      },
    );
    const scene = await prepareScene(
      {
        type: "IMG",
        avatar: [{ type: "TO", pos: [0, 0, 1, 1] }],
        text: [],
        background: { size: [1, 1], color: "#ffffff" },
      },
      { inputs: { to: avatarBlob }, maxTotalPixels: 3, maxMediaMemoryBytes: 12 },
    );

    expect(renderAllFrames(scene)).toHaveLength(1);
  });

  it("在背景批量分配前按 RGBA 字节拒绝累计场景内存超限", async () => {
    await expect(
      prepareScene(
        {
          type: "GIF",
          avatar: [],
          text: [],
          background: { size: [16, 16], color: "#ffffff", length: 2 },
        },
        { maxTotalPixels: 1_024, maxMediaMemoryBytes: 4_095 },
      ),
    ).rejects.toThrow(/场景累计内存预算超限/);
  });

  it.each([
    ["非整数像素", { maxTotalPixels: 1.5 }],
    ["非安全整数像素", { maxTotalPixels: Number.MAX_SAFE_INTEGER + 1 }],
    ["非安全整数内存", { maxMediaMemoryBytes: Number.MAX_SAFE_INTEGER + 1 }],
  ])("拒绝%s预算", async (_name, options) => {
    await expect(
      prepareScene(
        {
          type: "IMG",
          avatar: [],
          text: [],
          background: { size: [1, 1], color: "#ffffff" },
        },
        options,
      ),
    ).rejects.toThrow(/预算无效/);
  });

  it("拒绝超过预算的 background.length", async () => {
    await expect(
      prepareScene({
        type: "GIF",
        background: { size: [8, 8], length: 513 },
      }),
    ).rejects.toThrow(/背景帧数过多/);
  });

  it("拒绝由帧变换产生的超预算最终帧数", async () => {
    await expect(
      prepareScene({
        type: "GIF",
        background: { size: [8, 8] },
        frameTransform: {
          type: "ROTATE_CROP",
          angle: Array.from({ length: 513 }, (_, index) => index),
          crop: [0, 0, 8, 8],
        },
      }),
    ).rejects.toThrow(/场景帧数过多/);
  });

  it("在视频解码前拒绝超过场景帧数上限的位置动画", async () => {
    const positions = Array.from({ length: 513 }, () => [0, 0, 16, 16]);

    await expect(
      prepareScene(
        {
          type: "GIF",
          avatar: [{ type: "TO", pos: positions }],
          text: [],
          background: { size: [16, 16], color: "#ffffff" },
        },
        { inputs: { to: new Blob(["video"], { type: "video/mp4" }) } },
      ),
    ).rejects.toThrow(/头像位置帧数过多/);
  });

  it("在批量创建背景和输出画布前拒绝超过总像素预算的场景", async () => {
    await expect(
      prepareScene(
        {
          type: "GIF",
          avatar: [],
          text: [],
          background: { size: [16, 16], color: "#ffffff", length: 2 },
        },
        { maxTotalPixels: 500 },
      ),
    ).rejects.toThrow(/场景累计像素预算超限/);
  });

  it("最终裁切尺寸很小时仍限制批量背景工作画布", async () => {
    await expect(
      prepareScene(
        {
          type: "GIF",
          background: { size: [32, 32], color: "#ffffff", length: 2 },
          frameTransform: { type: "ROTATE_CROP", angle: 0, crop: [0, 0, 1, 1] },
        },
        { maxTotalPixels: 2_000 },
      ),
    ).rejects.toThrow(/场景累计像素预算超限/);
  });

  it("动态头像扩大帧数时按最终帧数限制裁切前工作画布", async () => {
    const avatar = createCanvas(2, 2) as HTMLCanvasElement;
    const avatarBlob = new Blob(
      [new Uint8Array((avatar as unknown as NCanvas).toBuffer("image/png"))],
      {
        type: "image/png",
      },
    );

    await expect(
      prepareScene(
        {
          type: "IMG",
          avatar: [{ type: "TO", pos: [0, 0, 2, 2], angle: [0, 0] }],
          text: [],
          background: { size: [32, 32], color: "#ffffff" },
          frameTransform: { type: "ROTATE_CROP", angle: 0, crop: [0, 0, 1, 1] },
        },
        { inputs: { to: avatarBlob }, maxTotalPixels: 2_000 },
      ),
    ).rejects.toThrow(/场景累计像素预算超限/);
  });

  it("渲染全部帧时防御性拒绝被篡改的超限场景", async () => {
    const scene = await prepareScene({
      type: "IMG",
      avatar: [],
      text: [],
      background: { size: [8, 8], color: "#ffffff" },
    });

    expect(() => renderAllFrames({ ...scene, frameCount: 513 })).toThrow(/场景帧数过多/);
  });

  it("把最大文字变形临时画布计入准备期场景峰值并检查精确边界", async () => {
    const template = {
      type: "IMG",
      avatar: [],
      text: [
        {
          text: "预算",
          deform: [
            [0, 0],
            [2, 0],
            [2, 2],
            [0, 2],
          ],
          deformSize: [2, 2],
        },
      ],
      background: { size: [1, 1], color: "#ffffff" },
    };

    await expect(prepareScene(template, { maxTotalPixels: 5 })).rejects.toThrow(
      /场景累计像素预算超限/,
    );
    await expect(
      prepareScene(template, { maxTotalPixels: 6, maxMediaMemoryBytes: 23 }),
    ).rejects.toThrow(/场景累计内存预算超限/);
    const scene = await prepareScene(template, {
      maxTotalPixels: 6,
      maxMediaMemoryBytes: 24,
    });
    expect(renderAllFrames(scene)).toHaveLength(1);
  });

  it("渲染前重算被篡改文字的变形尺寸且不分配输出画布", async () => {
    const scene = await prepareScene({
      type: "IMG",
      avatar: [],
      text: [{ text: "预算" }],
      background: { size: [1, 1], color: "#ffffff" },
    });
    const runtime = getRuntime();
    let allocationCount = 0;
    setRuntime({
      ...runtime,
      createCanvas(width, height) {
        allocationCount++;
        return runtime.createCanvas(width, height);
      },
    });

    let caught: unknown;
    try {
      renderAllFrames({
        ...scene,
        texts: [
          {
            ...scene.texts[0],
            deform: {
              width: 4_097,
              height: 1,
              corners: [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 1],
              ],
            },
          },
        ],
      });
    } catch (error) {
      caught = error;
    } finally {
      setRuntime(runtime);
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/文字变形画布尺寸过大/);
    expect(allocationCount).toBe(0);
  });
});

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const outDir = resolve(here, "../output");
mkdirSync(outDir, { recursive: true });

function readJson(path: string) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

async function readPng(path: string) {
  const buf = readFileSync(path);
  return await nLoadImage(buf);
}

/** 把 RuntimeCanvas（其实是 @napi-rs/canvas Canvas）写成 PNG 文件 */
function savePng(canvas: HTMLCanvasElement, filename: string): string {
  const out = resolve(outDir, filename);
  const ncanvas = canvas as unknown as NCanvas;
  const buf = ncanvas.toBuffer("image/png");
  writeFileSync(out, buf);
  return out;
}

function countPixelDifferences(first: HTMLCanvasElement, second: HTMLCanvasElement): number {
  if (first.width !== second.width || first.height !== second.height)
    return Number.POSITIVE_INFINITY;
  const firstPixels = first
    .getContext("2d", { willReadFrequently: true })!
    .getImageData(0, 0, first.width, first.height).data;
  const secondPixels = second
    .getContext("2d", { willReadFrequently: true })!
    .getImageData(0, 0, second.width, second.height).data;
  let differences = 0;
  for (let index = 0; index < firstPixels.length; index += 4) {
    if (
      firstPixels[index] !== secondPixels[index] ||
      firstPixels[index + 1] !== secondPixels[index + 1] ||
      firstPixels[index + 2] !== secondPixels[index + 2] ||
      firstPixels[index + 3] !== secondPixels[index + 3]
    ) {
      differences += 1;
    }
  }
  return differences;
}

function hasDominantColor(frame: HTMLCanvasElement, channel: "red" | "blue"): boolean {
  const pixels = frame
    .getContext("2d", { willReadFrequently: true })!
    .getImageData(0, 0, frame.width, frame.height).data;
  for (let index = 0; index < pixels.length; index += 4) {
    if (
      channel === "red" &&
      pixels[index] > pixels[index + 1] + 80 &&
      pixels[index] > pixels[index + 2] + 80
    ) {
      return true;
    }
    if (
      channel === "blue" &&
      pixels[index + 2] > pixels[index] + 80 &&
      pixels[index + 2] > pixels[index + 1] + 80
    ) {
      return true;
    }
  }
  return false;
}

describe("集成：头像预旋转", () => {
  it("EXPAND 预旋转会更新尺寸表达式并保持像素可见", async () => {
    const avatar = createCanvas(4, 2);
    const avatarCtx = avatar.getContext("2d")!;
    avatarCtx.fillStyle = "#ef4444";
    avatarCtx.fillRect(0, 0, 2, 2);
    avatarCtx.fillStyle = "#2563eb";
    avatarCtx.fillRect(2, 0, 2, 2);
    const avatarBlob = new Blob(
      [new Uint8Array((avatar as unknown as NCanvas).toBuffer("image/png"))],
      {
        type: "image/png",
      },
    );

    const scene = await prepareScene(
      {
        type: "IMG",
        avatar: [
          {
            type: "TO",
            pos: [0, 0, "avatar0Width", "avatar0Height"],
            preFitSize: [4, 2],
            preRotate: 90,
            preRotateMode: "EXPAND",
          },
        ],
        text: [],
        background: { size: ["avatar0Width", "avatar0Height"], color: "#ffffff" },
      },
      { inputs: { to: avatarBlob } },
    );

    expect(scene.width).toBe(2);
    expect(scene.height).toBe(4);
    const frame = renderAllFrames(scene)[0];
    const pixels = frame.getContext("2d")!.getImageData(0, 0, frame.width, frame.height).data;
    expect(pixels.some((value, index) => index % 4 !== 3 && value !== 255)).toBe(true);
  });

  it("逐帧预适配尺寸会在 GIF 场景中保留每帧大小", async () => {
    const avatar = createCanvas(4, 4);
    avatar.getContext("2d")!.fillRect(0, 0, 4, 4);
    const avatarBlob = new Blob(
      [new Uint8Array((avatar as unknown as NCanvas).toBuffer("image/png"))],
      {
        type: "image/png",
      },
    );
    const bg = createCanvas(40, 40);

    const scene = await prepareScene(
      {
        type: "GIF",
        avatar: [
          {
            type: "TO",
            pos: [
              [0, 0, 10, 10],
              [0, 0, 20, 20],
            ],
            preFitSize: [
              [10, 10],
              [20, 20],
            ],
            fit: "FILL",
          },
        ],
        text: [],
      },
      { inputs: { to: avatarBlob }, backgroundImages: [bg, bg] },
    );

    expect(scene.topAvatars[0].frames.map((frame) => [frame.width, frame.height])).toEqual([
      [10, 10],
      [20, 20],
    ]);
  });
});

describe("集成：osu 模板（静态 IMG）", () => {
  it("加载、渲染、输出 PNG", async () => {
    const templatePath = resolve(root, "public/data/templates/osu/data.json");
    const bgImage = await readPng(resolve(root, "public/data/templates/osu/0.png"));

    const scene = await prepareScene(readJson(templatePath), {
      backgroundImages: [bgImage as unknown as HTMLImageElement],
    });

    expect(scene.template.type).toBe("IMG");
    expect(scene.frameCount).toBe(1);
    expect(scene.width).toBe(bgImage.width);
    expect(scene.height).toBe(bgImage.height);
    expect(scene.texts).toHaveLength(1);

    const frames = renderAllFrames(scene);
    expect(frames).toHaveLength(1);

    const file = savePng(frames[0], "osu.png");
    expect(file).toMatch(/osu\.png$/);
  });
});

describe("集成：tightly 模板（GIF 多帧 + 头像）", () => {
  it("加载所有帧、应用头像位置、输出每帧 PNG", async () => {
    const templatePath = resolve(root, "public/data/templates/tightly/data.json");
    const template = readJson(templatePath);

    // tightly 有 20 个背景帧（pos 数组长 20）
    const bgImages: HTMLImageElement[] = [];
    for (let i = 0; i < 20; i++) {
      const img = await readPng(resolve(root, "public/data/templates/tightly", `${i}.png`));
      bgImages.push(img as unknown as HTMLImageElement);
    }

    // 用 fixtures 里的头像作为 TO 输入
    const avatarBuf = readFileSync(resolve(here, "../fixtures/avatar.jpg"));
    const avatarBlob = new Blob([avatarBuf], { type: "image/jpeg" });

    const scene = await prepareScene(template, {
      inputs: { to: avatarBlob },
      backgroundImages: bgImages,
    });

    expect(scene.template.type).toBe("GIF");
    expect(scene.frameCount).toBe(20);
    expect(scene.bottomAvatars).toHaveLength(1); // avatarOnTop: false
    expect(scene.topAvatars).toHaveLength(0);

    const frames = renderAllFrames(scene);
    expect(frames).toHaveLength(20);

    // 抽样保存几帧（不全保存以免输出爆炸）
    savePng(frames[0], "tightly-0.png");
    savePng(frames[10], "tightly-10.png");
    savePng(frames[19], "tightly-19.png");
  });
});

describe("集成：turn 模板（程序化旋转 GIF）", () => {
  it("生成 36 帧透明背景动画，且旋转后的帧像素不同", async () => {
    const templatePath = resolve(root, "public/data/templates/turn/data.json");
    const avatar = createCanvas(30, 30);
    const avatarCtx = avatar.getContext("2d")!;
    avatarCtx.fillStyle = "#ef4444";
    avatarCtx.fillRect(0, 0, 15, 30);
    avatarCtx.fillStyle = "#2563eb";
    avatarCtx.fillRect(15, 0, 15, 30);
    const avatarBlob = new Blob(
      [new Uint8Array((avatar as unknown as NCanvas).toBuffer("image/png"))],
      {
        type: "image/png",
      },
    );

    const scene = await prepareScene(readJson(templatePath), {
      inputs: { to: avatarBlob },
    });
    const frames = renderAllFrames(scene);

    expect(scene.delay).toBe(50);
    expect(frames).toHaveLength(36);
    expect(frames[0]).toMatchObject({ width: 250, height: 250 });

    const first = frames[0]
      .getContext("2d", { willReadFrequently: true })!
      .getImageData(0, 0, 250, 250).data;
    const quarterTurn = frames[9]
      .getContext("2d", { willReadFrequently: true })!
      .getImageData(0, 0, 250, 250).data;
    expect(first.some((pixel, index) => pixel !== quarterTurn[index])).toBe(true);
  });
});

describe("集成：windmill_turn 模板（完整场景旋转裁切）", () => {
  it("输出五帧不同像素，并通过 PNG 与 GIF 编解码", async () => {
    const templatePath = resolve(root, "public/data/templates/windmill_turn/data.json");
    const avatar = createCanvas(30, 30);
    const avatarCtx = avatar.getContext("2d")!;
    avatarCtx.fillStyle = "#ef4444";
    avatarCtx.fillRect(0, 0, 18, 12);
    avatarCtx.fillStyle = "#22c55e";
    avatarCtx.fillRect(18, 0, 12, 30);
    avatarCtx.fillStyle = "#2563eb";
    avatarCtx.fillRect(0, 12, 18, 18);
    const avatarBlob = new Blob(
      [new Uint8Array((avatar as unknown as NCanvas).toBuffer("image/png"))],
      {
        type: "image/png",
      },
    );

    const scene = await prepareScene(readJson(templatePath), {
      inputs: { from: avatarBlob },
    });
    const frames = renderAllFrames(scene);

    expect(scene).toMatchObject({
      width: 500,
      height: 500,
      renderWidth: 600,
      renderHeight: 600,
      frameCount: 5,
      delay: 50,
    });
    expect(frames).toHaveLength(5);
    const firstPixels = frames[0]
      .getContext("2d", { willReadFrequently: true })!
      .getImageData(0, 0, 500, 500).data;
    const secondPixels = frames[1]
      .getContext("2d", { willReadFrequently: true })!
      .getImageData(0, 0, 500, 500).data;
    expect(firstPixels.some((value, index) => value !== secondPixels[index])).toBe(true);

    const png = (frames[0] as unknown as NCanvas).toBuffer("image/png");
    const decodedPng = await nLoadImage(png);
    expect(decodedPng.width).toBe(500);
    expect(decodedPng.height).toBe(500);

    const gif = encodeGif(frames, { delay: scene.delay, transparent: true });
    const decodedGif = await decodeGif(gif);
    expect(decodedGif.frames).toHaveLength(5);
    expect(decodedGif.frames[0]).toMatchObject({ width: 500, height: 500 });
  });
});

describe("集成：rotate_3d 模板（逐帧 Y 轴透视旋转）", () => {
  it("保持动态画布尺寸、翻转像素方向，并通过 PNG 与 GIF 编解码", async () => {
    const templatePath = resolve(root, "public/data/templates/rotate_3d/data.json");
    const avatar = createCanvas(40, 20);
    const avatarCtx = avatar.getContext("2d")!;
    avatarCtx.fillStyle = "#ef4444";
    avatarCtx.fillRect(0, 0, 20, 20);
    avatarCtx.fillStyle = "#2563eb";
    avatarCtx.fillRect(20, 0, 20, 20);
    const avatarBlob = new Blob(
      [new Uint8Array((avatar as unknown as NCanvas).toBuffer("image/png"))],
      {
        type: "image/png",
      },
    );

    const scene = await prepareScene(readJson(templatePath), {
      inputs: { from: avatarBlob },
    });
    const frames = renderAllFrames(scene);

    expect(scene).toMatchObject({ width: 48, height: 30, frameCount: 30, delay: 70 });
    expect(frames).toHaveLength(30);
    const firstLeft = frames[0].getContext("2d")!.getImageData(8, 15, 1, 1).data;
    const firstRight = frames[0].getContext("2d")!.getImageData(40, 15, 1, 1).data;
    const halfTurnLeft = frames[15].getContext("2d")!.getImageData(8, 15, 1, 1).data;
    const halfTurnRight = frames[15].getContext("2d")!.getImageData(40, 15, 1, 1).data;
    expect(firstLeft[0]).toBeGreaterThan(firstLeft[2]);
    expect(firstRight[2]).toBeGreaterThan(firstRight[0]);
    expect(halfTurnLeft[2]).toBeGreaterThan(halfTurnLeft[0]);
    expect(halfTurnRight[0]).toBeGreaterThan(halfTurnRight[2]);

    const png = (frames[0] as unknown as NCanvas).toBuffer("image/png");
    const decodedPng = await nLoadImage(png);
    expect(decodedPng).toMatchObject({ width: 48, height: 30 });

    const gif = encodeGif(frames, { delay: scene.delay, transparent: true });
    const decodedGif = await decodeGif(gif);
    expect(decodedGif.frames).toHaveLength(30);
    expect(decodedGif.frames[0]).toMatchObject({ width: 48, height: 30 });
  });
});

describe("集成：pyramid 模板（多头像循环三维投影）", () => {
  const makeAvatar = (color: string) => {
    const canvas = createCanvas(80, 60);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return new Blob([new Uint8Array((canvas as unknown as NCanvas).toBuffer("image/png"))], {
      type: "image/png",
    });
  };

  it("按输入顺序切换四棱锥正面，并通过 PNG 与 GIF 编解码", async () => {
    const templatePath = resolve(root, "public/data/templates/pyramid/data.json");
    const scene = await prepareScene(readJson(templatePath), {
      inputs: { user: [makeAvatar("#ef4444"), makeAvatar("#2563eb")] },
    });
    const frames = renderAllFrames(scene);

    expect(scene).toMatchObject({ width: 300, height: 300, frameCount: 30, delay: 60 });
    const firstPhase = frames[0].getContext("2d")!.getImageData(150, 150, 1, 1).data;
    const secondPhase = frames[15].getContext("2d")!.getImageData(150, 150, 1, 1).data;
    expect(firstPhase[0]).toBeGreaterThan(firstPhase[2]);
    expect(secondPhase[2]).toBeGreaterThan(secondPhase[0]);

    const png = (frames[0] as unknown as NCanvas).toBuffer("image/png");
    const decodedPng = await nLoadImage(png);
    expect(decodedPng).toMatchObject({ width: 300, height: 300 });

    const gif = encodeGif(frames, { delay: scene.delay, transparent: true });
    const decodedGif = await decodeGif(gif);
    expect(decodedGif.frames).toHaveLength(30);
    expect(decodedGif.frames[0]).toMatchObject({ width: 300, height: 300 });
  });

  it("按实际输入数量决定帧数，并把图层上限作为消费上限", async () => {
    const template = readJson(resolve(root, "public/data/templates/pyramid/data.json"));
    const red = makeAvatar("#ef4444");
    const oneInputScene = await prepareScene(template, { inputs: { user: [red] } });
    expect(oneInputScene.frameCount).toBe(15);

    const cappedScene = await prepareScene(template, {
      inputs: { user: [red, red, red, red, red] },
    });
    expect(cappedScene.frameCount).toBe(60);
    expect(cappedScene.topAvatars.map((avatar) => avatar.sourceFrames.length)).toEqual([4, 4]);
  });

  it("同一 USER 槽位允许不同图层分别消费两个和四个输入", async () => {
    const red = makeAvatar("#ef4444");
    const scene = await prepareScene(
      {
        type: "GIF",
        avatar: [
          {
            type: "USER",
            inputCycle: { framesPerInput: 1, maxInputs: 2 },
            pos: [0, 0, 8, 8],
          },
          {
            type: "USER",
            inputCycle: { framesPerInput: 1, maxInputs: 4 },
            pos: [8, 0, 8, 8],
          },
        ],
        text: [],
        background: { size: [16, 8], color: "#ffffff" },
      },
      { inputs: { user: [red, red, red, red] } },
    );

    expect(scene.frameCount).toBe(4);
    expect(scene.topAvatars.map((avatar) => avatar.sourceFrames.length)).toEqual([2, 4]);
  });
});

describe("集成：look_flat 模板（选项驱动动态文字与画布）", () => {
  it("压扁比例同步改变头像、文字区域和输出尺寸，并通过 PNG 回读", async () => {
    const template = readJson(resolve(root, "public/data/templates/look_flat/data.json"));
    const avatar = createCanvas(200, 100);
    const avatarCtx = avatar.getContext("2d")!;
    avatarCtx.fillStyle = "#ef4444";
    avatarCtx.fillRect(0, 0, 100, 100);
    avatarCtx.fillStyle = "#2563eb";
    avatarCtx.fillRect(100, 0, 100, 100);
    const avatarBlob = new Blob(
      [new Uint8Array((avatar as unknown as NCanvas).toBuffer("image/png"))],
      {
        type: "image/png",
      },
    );

    const defaultScene = await prepareScene(template, { inputs: { from: avatarBlob } });
    const flatterScene = await prepareScene(template, {
      inputs: { from: avatarBlob },
      optionValues: { ratio: 5 },
    });
    const [defaultFrame] = renderAllFrames(defaultScene);
    const [flatterFrame] = renderAllFrames(flatterScene);

    expect(defaultScene).toMatchObject({ width: 500, height: 205, frameCount: 1 });
    expect(flatterScene).toMatchObject({ width: 500, height: 130, frameCount: 1 });
    expect(flatterScene.texts[0].lines[0].y).toBeGreaterThanOrEqual(50);
    expect(defaultFrame.height).toBeGreaterThan(flatterFrame.height);

    const png = (flatterFrame as unknown as NCanvas).toBuffer("image/png");
    const decodedPng = await nLoadImage(png);
    expect(decodedPng).toMatchObject({ width: 500, height: 130 });
  });
});

describe("集成：高级文字按帧显隐", () => {
  it("将 frameIndex 注入安全表达式，只绘制当前时间段的字幕", async () => {
    const scene = await prepareScene({
      type: "GIF",
      text: [
        {
          text: "A",
          pos: [20, 40],
          size: 32,
          color: "#ff0000",
          when: "lt(frameIndex, 1)",
        },
        {
          text: "B",
          pos: [20, 40],
          size: 32,
          color: "#0000ff",
          when: "gte(frameIndex, 1)",
        },
      ],
      background: { size: [80, 60], color: "#ffffff", length: 2 },
    });
    const frames = renderAllFrames(scene);

    expect(frames).toHaveLength(2);
    expect(hasDominantColor(frames[0], "red")).toBe(true);
    expect(hasDominantColor(frames[0], "blue")).toBe(false);
    expect(hasDominantColor(frames[1], "blue")).toBe(true);
    expect(hasDominantColor(frames[1], "red")).toBe(false);
  });
});

describe("集成：chanshenzi 模板（多段 GIF 字幕）", () => {
  it("仅在声明时间段叠加字幕，文字编辑影响对应帧，并通过 PNG/GIF 回读", async () => {
    const template = readJson(resolve(root, "public/data/templates/chanshenzi/data.json"));
    const backgrounds = await Promise.all(
      Array.from(
        { length: 48 },
        async (_, index) =>
          (await readPng(
            resolve(root, `public/data/templates/chanshenzi/${index}.png`),
          )) as unknown as HTMLImageElement,
      ),
    );
    const scene = await prepareScene(template, { backgroundImages: backgrounds });
    const frames = renderAllFrames(scene);
    const rawFirst = createCanvas(276, 158);
    rawFirst.getContext("2d")!.drawImage(backgrounds[0], 0, 0);
    const rawGap = createCanvas(276, 158);
    rawGap.getContext("2d")!.drawImage(backgrounds[32], 0, 0);

    expect(scene).toMatchObject({ width: 276, height: 158, frameCount: 48, delay: 100 });
    expect(countPixelDifferences(frames[0], rawFirst)).toBeGreaterThan(100);
    expect(countPixelDifferences(frames[32], rawGap)).toBe(0);

    const alternateTemplate = {
      ...template,
      text: template.text.map((text: { text: string }, index: number) =>
        index === 1 ? { ...text, text: "测试字幕" } : text,
      ),
    };
    const alternateFrames = renderAllFrames(
      await prepareScene(alternateTemplate, { backgroundImages: backgrounds }),
    );
    expect(countPixelDifferences(frames[20], alternateFrames[20])).toBeGreaterThan(100);

    const png = (frames[20] as unknown as NCanvas).toBuffer("image/png");
    const decodedPng = await nLoadImage(png);
    expect(decodedPng).toMatchObject({ width: 276, height: 158 });

    const gif = encodeGif(frames, { delay: scene.delay, transparent: true });
    const decodedGif = await decodeGif(gif);
    expect(decodedGif.frames).toHaveLength(48);
    expect(decodedGif.frames[0]).toMatchObject({ width: 276, height: 158 });
  });
});

describe("集成：覆盖层位置选项", () => {
  for (const [key, assets] of [
    ["bubble_tea", ["overlay-left.png", "overlay-right.png"]],
    ["gun", ["overlay-left.png", "overlay-right.png"]],
  ] as const) {
    it(`${key} 的左侧、右侧和双侧选项改变成品像素，并通过 PNG 回读`, async () => {
      const template = readJson(resolve(root, `public/data/templates/${key}/data.json`));
      const avatar = createCanvas(120, 80);
      const avatarCtx = avatar.getContext("2d")!;
      avatarCtx.fillStyle = "#f8fafc";
      avatarCtx.fillRect(0, 0, avatar.width, avatar.height);
      avatarCtx.fillStyle = "#14b8a6";
      avatarCtx.fillRect(15, 10, 90, 60);
      const avatarBlob = new Blob(
        [new Uint8Array((avatar as unknown as NCanvas).toBuffer("image/png"))],
        {
          type: "image/png",
        },
      );
      const backgroundLayerImages = Object.fromEntries(
        await Promise.all(
          assets.map(async (asset) => [
            asset,
            (await readPng(
              resolve(root, `public/data/templates/${key}/${asset}`),
            )) as unknown as HTMLImageElement,
          ]),
        ),
      );
      const prepare = async (position: string) =>
        prepareScene(template, {
          inputs: { from: avatarBlob },
          optionValues: { position },
          backgroundLayerImages,
        });

      const [leftFrame] = renderAllFrames(await prepare("left"));
      const [rightFrame] = renderAllFrames(await prepare("right"));
      const [bothFrame] = renderAllFrames(await prepare("both"));
      expect(countPixelDifferences(leftFrame, rightFrame)).toBeGreaterThan(100);
      expect(countPixelDifferences(leftFrame, bothFrame)).toBeGreaterThan(100);
      expect(countPixelDifferences(rightFrame, bothFrame)).toBeGreaterThan(100);

      const png = (bothFrame as unknown as NCanvas).toBuffer("image/png");
      const decodedPng = await nLoadImage(png);
      expect(decodedPng).toMatchObject({ width: 500, height: 500 });
    });
  }
});

describe("集成：my_wife 模板（文本选项与动态画布）", () => {
  it("称呼选项改变三处文字，并随头像比例生成可回读 PNG", async () => {
    const template = readJson(resolve(root, "public/data/templates/my_wife/data.json"));
    const pointer = (await readPng(
      resolve(root, "public/data/templates/my_wife/pointer.png"),
    )) as unknown as HTMLImageElement;
    const avatar = createCanvas(200, 100);
    const avatarCtx = avatar.getContext("2d")!;
    avatarCtx.fillStyle = "#f97316";
    avatarCtx.fillRect(0, 0, avatar.width, avatar.height);
    const avatarBlob = new Blob(
      [new Uint8Array((avatar as unknown as NCanvas).toBuffer("image/png"))],
      {
        type: "image/png",
      },
    );
    const prepare = async (optionValues: Record<string, string>) =>
      prepareScene(template, {
        inputs: { from: avatarBlob },
        optionValues,
        backgroundLayerImages: { "pointer.png": pointer },
      });

    const defaultScene = await prepare({});
    const customScene = await prepare({ pronoun: "咱", name: "搭档" });
    const [defaultFrame] = renderAllFrames(defaultScene);
    const [customFrame] = renderAllFrames(customScene);
    const customText = customScene.texts
      .flatMap((text) => text.lines.map((line) => line.text))
      .join("\n");

    expect(customScene).toMatchObject({ width: 650, height: 700, frameCount: 1 });
    expect(customText).toContain("搭档");
    expect(customText).toContain("咱");
    expect(countPixelDifferences(defaultFrame, customFrame)).toBeGreaterThan(100);

    const png = (customFrame as unknown as NCanvas).toBuffer("image/png");
    const decodedPng = await nLoadImage(png);
    expect(decodedPng).toMatchObject({ width: 650, height: 700 });
  });
});

describe("集成：clown 模板（布尔选项与条件头像图层）", () => {
  it("切换轮廓会改变画布、图层像素，并通过 PNG 回读", async () => {
    const template = readJson(resolve(root, "public/data/templates/clown/data.json"));
    const [circle, person] = await Promise.all(
      ["circle.png", "person.png"].map(
        async (asset) =>
          (await readPng(
            resolve(root, `public/data/templates/clown/${asset}`),
          )) as unknown as HTMLImageElement,
      ),
    );
    const avatar = createCanvas(120, 90);
    const avatarCtx = avatar.getContext("2d")!;
    avatarCtx.fillStyle = "#f97316";
    avatarCtx.fillRect(0, 0, 80, 90);
    avatarCtx.fillStyle = "#14b8a6";
    avatarCtx.fillRect(80, 0, 40, 90);
    const avatarBlob = new Blob(
      [new Uint8Array((avatar as unknown as NCanvas).toBuffer("image/png"))],
      {
        type: "image/png",
      },
    );
    const prepare = async (personMode: boolean) =>
      prepareScene(template, {
        inputs: { from: avatarBlob },
        optionValues: { person: personMode },
        backgroundLayerImages: { "circle.png": circle, "person.png": person },
      });

    const [circleFrame] = renderAllFrames(await prepare(false));
    const [personFrame] = renderAllFrames(await prepare(true));
    expect(circleFrame).toMatchObject({ width: 746, height: 672 });
    expect(personFrame).toMatchObject({ width: 750, height: 750 });
    expect(countPixelDifferences(circleFrame, personFrame)).toBeGreaterThan(100);

    const png = (personFrame as unknown as NCanvas).toBuffer("image/png");
    const decodedPng = await nLoadImage(png);
    expect(decodedPng).toMatchObject({ width: 750, height: 750 });
  });
});

describe("集成：纯模板背景（无外部图）", () => {
  it("根据 background.size + color 生成画布", async () => {
    const template = {
      type: "IMG",
      avatar: [],
      text: [
        {
          text: "Hello",
          pos: [50, 50],
          size: 32,
          color: "red",
        },
      ],
      background: {
        size: [200, 100] as [number, number],
        color: "#222",
      },
    };
    const scene = await prepareScene(template);
    expect(scene.width).toBe(200);
    expect(scene.height).toBe(100);
    const frames = renderAllFrames(scene);
    savePng(frames[0], "synthetic-bg.png");
  });
});

describe("集成：动态背景资源层", () => {
  it("按表达式定位并缩放外部背景资源", async () => {
    const overlay = createCanvas(2, 2) as HTMLCanvasElement;
    const overlayCtx = overlay.getContext("2d")!;
    overlayCtx.fillStyle = "#ef4444";
    overlayCtx.fillRect(0, 0, 2, 2);

    const scene = await prepareScene(
      {
        type: "IMG",
        avatar: [],
        text: [],
        background: {
          size: [10, 8],
          color: "#ffffff",
          imagePos: ["width - imageWidth * 2", "height - imageHeight * 2"],
          imageSize: ["imageWidth * 2", "imageHeight * 2"],
          imageFit: "FILL",
        },
      },
      { backgroundImages: [overlay] },
    );
    const pixels = renderAllFrames(scene)[0]
      .getContext("2d", { willReadFrequently: true })!
      .getImageData(0, 0, 10, 8).data;
    const colorAt = (x: number, y: number) =>
      Array.from(pixels.slice((y * 10 + x) * 4, (y * 10 + x) * 4 + 4));

    expect(colorAt(5, 3)).toEqual([255, 255, 255, 255]);
    expect(colorAt(6, 4)).toEqual([239, 68, 68, 255]);
    expect(colorAt(9, 7)).toEqual([239, 68, 68, 255]);
  });

  it("在完整场景合成后裁切背景圆角", async () => {
    const scene = await prepareScene({
      type: "IMG",
      avatar: [],
      text: [],
      background: { size: [12, 12], color: "#ef4444", round: 4 },
    });
    const pixels = renderAllFrames(scene)[0]
      .getContext("2d", { willReadFrequently: true })!
      .getImageData(0, 0, 12, 12).data;

    expect(pixels[3]).toBe(0);
    expect(pixels[(6 * 12 + 6) * 4 + 3]).toBe(255);
  });

  it("按声明顺序叠加命名的静态背景图层", async () => {
    const red = createCanvas(2, 2) as HTMLCanvasElement;
    red.getContext("2d")!.fillStyle = "#ff0000";
    red.getContext("2d")!.fillRect(0, 0, 2, 2);
    const blue = createCanvas(2, 2) as HTMLCanvasElement;
    blue.getContext("2d")!.fillStyle = "#0000ff";
    blue.getContext("2d")!.fillRect(0, 0, 2, 2);

    const scene = await prepareScene(
      {
        type: "IMG",
        avatar: [],
        text: [],
        background: {
          size: [6, 2],
          color: "#ffffff",
          layers: [
            { asset: "red.png", pos: [0, 0], size: [4, 2], fit: "FILL" },
            { asset: "blue.png", when: "gt(width, 4)", pos: [2, 0], size: [4, 2], fit: "FILL" },
          ],
        },
      },
      { backgroundLayerImages: { "red.png": red, "blue.png": blue } },
    );
    const ctx = renderAllFrames(scene)[0].getContext("2d", { willReadFrequently: true })!;

    expect(Array.from(ctx.getImageData(1, 1, 1, 1).data)).toEqual([255, 0, 0, 255]);
    expect(Array.from(ctx.getImageData(3, 1, 1, 1).data)).toEqual([0, 0, 255, 255]);
  });

  it("在头像与文字之后叠加静态前景图层", async () => {
    const avatar = createCanvas(6, 2) as HTMLCanvasElement;
    avatar.getContext("2d")!.fillStyle = "#0000ff";
    avatar.getContext("2d")!.fillRect(0, 0, 6, 2);
    const avatarBlob = new Blob(
      [new Uint8Array((avatar as unknown as NCanvas).toBuffer("image/png"))],
      {
        type: "image/png",
      },
    );
    const foreground = createCanvas(2, 2) as HTMLCanvasElement;
    foreground.getContext("2d")!.fillStyle = "#ff0000";
    foreground.getContext("2d")!.fillRect(0, 0, 2, 2);

    const scene = await prepareScene(
      {
        type: "IMG",
        avatar: [{ type: "FROM", pos: [0, 0, 6, 2] }],
        text: [],
        background: {
          size: [6, 2],
          color: "#ffffff",
          foregroundLayers: [{ asset: "foreground.png", pos: [2, 0] }],
        },
      },
      {
        inputs: { from: avatarBlob },
        backgroundLayerImages: { "foreground.png": foreground },
      },
    );
    const ctx = renderAllFrames(scene)[0].getContext("2d", { willReadFrequently: true })!;

    expect(Array.from(ctx.getImageData(0, 1, 1, 1).data)).toEqual([0, 0, 255, 255]);
    expect(Array.from(ctx.getImageData(2, 1, 1, 1).data)).toEqual([255, 0, 0, 255]);
  });

  it("背景和前景图层的 when 按最终场景帧号求值", async () => {
    const red = createCanvas(2, 2) as HTMLCanvasElement;
    red.getContext("2d")!.fillStyle = "#ff0000";
    red.getContext("2d")!.fillRect(0, 0, 2, 2);
    const green = createCanvas(2, 2) as HTMLCanvasElement;
    green.getContext("2d")!.fillStyle = "#00ff00";
    green.getContext("2d")!.fillRect(0, 0, 2, 2);

    const scene = await prepareScene(
      {
        type: "IMG",
        avatar: [],
        text: [],
        frameTransform: { type: "ROTATE_CROP", angle: [0, 0], crop: [0, 0, 2, 2] },
        background: {
          size: [2, 2],
          color: "#000000",
          layers: [{ asset: "red.png", when: "gte(frameIndex, 1)" }],
          foregroundLayers: [{ asset: "green.png", when: "lt(frameIndex, 1)" }],
        },
      },
      { backgroundLayerImages: { "red.png": red, "green.png": green } },
    );
    const colors = renderAllFrames(scene).map((frame) =>
      Array.from(frame.getContext("2d")!.getImageData(1, 1, 1, 1).data.slice(0, 3)),
    );

    expect(scene.backgrounds).toHaveLength(2);
    expect(scene.foregrounds).toHaveLength(2);
    expect(colors).toEqual([
      [0, 255, 0],
      [255, 0, 0],
    ]);
  });
});

describe("集成：reverse 帧序", () => {
  it("renderAllFrames 按展示/导出顺序反转帧", async () => {
    const makeFrame = (color: string) => {
      const canvas = createCanvas(4, 4) as HTMLCanvasElement;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 4, 4);
      return canvas;
    };
    const template = {
      type: "GIF",
      avatar: [],
      text: [],
      reverse: true,
    };

    const scene = await prepareScene(template, {
      backgroundImages: [makeFrame("#ff0000"), makeFrame("#00ff00"), makeFrame("#0000ff")],
    });
    const frames = renderAllFrames(scene);
    const colors = frames.map((frame) => {
      const data = frame
        .getContext("2d", { willReadFrequently: true })!
        .getImageData(0, 0, 1, 1).data;
      return [data[0], data[1], data[2]];
    });

    expect(colors).toEqual([
      [0, 0, 255],
      [0, 255, 0],
      [255, 0, 0],
    ]);
  });
});

describe("集成：文本变量默认值", () => {
  it("先解包 $txtN[默认值]，再替换关键词变量", async () => {
    const template = {
      type: "IMG",
      avatar: [],
      text: [
        { text: "$txt1[$to]", pos: [10, 20], size: 16 },
        { text: "$from", pos: [10, 50], size: 16 },
      ],
      background: { size: [120, 80] as [number, number], color: "#fff" },
    };

    const scene = await prepareScene(template);

    expect(scene.texts[0].lines[0].text).toBe("TA");
    expect(scene.texts[1].lines[0].text).toBe("我");
  });
});

describe("集成：RANDOM 头像输入", () => {
  it("接收 Blob[] 候选列表，空数组时提示缺少 RANDOM 输入", async () => {
    const template = {
      type: "IMG",
      avatar: [{ type: "RANDOM", pos: [0, 0, 32, 32] }],
      text: [],
      background: { size: [64, 64] as [number, number], color: "#fff" },
    };
    const avatarBuf = readFileSync(resolve(here, "../fixtures/avatar.jpg"));
    const avatarBlob = new Blob([avatarBuf], { type: "image/jpeg" });

    await expect(prepareScene(template, { inputs: { random: [] } })).rejects.toThrow(
      /缺少 RANDOM 头像输入/,
    );

    const scene = await prepareScene(template, { inputs: { random: [avatarBlob] } });
    expect(scene.topAvatars).toHaveLength(1);
    expect(renderAllFrames(scene)).toHaveLength(1);
  });
});

describe("集成：顺序多头像与可选头像", () => {
  it("按 USER input 下标取头像，并跳过缺失的可选图层", async () => {
    const red = createCanvas(8, 8) as HTMLCanvasElement;
    red.getContext("2d")!.fillStyle = "#ff0000";
    red.getContext("2d")!.fillRect(0, 0, 8, 8);
    const blue = createCanvas(8, 8) as HTMLCanvasElement;
    blue.getContext("2d")!.fillStyle = "#0000ff";
    blue.getContext("2d")!.fillRect(0, 0, 8, 8);
    const toBlob = (canvas: HTMLCanvasElement) =>
      new Blob([new Uint8Array((canvas as unknown as NCanvas).toBuffer("image/png"))], {
        type: "image/png",
      });

    const template = {
      type: "IMG",
      avatar: [
        { type: "USER", input: 0, pos: [0, 0, 8, 8] },
        { type: "USER", input: 1, pos: [8, 0, 8, 8] },
        { type: "USER", input: 2, optional: true, pos: [0, 8, 8, 8] },
      ],
      text: [],
      background: { size: [16, 16], color: "#ffffff" },
    };
    const scene = await prepareScene(template, {
      inputs: { user: [toBlob(red), toBlob(blue)] },
    });
    const frame = renderAllFrames(scene)[0];
    const ctx = frame.getContext("2d", { willReadFrequently: true })!;

    expect(Array.from(ctx.getImageData(4, 4, 1, 1).data)).toEqual([255, 0, 0, 255]);
    expect(Array.from(ctx.getImageData(12, 4, 1, 1).data)).toEqual([0, 0, 255, 255]);
    expect(Array.from(ctx.getImageData(4, 12, 1, 1).data)).toEqual([255, 255, 255, 255]);
  });

  it("缺少必需的 USER 输入时给出具体槽位提示", async () => {
    await expect(
      prepareScene(
        {
          type: "IMG",
          avatar: [{ type: "USER", input: 1, pos: [0, 0, 8, 8] }],
          text: [],
          background: { size: [8, 8], color: "#ffffff" },
        },
        { inputs: { user: [] } },
      ),
    ).rejects.toThrow(/缺少 USER 头像输入 #2/);
  });

  it("USER 输入缺失时可回退到指定头像，并按显示条件跳过图层", async () => {
    const red = createCanvas(4, 4) as HTMLCanvasElement;
    red.getContext("2d")!.fillStyle = "#ff0000";
    red.getContext("2d")!.fillRect(0, 0, 4, 4);
    const blue = createCanvas(4, 4) as HTMLCanvasElement;
    blue.getContext("2d")!.fillStyle = "#0000ff";
    blue.getContext("2d")!.fillRect(0, 0, 4, 4);
    const toBlob = (canvas: HTMLCanvasElement) =>
      new Blob([new Uint8Array((canvas as unknown as NCanvas).toBuffer("image/png"))], {
        type: "image/png",
      });
    const template = {
      type: "IMG",
      avatar: [
        { type: "USER", input: 1, fallbackInput: 0, pos: [0, 0, 4, 4] },
        { type: "USER", input: 0, optional: true, visibleWhenInput: 1, pos: [4, 0, 4, 4] },
      ],
      text: [],
      background: { size: [8, 4], color: "#ffffff" },
    };
    const onlyFirst = renderAllFrames(
      await prepareScene(template, { inputs: { user: [toBlob(red)] } }),
    )[0];
    const firstAndSecond = renderAllFrames(
      await prepareScene(template, { inputs: { user: [toBlob(red), toBlob(blue)] } }),
    )[0];

    expect(Array.from(onlyFirst.getContext("2d")!.getImageData(2, 2, 1, 1).data)).toEqual([
      255, 0, 0, 255,
    ]);
    expect(Array.from(onlyFirst.getContext("2d")!.getImageData(6, 2, 1, 1).data)).toEqual([
      255, 255, 255, 255,
    ]);
    expect(Array.from(firstAndSecond.getContext("2d")!.getImageData(2, 2, 1, 1).data)).toEqual([
      0, 0, 255, 255,
    ]);
    expect(Array.from(firstAndSecond.getContext("2d")!.getImageData(6, 2, 1, 1).data)).toEqual([
      255, 0, 0, 255,
    ]);
  });
});

describe("集成：逐帧头像属性", () => {
  it.each([
    ["angle", { angle: [0, 15, 30] }],
    ["opacity", { opacity: [1, 0.5, 0] }],
    [
      "preFitSize",
      {
        preFitSize: [
          [2, 2],
          [3, 3],
          [4, 4],
        ],
      },
    ],
    ["preRotate", { preRotate: [0, 30, 60] }],
  ])("单背景模板按 %s 的逐帧声明扩大场景帧数", async (_name, declaration) => {
    const avatar = createCanvas(2, 2) as HTMLCanvasElement;
    const avatarBlob = new Blob(
      [new Uint8Array((avatar as unknown as NCanvas).toBuffer("image/png"))],
      {
        type: "image/png",
      },
    );
    const scene = await prepareScene(
      {
        type: "IMG",
        avatar: [{ type: "TO", pos: [0, 0, 2, 2], ...declaration }],
        text: [],
        background: { size: [4, 4], color: "#ffffff" },
      },
      { inputs: { to: avatarBlob } },
    );

    expect(scene.frameCount).toBe(3);
  });

  it.each([
    ["opacity", { opacity: Array.from({ length: 513 }, () => 1) }, /场景帧数过多/],
    ["preFitSize", { preFitSize: Array.from({ length: 513 }, () => [2, 2]) }, /preFitSize/],
    ["preRotate", { preRotate: Array.from({ length: 513 }, () => 0) }, /场景帧数过多/],
  ])("在视频解码前拒绝超过上限的 %s 逐帧声明", async (_name, declaration, error) => {
    await expect(
      prepareScene(
        {
          type: "IMG",
          avatar: [{ type: "TO", pos: [0, 0, 2, 2], ...declaration }],
          text: [],
          background: { size: [4, 4], color: "#ffffff" },
        },
        { inputs: { to: new Blob(["video"], { type: "video/mp4" }) } },
      ),
    ).rejects.toThrow(error);
  });

  it("仅有逐帧滤镜参数时也扩大场景帧数", async () => {
    const avatar = createCanvas(2, 2) as HTMLCanvasElement;
    const avatarBlob = new Blob(
      [new Uint8Array((avatar as unknown as NCanvas).toBuffer("image/png"))],
      {
        type: "image/png",
      },
    );
    const scene = await prepareScene(
      {
        type: "IMG",
        avatar: [
          {
            type: "TO",
            pos: [0, 0, 2, 2],
            filter: [{ type: "CONTRAST", brightness: [-1, 0, 1], contrast: 0 }],
          },
        ],
        text: [],
        background: { size: [4, 4], color: "#ffffff" },
      },
      { inputs: { to: avatarBlob } },
    );

    expect(scene.frameCount).toBe(3);
  });

  it("在视频解码前拒绝超过上限的逐帧滤镜参数", async () => {
    await expect(
      prepareScene(
        {
          type: "IMG",
          avatar: [
            {
              type: "TO",
              pos: [0, 0, 2, 2],
              filter: [
                {
                  type: "CONTRAST",
                  brightness: Array.from({ length: 513 }, () => 0),
                  contrast: 0,
                },
              ],
            },
          ],
          text: [],
          background: { size: [4, 4], color: "#ffffff" },
        },
        { inputs: { to: new Blob(["video"], { type: "video/mp4" }) } },
      ),
    ).rejects.toThrow(/场景帧数过多/);
  });

  it("投影扩大场景帧数时按帧展开滤镜参数", async () => {
    const avatar = createCanvas(8, 8) as HTMLCanvasElement;
    const avatarCtx = avatar.getContext("2d")!;
    avatarCtx.fillStyle = "#ff0000";
    avatarCtx.fillRect(0, 0, 8, 8);
    const avatarBlob = new Blob(
      [new Uint8Array((avatar as unknown as NCanvas).toBuffer("image/png"))],
      {
        type: "image/png",
      },
    );
    const scene = await prepareScene(
      {
        type: "IMG",
        avatar: [
          {
            type: "TO",
            pos: [0, 0, 8, 8],
            projection: { type: "ROTATE_Y", angle: [0, 0] },
            filter: [{ type: "CONTRAST", brightness: [-1, 0], contrast: 0 }],
          },
        ],
        text: [],
        background: { size: [8, 8], color: "#ffffff" },
      },
      { inputs: { to: avatarBlob } },
    );
    const frames = renderAllFrames(scene);
    const colors = frames.map((frame) =>
      Array.from(frame.getContext("2d")!.getImageData(4, 4, 1, 1).data.slice(0, 3)),
    );

    expect(scene.frameCount).toBe(2);
    expect(colors[0][0]).toBe(colors[0][1]);
    expect(colors[0][1]).toBe(colors[0][2]);
    expect(colors[1][0]).toBeGreaterThan(colors[1][1]);
    expect(colors[1]).not.toEqual(colors[0]);
  });

  it("按帧应用不透明度，并在透明帧中不留下头像像素", async () => {
    const avatarBuf = readFileSync(resolve(here, "../fixtures/avatar.jpg"));
    const avatarBlob = new Blob([avatarBuf], { type: "image/jpeg" });
    const blank = () => createCanvas(32, 32) as HTMLCanvasElement;
    const template = {
      type: "GIF",
      avatar: [
        {
          type: "TO",
          pos: [
            [0, 0, 32, 32],
            [0, 0, 32, 32],
          ],
          opacity: [1, 0],
        },
      ],
      text: [],
    };

    const frames = renderAllFrames(
      await prepareScene(template, {
        inputs: { to: avatarBlob },
        backgroundImages: [blank(), blank()],
      }),
    );
    const alphaAtCenter = (frame: HTMLCanvasElement) =>
      frame.getContext("2d", { willReadFrequently: true })!.getImageData(16, 16, 1, 1).data[3];

    expect(alphaAtCenter(frames[0])).toBe(255);
    expect(alphaAtCenter(frames[1])).toBe(0);
  });
});

describe("集成：DEFORM 源尺寸适配", () => {
  it("在透视变形前按 COVER 裁出指定比例", async () => {
    const source = createCanvas(4, 2) as HTMLCanvasElement;
    const sourceCtx = source.getContext("2d")!;
    sourceCtx.fillStyle = "#ff0000";
    sourceCtx.fillRect(0, 0, 1, 2);
    sourceCtx.fillStyle = "#00ff00";
    sourceCtx.fillRect(1, 0, 2, 2);
    sourceCtx.fillStyle = "#0000ff";
    sourceCtx.fillRect(3, 0, 1, 2);
    const avatar = new Blob(
      [new Uint8Array((source as unknown as NCanvas).toBuffer("image/png"))],
      {
        type: "image/png",
      },
    );

    const scene = await prepareScene(
      {
        type: "IMG",
        avatar: [
          {
            type: "TO",
            posType: "DEFORM",
            pos: [
              [0, 0],
              [4, 0],
              [4, 4],
              [0, 4],
              [0, 0],
            ],
            deformSize: [4, 4],
            fit: "COVER",
          },
        ],
        text: [],
        background: { size: [4, 4] as [number, number], color: "#ffffff00" },
      },
      { inputs: { to: avatar } },
    );
    const pixel = renderAllFrames(scene)[0]
      .getContext("2d", { willReadFrequently: true })!
      .getImageData(2, 2, 1, 1).data;

    expect([...pixel.slice(0, 3)]).toEqual([0, 255, 0]);
  });
});

describe("集成：文字 position 基准（典中典类模板）", () => {
  it("position=[CENTER,BOTTOM] 让文字水平居中、贴底，不溢出画布", async () => {
    // 复刻 bible（典中典）的文字定位：pos[0,0] + align CENTER + position [CENTER,BOTTOM]
    // 使用 NONE 换行模式，让边界框等于单字宽高，便于断言几何关系。
    const canvasW = 200;
    const canvasH = 100;
    const template = {
      type: "IMG",
      avatar: [],
      text: [
        {
          text: "典",
          pos: [0, 0],
          size: 40,
          color: "#ffffff",
          align: "CENTER",
          wrap: "NONE",
          position: ["CENTER", "BOTTOM"] as const,
        },
      ],
      background: { size: [canvasW, canvasH] as [number, number], color: "#000000" },
    };

    const scene = await prepareScene(template);
    const t = scene.texts[0];
    expect(t.position).toEqual(["CENTER", "BOTTOM"]);

    const line = t.lines[0];
    // CENTER 基准 → 整段文字水平居中，不溢出左右
    expect(line.x).toBeGreaterThanOrEqual(0);
    expect(line.x + t.bboxWidth).toBeLessThanOrEqual(canvasW);
    // BOTTOM 基准 → 文字基线落在画布下半部分（存在缺陷时 y≈fontSize，会落在顶部）
    expect(line.y).toBeGreaterThan(canvasH / 2);
    expect(line.y).toBeLessThanOrEqual(canvasH);

    const frames = renderAllFrames(scene);
    savePng(frames[0], "position-center-bottom.png");
  });

  it("无 position 时使用默认基准 [LEFT,TOP]", async () => {
    const template = {
      type: "IMG",
      avatar: [],
      text: [{ text: "X", pos: [10, 20], size: 16 }],
      background: { size: [100, 100] as [number, number], color: "#fff" },
    };
    const scene = await prepareScene(template);
    const t = scene.texts[0];
    expect(t.position).toEqual(["LEFT", "TOP"]);
    // 默认基准无偏移：第一行 y = rawY + fontHeight（贴近顶部）
    expect(t.lines[0].x).toBeGreaterThanOrEqual(0);
    expect(t.lines[0].y).toBeLessThan(50);
  });
});

describe("集成：bible 模板（典中典，动态背景尺寸 + position）", () => {
  it("加载真实模板 + 头像，渲染并输出 PNG", async () => {
    const templatePath = resolve(root, "public/data/templates/bible/data.json");
    const template = readJson(templatePath);

    const avatarBuf = readFileSync(resolve(here, "../fixtures/avatar.jpg"));
    const avatarBlob = new Blob([avatarBuf], { type: "image/jpeg" });

    const scene = await prepareScene(template, { inputs: { to: avatarBlob } });

    // 动态背景尺寸 = [avatar0Width, avatar0Height + text0Height*1.4 + 12]
    expect(scene.template.type).toBe("IMG");
    expect(scene.width).toBeGreaterThan(0);
    expect(scene.height).toBeGreaterThan(scene.width * 0.5); // 高度含文字行
    expect(scene.frameCount).toBe(1);

    // 文字必须用上 position（否则会落在左上角溢出）
    const txt = scene.texts[0];
    expect(txt.position).toEqual(["CENTER", "BOTTOM"]);
    for (const line of txt.lines) {
      expect(line.x).toBeGreaterThanOrEqual(0);
      expect(line.x + txt.bboxWidth).toBeLessThanOrEqual(scene.width);
    }

    const frames = renderAllFrames(scene);
    expect(frames).toHaveLength(1);
    savePng(frames[0], "bible.png");
  });
});

describe("集成：头像滤镜走完整管线", () => {
  it("IMG 模板中的 GIF 头像经过滤镜后仍保留全部动画帧", async () => {
    const red = createCanvas(12, 12);
    const blue = createCanvas(12, 12);
    const redCtx = red.getContext("2d")!;
    redCtx.fillStyle = "#ff0000";
    redCtx.fillRect(0, 0, 12, 12);
    const blueCtx = blue.getContext("2d")!;
    blueCtx.fillStyle = "#0000ff";
    blueCtx.fillRect(0, 0, 12, 12);
    const avatarBlob = encodeGif([red, blue], { delay: [40, 120], transparent: false });

    const rawTemplate = {
      type: "IMG",
      avatar: [
        {
          type: "TO",
          pos: [0, 0, 12, 12],
          filter: [{ type: "CONTRAST", brightness: 0, contrast: 0 }],
        },
      ],
      text: [],
      background: { size: [12, 12], color: "#ffffff" },
    };
    const scene = await prepareScene(rawTemplate, { inputs: { to: avatarBlob } });

    expect(scene.frameCount).toBe(2);
    expect(scene.frameDelays).toEqual([40, 120]);
    expect(scene.topAvatars[0].frames).toHaveLength(2);
    const frames = renderAllFrames(scene);
    const first = frames[0].getContext("2d")!.getImageData(6, 6, 1, 1).data;
    const second = frames[1].getContext("2d")!.getImageData(6, 6, 1, 1).data;
    expect(first[0]).toBeGreaterThan(first[2]);
    expect(second[2]).toBeGreaterThan(second[0]);
    const exported = encodeGif(frames, { delay: scene.frameDelays, transparent: false });
    expect((await decodeGif(exported)).delays).toEqual([40, 120]);

    const reversed = await prepareScene(
      { ...rawTemplate, reverse: true },
      { inputs: { to: avatarBlob } },
    );
    expect(reversed.frameDelays).toEqual([120, 40]);
  });

  it("模板带 filter 字段 → prepareScene → 渲染帧中滤镜已生效", async () => {
    // CONTRAST brightness=-1 会把头像压成纯黑；若滤镜未接入，头像会保留原色
    const template = {
      type: "IMG",
      avatar: [
        {
          type: "FROM",
          pos: [10, 10, 40, 40],
          fit: "FILL",
          filter: [{ type: "CONTRAST", brightness: -1, contrast: 0 }],
        },
      ],
      text: [],
      background: { size: [100, 100], color: "#ffffff" },
    };

    const avatarBuf = readFileSync(resolve(here, "../fixtures/avatar.jpg"));
    const avatarBlob = new Blob([avatarBuf], { type: "image/jpeg" });

    const scene = await prepareScene(template, { inputs: { from: avatarBlob } });
    const frames = renderAllFrames(scene);
    expect(frames).toHaveLength(1);
    savePng(frames[0], "filter-pipeline.png");

    // 头像区域 (20,20) 在 brightness=-1 下应为纯黑
    const ctx = frames[0].getContext("2d", { willReadFrequently: true })!;
    const avatarPx = ctx.getImageData(20, 20, 1, 1).data;
    expect(avatarPx[0] + avatarPx[1] + avatarPx[2]).toBe(0);
    // 背景区域 (0,0) 仍为白
    const bgPx = ctx.getImageData(0, 0, 1, 1).data;
    expect(bgPx[0]).toBe(255);
  });

  it("小写 filter type 也能走通管线", async () => {
    const template = {
      type: "IMG",
      avatar: [
        {
          type: "FROM",
          pos: [10, 10, 40, 40],
          fit: "FILL",
          filter: [{ type: "oil" }],
        },
      ],
      text: [],
      background: { size: [100, 100], color: "#ffffff" },
    };

    const avatarBuf = readFileSync(resolve(here, "../fixtures/avatar.jpg"));
    const avatarBlob = new Blob([avatarBuf], { type: "image/jpeg" });

    const scene = await prepareScene(template, { inputs: { from: avatarBlob } });
    const frames = renderAllFrames(scene);
    expect(frames).toHaveLength(1);
    // 不崩溃 + 尺寸正确即说明小写 oil 被正确解析并应用
    expect(frames[0].width).toBe(100);
    expect(frames[0].height).toBe(100);
  });
});

describe("非 optional 图层的 visibleWhenInput", () => {
  // 回归：visibleWhenInput 声明「仅当指定 USER 输入存在时才显示此图层」，
  // 但引擎仅在 optional 分支消费该字段，非 optional 图层照常渲染或抛错（评审意见 I4）。
  it("输入缺失时跳过图层而不是抛错或回退渲染", async () => {
    const red = createCanvas(4, 4) as HTMLCanvasElement;
    red.getContext("2d")!.fillStyle = "#ff0000";
    red.getContext("2d")!.fillRect(0, 0, 4, 4);
    const blue = createCanvas(4, 4) as HTMLCanvasElement;
    blue.getContext("2d")!.fillStyle = "#0000ff";
    blue.getContext("2d")!.fillRect(0, 0, 4, 4);
    const toBlob = (canvas: HTMLCanvasElement) =>
      new Blob([new Uint8Array((canvas as unknown as NCanvas).toBuffer("image/png"))], {
        type: "image/png",
      });
    const template = {
      type: "IMG",
      avatar: [
        { type: "USER", input: 0, pos: [0, 0, 4, 4] },
        { type: "USER", input: 1, visibleWhenInput: 1, pos: [4, 0, 4, 4] },
      ],
      text: [],
      background: { size: [8, 4], color: "#ffffff" },
    };

    // 只上传 user[0]：第二个图层应隐藏（背景保持白色），而不是抛「缺少 USER 头像输入 #2」
    const onlyFirst = renderAllFrames(
      await prepareScene(template, { inputs: { user: [toBlob(red)] } }),
    )[0];
    expect(Array.from(onlyFirst.getContext("2d")!.getImageData(2, 2, 1, 1).data)).toEqual([
      255, 0, 0, 255,
    ]);
    expect(Array.from(onlyFirst.getContext("2d")!.getImageData(6, 2, 1, 1).data)).toEqual([
      255, 255, 255, 255,
    ]);

    // 上传 user[1] 后图层正常出现
    const both = renderAllFrames(
      await prepareScene(template, { inputs: { user: [toBlob(red), toBlob(blue)] } }),
    )[0];
    expect(Array.from(both.getContext("2d")!.getImageData(6, 2, 1, 1).data)).toEqual([
      0, 0, 255, 255,
    ]);
  });
});
