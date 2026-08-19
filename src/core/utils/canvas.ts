/**
 * Canvas 通用辅助函数。
 */

import {
  type RuntimeCanvas,
  type RuntimeContext,
  type RuntimeImage,
  createCanvas,
} from "./runtime";

/**
 * 把任意 Image / Canvas 复制到一张新的 Canvas 上。
 * 用于"冻结当前状态"或者让 image 可以被进一步绘制（GIF 解码后的帧等场景）。
 */
export function copyAsCanvas(
  source: RuntimeImage | RuntimeCanvas,
  willReadFrequently = false,
): RuntimeCanvas {
  const canvas = createCanvas(source.width, source.height);
  const ctx = canvas.getContext("2d", { willReadFrequently }) as RuntimeContext;
  ctx.drawImage(source, 0, 0);
  return canvas;
}

/**
 * 校验数组长度。
 */
export function assertArrayLength<T>(arr: readonly T[], length: number, label = "array"): T[] {
  if (arr.length !== length) {
    throw new Error(`${label}.length 必须为 ${length}，实际为 ${arr.length}`);
  }
  return arr as T[];
}

/**
 * 绕指定原点旋转后续绘制（角度制）。调用方负责 save/restore。
 * 与手写 translate→rotate→translate(-) 序列逐位等价。
 */
export function rotateAround(
  ctx: RuntimeContext,
  angleDegrees: number,
  originX: number,
  originY: number,
): void {
  ctx.translate(originX, originY);
  ctx.rotate((angleDegrees * Math.PI) / 180);
  ctx.translate(-originX, -originY);
}
