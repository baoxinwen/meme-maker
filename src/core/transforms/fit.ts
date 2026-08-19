/**
 * 把头像图片按 fit 模式画到目标矩形区域内。
 *
 * - FILL：拉伸填满（可能变形）
 * - CONTAIN：保持比例，完整显示，多余区域留空
 * - COVER：保持比例，铺满目标区域，多余部分被裁掉
 * COVER 直接使用 `ctx.drawImage` 的九参数形式完成裁剪。
 */

import type { AvatarFit } from "../schema/template";
import type { RuntimeCanvas, RuntimeContext, RuntimeImage } from "../utils/runtime";

export function drawFit(
  ctx: RuntimeContext,
  image: RuntimeImage | RuntimeCanvas,
  x: number,
  y: number,
  w: number,
  h: number,
  fit: AvatarFit,
): void {
  const imgW = image.width;
  const imgH = image.height;

  switch (fit) {
    case "FILL":
      ctx.drawImage(image, x, y, w, h);
      return;

    case "CONTAIN": {
      const scale = Math.min(w / imgW, h / imgH);
      const sw = imgW * scale;
      const sh = imgH * scale;
      const dx = x + (w - sw) / 2;
      const dy = y + (h - sh) / 2;
      ctx.drawImage(image, dx, dy, sw, sh);
      return;
    }

    case "COVER": {
      const scale = Math.max(w / imgW, h / imgH);
      const sw = imgW * scale;
      const sh = imgH * scale;
      // 在源图坐标里裁掉超出目标的部分
      const overflowW = (sw - w) / scale;
      const overflowH = (sh - h) / scale;
      const sx = overflowW / 2;
      const sy = overflowH / 2;
      ctx.drawImage(image, sx, sy, imgW - overflowW, imgH - overflowH, x, y, w, h);
      return;
    }
  }
}
