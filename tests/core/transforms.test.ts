/**
 * 变换函数测试 —— 验证 crop / flip / mirror / gray / binarize / clip-circle
 * 的输出尺寸和典型像素值。
 */

import { describe, expect, it } from "vitest";
import {
  binarizeImage,
  clipCircleImage,
  clipMaskImage,
  clipPolygonImage,
  cropImage,
  flipImage,
  grayImage,
  invertImage,
  mirrorImage,
  projectRotateY,
  rotateImage,
  squareImage,
} from "../../src/core/transforms";
import { createCanvas } from "../../src/core/utils/runtime";

/** 造一张 4x4 测试画布：左半红，右半蓝 */
function makeTestImage() {
  const c = createCanvas(4, 4);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#ff0000";
  ctx.fillRect(0, 0, 2, 4);
  ctx.fillStyle = "#0000ff";
  ctx.fillRect(2, 0, 2, 4);
  return c;
}

function readPixel(c: HTMLCanvasElement, x: number, y: number) {
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
  return [r, g, b] as const;
}

describe("cropImage", () => {
  it("两参数形式：从 (0,0) 裁出 w*h", () => {
    const out = cropImage(makeTestImage(), [2, 2]);
    expect(out.width).toBe(2);
    expect(out.height).toBe(2);
    expect(readPixel(out, 0, 0)).toEqual([255, 0, 0]);
  });

  it("四参数形式：[x1, y1, x2, y2]", () => {
    const out = cropImage(makeTestImage(), [2, 0, 4, 4]);
    expect(out.width).toBe(2);
    expect(out.height).toBe(4);
    expect(readPixel(out, 0, 0)).toEqual([0, 0, 255]);
  });

  it("百分比模式", () => {
    const out = cropImage(makeTestImage(), [0, 0, 50, 100], true);
    // 50% 宽 = 2 像素，100% 高 = 4 像素
    expect(out.width).toBe(2);
    expect(out.height).toBe(4);
  });
});

describe("squareImage", () => {
  it("从宽图中心裁出最大正方形", () => {
    const source = createCanvas(4, 2);
    const ctx = source.getContext("2d")!;
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 1, 2);
    ctx.fillStyle = "#00ff00";
    ctx.fillRect(1, 0, 2, 2);
    ctx.fillStyle = "#0000ff";
    ctx.fillRect(3, 0, 1, 2);

    const out = squareImage(source);
    expect(out.width).toBe(2);
    expect(out.height).toBe(2);
    expect(readPixel(out, 0, 0)).toEqual([0, 255, 0]);
    expect(readPixel(out, 1, 0)).toEqual([0, 255, 0]);
  });
});

describe("flipImage / mirrorImage", () => {
  it("flip 把上下颠倒（左半红、右半蓝保持，但 y 反转）", () => {
    const flipped = flipImage(makeTestImage());
    expect(flipped.width).toBe(4);
    expect(flipped.height).toBe(4);
    // 像素颜色按列保持（x 没动），但行反转 —— 不过原图所有行都一样，所以应一致
    expect(readPixel(flipped, 0, 0)).toEqual([255, 0, 0]);
    expect(readPixel(flipped, 3, 0)).toEqual([0, 0, 255]);
  });

  it("mirror 把左右镜像 —— 红蓝调换", () => {
    const mirrored = mirrorImage(makeTestImage());
    expect(readPixel(mirrored, 0, 0)).toEqual([0, 0, 255]);
    expect(readPixel(mirrored, 3, 0)).toEqual([255, 0, 0]);
  });
});

describe("grayImage", () => {
  it("红色像素变成灰度（R=G=B）", () => {
    const out = grayImage(makeTestImage());
    const [r, g, b] = readPixel(out, 0, 0);
    expect(r).toBe(g);
    expect(g).toBe(b);
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(255);
  });
});

describe("binarizeImage", () => {
  it("纯红像素亮度 ~76，低于默认 128 → 变黑", () => {
    const out = binarizeImage(makeTestImage());
    expect(readPixel(out, 0, 0)).toEqual([0, 0, 0]);
  });

  it("低阈值时纯红像素 → 白", () => {
    const out = binarizeImage(makeTestImage(), 50);
    expect(readPixel(out, 0, 0)).toEqual([255, 255, 255]);
  });
});

