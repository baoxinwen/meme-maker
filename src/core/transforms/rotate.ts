/**
 * 图像预旋转。
 *
 * CROP 保持原始画布尺寸并从中心旋转；EXPAND 生成刚好容纳旋转结果的新画布。
 * 这两种模式分别对应上游模板常用的 rotate_crop 与 rotate 语义。
 */

import { createCanvas } from "../utils/runtime";
import type { RuntimeCanvas, RuntimeImage } from "../utils/runtime";

export type ImageRotationMode = "CROP" | "EXPAND";

function stableTrig(angle: number): { cos: number; sin: number } {
  const radians = (angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    cos: Math.abs(cos) < 1e-10 ? 0 : cos,
    sin: Math.abs(sin) < 1e-10 ? 0 : sin,
  };
}

export function rotateImage(
  source: RuntimeImage | RuntimeCanvas,
  angle: number,
  mode: ImageRotationMode,
): RuntimeCanvas {
  const { width: sourceWidth, height: sourceHeight } = source;
  const { cos, sin } = stableTrig(angle);
  const width =
    mode === "EXPAND"
      ? Math.max(1, Math.ceil(Math.abs(sourceWidth * cos) + Math.abs(sourceHeight * sin)))
      : sourceWidth;
  const height =
    mode === "EXPAND"
      ? Math.max(1, Math.ceil(Math.abs(sourceWidth * sin) + Math.abs(sourceHeight * cos)))
      : sourceHeight;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d")!;
  ctx.translate(width / 2, height / 2);
  ctx.rotate((angle * Math.PI) / 180);
  ctx.drawImage(source, -sourceWidth / 2, -sourceHeight / 2);
  return canvas;
}
