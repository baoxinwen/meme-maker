/**
 * Vitest 测试初始化：给所有测试注入一个基于 @napi-rs/canvas 的运行时，
 * 这样引擎代码无需修改即可在 Node 环境下渲染真实像素。
 *
 * 同时注册测试用的字体文件（Aller-Bold）。
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Canvas,
  GlobalFonts,
  Image,
  createCanvas as nCreateCanvas,
  loadImage as nLoadImage,
} from "@napi-rs/canvas";
import { setRuntime } from "../src/core/utils/runtime";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const fontPath = resolve(root, "public/data/fonts/Aller-Bold.ttf");

// 注册字体：字体族名需要与模板里的 font 字段对应。
GlobalFonts.registerFromPath(fontPath, "Aller-Bold");
GlobalFonts.registerFromPath(fontPath, "Aller");
for (const { family, path } of [
  { family: "MiSans", path: resolve(root, "public/data/fonts/MiSans-Bold.ttf") },
  { family: "MiSans Bold", path: resolve(root, "public/data/fonts/MiSans-Bold.ttf") },
  { family: "MiSans-Bold", path: resolve(root, "public/data/fonts/MiSans-Bold.ttf") },
]) {
  if (existsSync(path)) GlobalFonts.registerFromPath(path, family);
}

// jsdom 默认的全局 Blob 与 Node 全局 Blob 不同；这里统一使用 Node 实现。
// （后续 React 测试若需 DOM Blob，会在那一层覆盖）

setRuntime({
  // @napi-rs/canvas 的 Canvas / Image 在我们用到的 API 上与 DOM 兼容；
  // 用 unknown→cast 而非 any，避免污染整个模块的类型
  createCanvas: (width: number, height: number) =>
    nCreateCanvas(width, height) as unknown as HTMLCanvasElement,

  loadImage: async (source) => {
    let buffer: Buffer | string;
    if (typeof source === "string") {
      buffer = source;
    } else if (source instanceof Uint8Array) {
      buffer = Buffer.from(source);
    } else if (source instanceof ArrayBuffer) {
      buffer = Buffer.from(source);
    } else if (source instanceof Blob) {
      buffer = Buffer.from(await source.arrayBuffer());
    } else {
      throw new Error("无法识别的图片来源");
    }
    const img = await nLoadImage(buffer);
    return img as unknown as HTMLImageElement;
  },
});

// 给一个工具函数：测试代码从磁盘加载图片成 Blob
export async function fileToBlob(path: string, mimeType = "image/jpeg"): Promise<Blob> {
  const buf = readFileSync(path);
  return new Blob([buf], { type: mimeType });
}

// 暴露 napi 工厂给集成测试用（绕过运行时也能直接用）
export { nCreateCanvas, nLoadImage, Canvas, Image };