describe("invertImage", () => {
  it("反转 RGB 并保留 alpha", () => {
    const out = invertImage(makeTestImage());
    expect(readPixel(out, 0, 0)).toEqual([0, 255, 255]);
    expect(out.getContext("2d")!.getImageData(0, 0, 1, 1).data[3]).toBe(255);
  });
});

describe("clipCircleImage", () => {
  it("尺寸保持，角落像素几乎透明", () => {
    const out = clipCircleImage(makeTestImage());
    expect(out.width).toBe(4);
    expect(out.height).toBe(4);
    // 角落 (0,0) 在圆外 —— alpha 接近 0（受抗锯齿影响，允许少量非零）
    const ctx = out.getContext("2d")!;
    const alpha = ctx.getImageData(0, 0, 1, 1).data[3];
    expect(alpha).toBeLessThan(128);
    // 中心应该完全不透明
    const centerAlpha = ctx.getImageData(2, 2, 1, 1).data[3];
    expect(centerAlpha).toBe(255);
  });
});

describe("clipMaskImage", () => {
  it("按蒙版 alpha 保留中心并清除透明区域", () => {
    const mask = createCanvas(4, 4);
    const maskCtx = mask.getContext("2d")!;
    maskCtx.fillStyle = "#ffffff";
    maskCtx.fillRect(1, 1, 2, 2);

    const out = clipMaskImage(makeTestImage(), mask);
    const ctx = out.getContext("2d")!;
    expect(ctx.getImageData(0, 0, 1, 1).data[3]).toBe(0);
    expect(readPixel(out, 1, 1)).toEqual([255, 0, 0]);
    expect(ctx.getImageData(1, 1, 1, 1).data[3]).toBe(255);
  });
});

describe("clipPolygonImage", () => {
  it("保留三角形内部并清除外部像素", () => {
    const source = makeTestImage();
    const out = clipPolygonImage(source, [
      [2, 0],
      [0, 4],
      [4, 4],
    ]);
    const ctx = out.getContext("2d")!;

    expect(ctx.getImageData(0, 0, 1, 1).data[3]).toBe(0);
    expect(ctx.getImageData(2, 2, 1, 1).data[3]).toBeGreaterThan(0);
  });
});

describe("rotateImage", () => {
  it("CROP 保持画布尺寸，EXPAND 使用旋转后的完整包围盒", () => {
    const source = makeTestImage();
    const cropped = rotateImage(source, 90, "CROP");
    const expanded = rotateImage(source, 90, "EXPAND");

    expect(cropped.width).toBe(4);
    expect(cropped.height).toBe(4);
    expect(expanded.width).toBe(4);
    expect(expanded.height).toBe(4);
  });

  it("非方图 EXPAND 后宽高随旋转互换", () => {
    const source = createCanvas(4, 2);
    const out = rotateImage(source, 90, "EXPAND");

    expect(out.width).toBe(2);
    expect(out.height).toBe(4);
  });
});

describe("projectRotateY", () => {
  it("零度保持原矩形，180 度翻转左右朝向", () => {
    expect(projectRotateY(100, 60, 0)).toEqual([
      [0, 0],
      [100, 0],
      [100, 60],
      [0, 60],
    ]);

    const halfTurn = projectRotateY(100, 60, 180);
    expect(halfTurn[0][0]).toBeGreaterThan(halfTurn[1][0]);
    expect(halfTurn[0][1]).toBeCloseTo(0);
    expect(halfTurn[3][1]).toBeCloseTo(60);
  });

  it("斜向投影产生近大远小的透视边", () => {
    const projected = projectRotateY(100, 60, 60, 45);
    const leftHeight = projected[3][1] - projected[0][1];
    const rightHeight = projected[2][1] - projected[1][1];

    expect(Math.abs(leftHeight - rightHeight)).toBeGreaterThan(1);
  });
});
