/**
 * 滤镜测试 —— 覆盖 11 种滤镜的「不崩溃 + 尺寸正确 + 有内容」，
 * 对确定性场景（恒等映射、纯色不变等）做像素级断言，
 * 另测 `applyFilters` 空数组、链式应用和滤镜结构默认值。
 */

import { describe, expect, it, vi } from "vitest";
import { applyFilters } from "../../src/core/filters";
import {
  afterimageFilter,
  blurFilter,
  bulgeFilter,
  colorizeFilter,
  contrastFilter,
  denoiseFilter,
  dotScreenFilter,
  halftoneFilter,
  hsbFilter,
  noiseFilter,
  oilFilter,
  pixelateFilter,
  swimFilter,
  swirlFilter,
} from "../../src/core/filters";
import { oilSamplingParams } from "../../src/core/filters/oil";
import { renderScreen } from "../../src/core/filters/screen";
import { AvatarFilterSchema } from "../../src/core/schema/template";
import { createCanvas } from "../../src/core/utils/runtime";

/** 纯色画布 */
function solid(w: number, h: number, color: string) {
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  return c;
}

/** 左半 colorA / 右半 colorB 的画布（用于扭曲滤镜的有内容验证） */
function splitImage(w: number, h: number, colorA: string, colorB: string) {
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = colorA;
  ctx.fillRect(0, 0, w / 2, h);
  ctx.fillStyle = colorB;
  ctx.fillRect(w / 2, 0, w / 2, h);
  return c;
}

function readPixel(c: HTMLCanvasElement, x: number, y: number) {
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  const d = ctx.getImageData(x, y, 1, 1).data;
  return [d[0], d[1], d[2], d[3]] as const;
}

// ---------------------------------------------------------------------------
// 像素级滤镜
// ---------------------------------------------------------------------------

describe("blurFilter", () => {
  it("纯色模糊后中心像素不变（邻域全是同色）", () => {
    const out = blurFilter(solid(16, 16, "#cc00aa"), { type: "BLUR", radius: 3 });
    expect(out.width).toBe(16);
    expect(out.height).toBe(16);
    expect(readPixel(out, 8, 8)).toEqual([204, 0, 170, 255]);
  });

  it("radius=0 等价于原图复制", () => {
    const src = splitImage(8, 8, "#ff0000", "#0000ff");
    const out = blurFilter(src, { type: "BLUR", radius: 0 });
    expect(readPixel(out, 1, 1)).toEqual([255, 0, 0, 255]);
  });
});

describe("noiseFilter", () => {
  it("尺寸不变、alpha 保持、RGB 受扰动", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const out = noiseFilter(solid(12, 12, "#ff0000"), { type: "NOISE", amount: 0.25 });
    random.mockRestore();

    expect(out.width).toBe(12);
    expect(readPixel(out, 6, 6)).toEqual([223, 32, 32, 255]);
  });
});

describe("pixelateFilter", () => {
  it("把同一像素块内的颜色归并，并保持原图尺寸", () => {
    const source = createCanvas(4, 2);
    const context = source.getContext("2d")!;
    context.fillStyle = "#ff0000";
    context.fillRect(0, 0, 2, 2);
    context.fillStyle = "#0000ff";
    context.fillRect(2, 0, 2, 2);

    const output = pixelateFilter(source, { type: "PIXELATE", size: 2 });

    expect(output).toMatchObject({ width: 4, height: 2 });
    expect(readPixel(output, 0, 0)).toEqual(readPixel(output, 1, 1));
    expect(readPixel(output, 2, 0)).toEqual(readPixel(output, 3, 1));
    expect(readPixel(output, 0, 0)).not.toEqual(readPixel(output, 3, 1));
  });
});

describe("contrastFilter", () => {
  it("brightness=-1 把任意像素压成黑", () => {
    const out = contrastFilter(solid(8, 8, "#8050a0"), {
      type: "CONTRAST",
      brightness: -1,
      contrast: 0,
    });
    const [r, g, b] = readPixel(out, 4, 4);
    expect(r).toBe(0);
    expect(g).toBe(0);
    expect(b).toBe(0);
  });

  it("brightness=0 contrast=0 等价原图", () => {
    const src = solid(8, 8, "#3366aa");
    const out = contrastFilter(src, { type: "CONTRAST", brightness: 0, contrast: 0 });
    expect(readPixel(out, 4, 4)).toEqual([51, 102, 170, 255]);
  });
});

