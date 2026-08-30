/**
 * 生成 PWA 图标资源（一次性脚本，非应用代码）。
 *
 * 用 @napi-rs/canvas 画一套占位图标：
 *   - 渐变背景（与首页 theme_color #0f172a 协调）
 *   - 居中一个简化的「闪光」标志（对应首页 Sparkles 图标）
 *   - 192x192 / 512x512 / 512x512 可遮罩图标（包含安全区内边距）
 *
 * 运行：node scripts/gen-icons.mjs  （或 pnpm exec node scripts/gen-icons.mjs）
 * 产物写到 public/icons/。
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GlobalFonts, createCanvas } from "@napi-rs/canvas";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../public/icons");
mkdirSync(outDir, { recursive: true });

/** 画闪光标志到一个给定 ctx 上，居中、占 size 的 fraction。 */
function drawSparkles(ctx, cx, cy, size, color) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const s = size; // 整体尺度

  // 主四角星（大）
  const drawStar = (cx2, cy2, rOuter, rInner, points) => {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 === 0 ? rOuter : rInner;
      const a = (Math.PI / points) * i - Math.PI / 2;
      const x = cx2 + Math.cos(a) * r;
      const y = cy2 + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  };

  // 主星（稍偏左上）
  drawStar(-s * 0.12, -s * 0.12, s * 0.42, s * 0.18, 4);
  // 副星（右下，小）
  drawStar(s * 0.28, s * 0.3, s * 0.22, s * 0.1, 4);

  // 两道光线（点缀）
  ctx.lineWidth = s * 0.06;
  ctx.beginPath();
  ctx.moveTo(s * 0.3, -s * 0.42);
  ctx.lineTo(s * 0.42, -s * 0.3);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-s * 0.42, s * 0.3);
  ctx.lineTo(-s * 0.3, s * 0.42);
  ctx.stroke();

  ctx.restore();
}

/** 渲染一张图标并写入 PNG。生成可遮罩图标时在四周保留安全区内边距。 */
function renderIcon(size, filename, { maskable = false } = {}) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");

  // 背景：深色渐变（左上深蓝 → 右下紫）
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, "#1e3a8a");
  g.addColorStop(0.5, "#4f46e5");
  g.addColorStop(1, "#7c3aed");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  // 可遮罩图标：Android 会进行圆形或圆角裁切，内容需保留约 10% 的安全区内边距。
  const pad = maskable ? size * 0.12 : 0;
  const inner = size - pad * 2;

  // 闪光标志居中
  drawSparkles(ctx, size / 2, size / 2, inner * 0.5, "#ffffff");

  const png = canvas.toBuffer("image/png");
  const outPath = resolve(outDir, filename);
  writeFileSync(outPath, png);
  console.log(`✓ ${filename} (${size}x${size}${maskable ? " maskable" : ""})`);
}

// GlobalFonts 在 napi-rs/canvas 中默认包含系统字体，这里不需要注册额外字体。
void GlobalFonts;

renderIcon(192, "icon-192.png");
renderIcon(512, "icon-512.png");
renderIcon(512, "icon-maskable-512.png", { maskable: true });

console.log(`\n图标已生成到 ${outDir}`);
