/**
 * DEFORM 透视变形测试 —— 验证单应性 + 三角网格贴图的正确性。
 */

import { describe, expect, it } from "vitest";
import { deformToCanvas } from "../../src/core/transforms/deform";
import { createCanvas } from "../../src/core/utils/runtime";

/** 造一张纯色图 */
function solid(w: number, h: number, color: string) {
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  return c;
}

function alphaAt(c: HTMLCanvasElement, x: number, y: number) {
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  return ctx.getImageData(x, y, 1, 1).data[3];
}

describe("deformToCanvas", () => {
  it("恒等映射：目标四边形=源矩形时，内容大致不变", () => {
    const src = solid(40, 40, "#ff0000");
    const out = deformToCanvas(
      src,
      [
        [0, 0],
        [40, 0],
        [40, 40],
        [0, 40],
      ],
      40,
      40,
    );
    // 中心应被填充（不透明）
    expect(alphaAt(out, 20, 20)).toBe(255);
  });

  it("映射到画布右下角区域，左上角应为空", () => {
    const src = solid(30, 30, "#00ff00");
    const out = deformToCanvas(
      src,
      [
        [50, 50],
        [90, 50],
        [90, 90],
        [50, 90],
      ],
      100,
      100,
    );
    // 目标区域中心 (70,70) 有内容
    expect(alphaAt(out, 70, 70)).toBe(255);
    // 左上角 (5,5) 应为空
    expect(alphaAt(out, 5, 5)).toBe(0);
  });

  it("透视梯形映射不崩溃且目标区域有内容", () => {
    const src = solid(50, 50, "#0000ff");
    // 上窄下宽的梯形
    const out = deformToCanvas(
      src,
      [
        [30, 10],
        [70, 10],
        [90, 90],
        [10, 90],
      ],
      100,
      100,
    );
    // 底部中心一定在梯形内
    expect(alphaAt(out, 50, 85)).toBe(255);
  });
});