describe("colorizeFilter", () => {
  it("保留像素明度并替换为目标色相", () => {
    const out = colorizeFilter(solid(8, 8, "#808080"), {
      type: "COLORIZE",
      color: [57, 78, 125],
    });
    const [red, green, blue, alpha] = readPixel(out, 4, 4);

    expect(red).toBeLessThan(green);
    expect(green).toBeLessThan(blue);
    expect(0.3 * red + 0.59 * green + 0.11 * blue).toBeCloseTo(128, -1);
    expect(alpha).toBe(255);
  });
});

describe("afterimageFilter", () => {
  it("opacity=0 时保持原图像素，正常参数保持尺寸", () => {
    const source = splitImage(8, 20, "#ff0000", "#0000ff");
    const unchanged = afterimageFilter(source, {
      type: "AFTERIMAGE",
      fraction: 0.1,
      opacity: 0,
    });
    const effected = afterimageFilter(source, {
      type: "AFTERIMAGE",
      fraction: 0.1,
      opacity: 0.2,
    });

    expect(readPixel(unchanged, 2, 2)).toEqual(readPixel(source, 2, 2));
    expect(effected).toMatchObject({ width: 8, height: 20 });
  });
});

describe("hsbFilter", () => {
  it("saturation=-1 退化为灰度（R=G=B）", () => {
    const out = hsbFilter(solid(10, 10, "#ff8800"), {
      type: "HSB",
      hue: 0,
      saturation: -1,
      brightness: 0,
    });
    const [r, g, b] = readPixel(out, 5, 5);
    expect(r).toBe(g);
    expect(g).toBe(b);
  });

  it("全 0 参数等价原图", () => {
    const src = solid(8, 8, "#123456");
    const out = hsbFilter(src, { type: "HSB", hue: 0, saturation: 0, brightness: 0 });
    const [r, g, b] = readPixel(out, 4, 4);
    // 允许 ±1 的浮点误差
    expect(r).toBeGreaterThanOrEqual(17);
    expect(r).toBeLessThanOrEqual(19);
    expect(g).toBeGreaterThanOrEqual(51);
    expect(g).toBeLessThanOrEqual(53);
    expect(b).toBeGreaterThanOrEqual(85);
    expect(b).toBeLessThanOrEqual(87);
  });
});

describe("denoiseFilter", () => {
  it("纯色图降噪后不变（邻域全同色）", () => {
    const out = denoiseFilter(solid(12, 12, "#44aabb"), { type: "DENOISE", exponent: 20 });
    expect(readPixel(out, 6, 6)).toEqual([68, 170, 187, 255]);
  });
});

