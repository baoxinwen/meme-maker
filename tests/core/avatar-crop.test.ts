import type { Canvas as NCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";

import { createCanvas, encodeGif, normalizeAvatarCrop } from "../../src/core";
import { prepareAvatar } from "../../src/core/renderer/avatar";
import type { AvatarSource } from "../../src/core/renderer/avatar";
import type { AvatarTemplate } from "../../src/core/schema/template";

function quadrantPng(): Blob {
  const canvas = createCanvas(4, 4) as unknown as NCanvas;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ff0000";
  ctx.fillRect(0, 0, 2, 2);
  ctx.fillStyle = "#00ff00";
  ctx.fillRect(2, 0, 2, 2);
  ctx.fillStyle = "#0000ff";
  ctx.fillRect(0, 2, 2, 2);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(2, 2, 2, 2);
  return new Blob([canvas.toBuffer("image/png")], { type: "image/png" });
}

function splitFrame(rightColor: string): HTMLCanvasElement {
  const canvas = createCanvas(8, 4);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ff0000";
  ctx.fillRect(0, 0, 4, 4);
  ctx.fillStyle = rightColor;
  ctx.fillRect(4, 0, 4, 4);
  return canvas;
}

function rgbaAt(canvas: HTMLCanvasElement, x = 0, y = 0): number[] {
  return Array.from(canvas.getContext("2d")!.getImageData(x, y, 1, 1).data);
}

const template: AvatarTemplate = { type: "TO", pos: [0, 0, 2, 2] };

describe("头像用户取景", () => {
  it("接受浮点误差范围内的贴边取景并规范化为精确边界", () => {
    expect(
      normalizeAvatarCrop({
        x: 89,
        y: 10,
        width: 11.00000000000001,
        height: 90.00000000000001,
      }),
    ).toEqual({ x: 89, y: 10, width: 11, height: 90 });
  });

  it("极小但为正的贴边取景不会在规范化时塌缩为零宽度", () => {
    const crop = normalizeAvatarCrop({
      x: 99.99999999,
      y: 0,
      width: 0.00000001,
      height: 100,
    });

    expect(crop.width).toBeGreaterThan(0);
    expect(crop.x + crop.width).toBe(100);
  });

  it.each([
    ["静态图片", "image/png"],
    ["GIF", "image/gif"],
    ["视频", "video/mp4"],
  ])("在解码%s前拒绝非法取景", async (_, type) => {
    const source = {
      blob: new Blob(["不是有效媒体"], { type }),
      crop: { x: 90, y: 0, width: 20, height: 100 },
    };

    await expect(prepareAvatar(template, { to: source })).rejects.toThrow(/头像取景范围无效/);
  });

  it.each([
    ["缺失", {}],
    ["null", { crop: null }],
  ])("对象型输入的 crop %s时在解码前明确报错", async (_, extra) => {
    const malformed = {
      blob: new Blob(["不是有效 GIF"], { type: "image/gif" }),
      ...extra,
    } as unknown as AvatarSource;

    await expect(prepareAvatar(template, { to: malformed })).rejects.toThrow(
      /头像取景参数缺失或无效/,
    );
  });

  it("在模板裁剪前按百分比矩形裁切静态头像", async () => {
    const source: AvatarSource = {
      blob: quadrantPng(),
      crop: { x: 50, y: 50, width: 50, height: 50 },
    };

    const prepared = await prepareAvatar(template, { to: source });
    const canvas = prepared.frames[0] as unknown as NCanvas;
    const pixel = canvas.getContext("2d").getImageData(0, 0, 1, 1).data;

    expect(canvas.width).toBe(2);
    expect(canvas.height).toBe(2);
    expect([...pixel]).toEqual([255, 255, 255, 255]);
  });

  it("拒绝越界或零尺寸取景参数", async () => {
    await expect(
      prepareAvatar(template, {
        to: { blob: quadrantPng(), crop: { x: 90, y: 0, width: 20, height: 50 } },
      }),
    ).rejects.toThrow(/头像取景范围无效/);

    await expect(
      prepareAvatar(template, {
        to: { blob: quadrantPng(), crop: { x: 0, y: 0, width: 0, height: 50 } },
      }),
    ).rejects.toThrow(/头像取景范围无效/);
  });

  it("省略取景参数时保留完整头像兼容旧调用", async () => {
    const prepared = await prepareAvatar(template, { to: quadrantPng() });
    expect(prepared.frames[0]).toMatchObject({ width: 4, height: 4 });
  });

  it("GIF 每一帧使用同一取景区域且把逐帧延迟保留到 PreparedAvatar", async () => {
    const gif = encodeGif([splitFrame("#00ff00"), splitFrame("#0000ff")], {
      delay: [40, 120],
      transparent: false,
    });

    const prepared = await prepareAvatar(template, {
      to: { blob: gif, crop: { x: 50, y: 0, width: 50, height: 100 } },
    });

    expect(prepared.frames).toHaveLength(2);
    expect(prepared.frames[0]).toMatchObject({ width: 4, height: 4 });
    expect(prepared.frames[1]).toMatchObject({ width: 4, height: 4 });
    expect(rgbaAt(prepared.frames[0])[1]).toBeGreaterThan(200);
    expect(rgbaAt(prepared.frames[1])[2]).toBeGreaterThan(200);
    expect(prepared.frameDelays).toEqual([40, 120]);
    expect(prepared.sourceFrameDelays).toEqual([[40, 120]]);
  });

  it("先应用用户取景，再执行模板 square 规则", async () => {
    const squareTemplate: AvatarTemplate = {
      type: "TO",
      pos: [0, 0, 4, 4],
      square: true,
    };
    const source = encodeGif([splitFrame("#00ff00")], {
      delay: 80,
      transparent: false,
    });

    const prepared = await prepareAvatar(squareTemplate, {
      to: { blob: source, crop: { x: 50, y: 0, width: 50, height: 100 } },
    });

    expect(prepared.frames[0]).toMatchObject({ width: 4, height: 4 });
    expect(rgbaAt(prepared.frames[0])[1]).toBeGreaterThan(200);
  });
});
