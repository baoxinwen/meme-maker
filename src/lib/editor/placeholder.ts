/**
 * 预览用的占位头像 —— 画一个简单笑脸，给所有头像槽位复用。
 * 仅编辑器预览用；不进入模板/导出。
 */

import { createCanvas } from "@/core/utils/runtime";

let _promise: Promise<Blob> | null = null;

async function makePlaceholderAvatar(): Promise<Blob> {
  const size = 128;
  const c = createCanvas(size, size);
  const ctx = c.getContext("2d")!;

  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, "#60a5fa");
  g.addColorStop(1, "#a78bfa");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#1e293b";
  ctx.beginPath();
  ctx.arc(size * 0.38, size * 0.42, 7, 0, Math.PI * 2);
  ctx.arc(size * 0.62, size * 0.42, 7, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#1e293b";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(size / 2, size * 0.58, 22, 0.1 * Math.PI, 0.9 * Math.PI);
  ctx.stroke();

  return new Promise((resolve, reject) => {
    c.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("toBlob null"))), "image/png");
  });
}

export function getPlaceholderAvatarBlob(): Promise<Blob> {
  // 失败时清空缓存，允许下次调用重试（与 font-loader 的 loadPromise 策略一致）。
  if (!_promise) {
    _promise = makePlaceholderAvatar().catch((error) => {
      _promise = null;
      throw error;
    });
  }
  return _promise;
}