describe("oilFilter", () => {
  it("纯色图油画化后不变", () => {
    const out = oilFilter(solid(16, 16, "#55aa33"), {
      type: "OIL",
      skip: 4,
      levels: 8,
      range: 12,
    });
    expect(readPixel(out, 8, 8)).toEqual([85, 170, 51, 255]);
  });

  it("尺寸保持、不崩溃", () => {
    const out = oilFilter(splitImage(20, 20, "#ff0000", "#00ff00"), {
      type: "OIL",
      skip: 2,
      levels: 8,
      range: 6,
    });
    expect(out.width).toBe(20);
    expect(out.height).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// 几何扭曲滤镜
// ---------------------------------------------------------------------------

describe("swirlFilter", () => {
  it("尺寸保持、中心区域有内容（不透明）", () => {
    const out = swirlFilter(splitImage(32, 32, "#ff0000", "#0000ff"), {
      type: "SWIRL",
      radius: 0,
      angle: 3,
      x: 0.5,
      y: 0.5,
    });
    expect(out.width).toBe(32);
    expect(readPixel(out, 16, 16)[3]).toBe(255);
  });
});

describe("bulgeFilter", () => {
  it("strength=0 为恒等映射", () => {
    const src = splitImage(24, 24, "#aabbcc", "#112233");
    const out = bulgeFilter(src, {
      type: "BULGE",
      radius: 10,
      strength: 0,
      x: 0.5,
      y: 0.5,
    });
    // 取几个点比对
    for (const [x, y] of [
      [2, 2],
      [12, 12],
      [20, 5],
    ]) {
      expect(readPixel(out, x, y)).toEqual(readPixel(src, x, y));
    }
  });
});

describe("swimFilter", () => {
  it("amount=0 为恒等映射", () => {
    const src = splitImage(24, 24, "#ff8800", "#0088ff");
    const out = swimFilter(src, {
      type: "SWIM",
      scale: 32,
      stretch: 1,
      angle: 0,
      amount: 0,
      turbulence: 1,
      time: 0,
    });
    expect(readPixel(out, 6, 6)).toEqual(readPixel(src, 6, 6));
    expect(readPixel(out, 18, 18)).toEqual(readPixel(src, 18, 18));
  });
});

// ---------------------------------------------------------------------------
// 半色调滤镜
// ---------------------------------------------------------------------------

describe("halftoneFilter", () => {
  it("纯白图 → 全白（无网点）", () => {
    const out = halftoneFilter(solid(32, 32, "#ffffff"), {
      type: "HALFTONE",
      angle: 0,
      radius: 4,
      x: 0.5,
      y: 0.5,
    });
    expect(readPixel(out, 16, 16)).toEqual([255, 255, 255, 255]);
  });

  it("纯黑图 → 中心网点为黑（K 版画了点）", () => {
    const out = halftoneFilter(solid(32, 32, "#000000"), {
      type: "HALFTONE",
      angle: 0,
      radius: 4,
      x: 0.5,
      y: 0.5,
    });
    const [r, g, b] = readPixel(out, 16, 16);
    // 网点中心 (cx,cy)=(16,16) 是 K 版网格点，应被黑色填上
    expect(r).toBeLessThan(128);
    expect(g).toBeLessThan(128);
    expect(b).toBeLessThan(128);
  });
});

describe("dotScreenFilter", () => {
  it("纯黑图 → 中心网点为黑", () => {
    const out = dotScreenFilter(solid(32, 32, "#000000"), {
      type: "DOT_SCREEN",
      angle: 0,
      radius: 4,
      x: 0.5,
      y: 0.5,
    });
    const [r, g, b] = readPixel(out, 16, 16);
    expect(r).toBeLessThan(128);
    expect(g).toBeLessThan(128);
    expect(b).toBeLessThan(128);
  });

  it("纯白图 → 全白", () => {
    const out = dotScreenFilter(solid(32, 32, "#ffffff"), {
      type: "DOT_SCREEN",
      angle: 0,
      radius: 4,
      x: 0.5,
      y: 0.5,
    });
    expect(readPixel(out, 16, 16)).toEqual([255, 255, 255, 255]);
  });
});

// ---------------------------------------------------------------------------
// 分发器与数据结构校验
// ---------------------------------------------------------------------------

describe("applyFilters", () => {
  it("空数组返回原图副本（不同引用、同像素）", () => {
    const src = solid(8, 8, "#ff0000");
    const out = applyFilters(src, []);
    expect(out).not.toBe(src);
    expect(out.width).toBe(8);
    expect(readPixel(out, 4, 4)).toEqual([255, 0, 0, 255]);
  });

  it("链式应用：[CONTRAST brightness=-1] → 全黑", () => {
    const out = applyFilters(solid(8, 8, "#3366aa"), [
      { type: "CONTRAST", brightness: -1, contrast: 0 },
    ]);
    const [r, g, b] = readPixel(out, 4, 4);
    expect(r + g + b).toBe(0);
  });

  it("多滤镜串联顺序应用", () => {
    // gray 风格不会让 contrast 把它变非黑；这里只验证串联不崩 + 尺寸
    const out = applyFilters(solid(10, 10, "#ff0000"), [
      { type: "BLUR", radius: 2 },
      { type: "HSB", hue: 0.3, saturation: 0.2, brightness: 0 },
    ]);
    expect(out.width).toBe(10);
    expect(out.height).toBe(10);
  });

  it("拒绝非有限运行时参数", () => {
    expect(() =>
      applyFilters(solid(8, 8, "#ffffff"), [{ type: "BLUR", radius: Number.POSITIVE_INFINITY }]),
    ).toThrow(/滤镜参数必须是有限数值/);
  });

  it("拒绝超过操作量预算的滤镜", () => {
    expect(() =>
      applyFilters(solid(8, 8, "#ffffff"), [{ type: "OIL", skip: 1, levels: 8, range: 10_000 }]),
    ).toThrow(/滤镜计算量过大/);
  });

  it("拒绝超出归一化范围的网屏中心坐标", () => {
    expect(() =>
      applyFilters(solid(8, 8, "#ffffff"), [
        { type: "DOT_SCREEN", angle: 0, radius: 4, x: 2, y: 0.5 },
      ]),
    ).toThrow(/网屏中心坐标/);
  });

  it("拒绝非有限的底层网屏几何参数", () => {
    expect(() =>
      renderScreen({
        source: solid(1, 1, "#ffffff"),
        cellSize: 2,
        angle: 0,
        cx: Number.POSITIVE_INFINITY,
        cy: 0,
        planes: [],
      }),
    ).toThrow(/网屏几何参数/);
  });

  it("按单帧整条滤镜链累计操作量", () => {
    const filters = Array.from(
      { length: 32 },
      () => ({ type: "AFTERIMAGE", fraction: 1, opacity: 0 }) as const,
    );

    expect(() => applyFilters(solid(1, 1_300, "#ffffff"), filters)).toThrow(/滤镜计算总量过大/);
  });

  it("运行时同样限制滤镜数量", () => {
    const filters = Array.from({ length: 33 }, () => ({ type: "NOISE", amount: 0 }) as const);

    expect(() => applyFilters(solid(1, 1, "#ffffff"), filters)).toThrow(/滤镜数量过多/);
  });
});

describe("AvatarFilterSchema", () => {
  it("{type:'oil'} 解析补默认值", () => {
    const parsed = AvatarFilterSchema.parse({ type: "oil" });
    expect(parsed).toMatchObject({ type: "OIL", skip: 4, levels: 8, range: 12 });
  });

  it("{type:'swirl'} 解析补默认值", () => {
    const parsed = AvatarFilterSchema.parse({ type: "swirl" });
    expect(parsed).toMatchObject({
      type: "SWIRL",
      radius: 0,
      angle: 3,
      x: 0.5,
      y: 0.5,
    });
  });

  it("接受 COLORIZE 的 RGB 元组", () => {
    expect(AvatarFilterSchema.parse({ type: "colorize", color: [57, 78, 125] })).toEqual({
      type: "COLORIZE",
      color: [57, 78, 125],
    });
  });

  it("接受 AFTERIMAGE 参数", () => {
    expect(AvatarFilterSchema.parse({ type: "afterimage" })).toMatchObject({
      type: "AFTERIMAGE",
      fraction: 0.1,
      opacity: 0.01,
    });
  });

  it("为 PIXELATE 补默认块大小", () => {
    expect(AvatarFilterSchema.parse({ type: "pixelate" })).toEqual({
      type: "PIXELATE",
      size: 10,
    });
  });

  it("未知 type 抛错", () => {
    expect(() => AvatarFilterSchema.parse({ type: "MIRAGE" })).toThrow();
  });

  it("显式参数覆盖默认值", () => {
    const parsed = AvatarFilterSchema.parse({ type: "blur", radius: 25 });
    expect(parsed).toMatchObject({ type: "BLUR", radius: 25 });
  });

  it("大写 type 也接受", () => {
    const parsed = AvatarFilterSchema.parse({ type: "OIL" });
    expect(parsed).toMatchObject({ type: "OIL", skip: 4, levels: 8, range: 12 });
  });

  it("接受混合大小写的 type", () => {
    const parsed = AvatarFilterSchema.parse({ type: "Swirl" });
    expect(parsed.type).toBe("SWIRL");
  });

  it("拒绝非有限数值和过大的复杂度参数", () => {
    expect(() =>
      AvatarFilterSchema.parse({ type: "blur", radius: Number.POSITIVE_INFINITY }),
    ).toThrow();
    expect(() => AvatarFilterSchema.parse({ type: "oil", range: 10_000 })).toThrow();
    expect(() => AvatarFilterSchema.parse({ type: "afterimage", fraction: 2 })).toThrow();
  });
});

describe("oilSamplingParams", () => {
  // 回归：range 0 会让邻域采样数为 0，输出整帧全透明（评审意见 M2）。
  it("range 钳到最小 1", () => {
    expect(oilSamplingParams(1, 0).range).toBe(1);
    expect(oilSamplingParams(0, 2.4).range).toBe(2);
  });
});
