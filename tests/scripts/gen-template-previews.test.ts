/**
 * 模板验证，以及按需生成预览/重建索引。
 *
 * 做三件事：
 *   1. 用占位头像 + 各模板自己的背景帧，逐个渲染验证（能否跑通引擎）
 *   2. 对 length=0 的特效模板（无背景帧），渲染第 0 帧存为 0.png 缩略图
 *   3. 只把能渲染且未标记隐藏的模板写入 `index.json`
 *
 * `pnpm test:templates` 只验证，不写文件；`pnpm test:gen-previews` 才更新产物。
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { Canvas as NCanvas } from "@napi-rs/canvas";
import {
  decodeGif,
  encodeGif,
  loadImage,
  parseTemplate,
  prepareScene,
  renderAllFrames,
} from "../../src/core";
import { nCreateCanvas } from "../setup";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const templatesDir = resolve(root, "public/data/templates");
const writeArtifacts = process.env.npm_lifecycle_event === "test:gen-previews";
/** 逗号分隔的聚焦模板 key；未设置时保持全量门禁。 */
const selectedTemplateKeys = new Set(
  (process.env.MEME_MAKER_TEMPLATE_KEYS ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean),
);

const indexedKeys = new Set(
  (
    JSON.parse(readFileSync(resolve(templatesDir, "index.json"), "utf-8")) as {
      templates: readonly { key: string }[];
    }
  ).templates.map((entry) => entry.key),
);
const directoryKeys = new Set(
  readdirSync(templatesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name),
);

/** 占位头像 Blob（引擎用 blob.type 判断格式，必须带 type） */
function makePlaceholderAvatarBlob(): Blob {
  const size = 128;
  const c = nCreateCanvas(size, size);
  const ctx = c.getContext("2d");
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
  return new Blob([new Uint8Array(c.toBuffer("image/png"))], { type: "image/png" });
}

function makeSolidAvatarBlob(color: string): Blob {
  const c = nCreateCanvas(128, 128);
  const ctx = c.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 128, 128);
  return new Blob([new Uint8Array(c.toBuffer("image/png"))], { type: "image/png" });
}

interface Entry {
  key: string;
  type: "IMG" | "GIF";
  length: number;
  alias: readonly string[];
  description: string;
  thumbnail?: string;
}

type RawTemplate = {
  readonly avatar?: readonly { readonly type: string; readonly input?: number }[];
  readonly text?: readonly Record<string, unknown>[];
  readonly hidden?: boolean;
  readonly previewFrame?: number;
  readonly options?: readonly RawTemplateOption[];
};

type RawTemplateOption = {
  readonly type: "BOOLEAN" | "SELECT" | "NUMBER" | "TEXT";
  readonly key: string;
  readonly default: boolean | number | string;
  readonly choices?: readonly { readonly value: string }[];
  readonly min?: number;
  readonly max?: number;
  readonly maxLength?: number;
};

function makeInputs(template: RawTemplate, avatar: Blob): Record<string, Blob | Blob[]> {
  const avatars = template.avatar ?? [];
  const types = Array.from(new Set(avatars.map((item) => item.type)));
  const inputs = Object.fromEntries(
    types.map((type) => [
      type.toLowerCase(),
      type === "RANDOM" || type === "USER" ? [avatar] : avatar,
    ]),
  );
  const requiredUserInputs = avatars
    .filter((item) => item.type === "USER")
    .reduce((count, item) => Math.max(count, Number(item.input ?? 0) + 1), 0);
  if (requiredUserInputs > 0) {
    inputs.user = Array.from({ length: requiredUserInputs }, () => avatar);
  }
  return inputs;
}

function makeAlternateOptionValues(
  template: RawTemplate,
): Record<string, boolean | number | string> {
  const entries: [string, boolean | number | string][] = [];
  for (const option of template.options ?? []) {
    if (option.type === "BOOLEAN") {
      entries.push([option.key, !option.default]);
    } else if (option.type === "SELECT") {
      const alternate = option.choices?.find((choice) => choice.value !== option.default);
      if (alternate) entries.push([option.key, alternate.value]);
    } else if (option.type === "NUMBER") {
      const alternate = option.default === option.max ? option.min : option.max;
      if (alternate !== undefined) entries.push([option.key, alternate]);
    } else {
      const value = `${option.default}校验`.slice(0, option.maxLength ?? 100);
      if (value !== option.default) entries.push([option.key, value]);
    }
  }
  return Object.fromEntries(entries);
}

function hasVisiblePixel(frames: readonly HTMLCanvasElement[]): boolean {
  return frames.some((frame) => {
    const data = frame
      .getContext("2d", { willReadFrequently: true })!
      .getImageData(0, 0, frame.width, frame.height).data;
    for (let index = 3; index < data.length; index += 4) {
      if (data[index] > 0) return true;
    }
    return false;
  });
}

function framesHaveDifferentPixels(
  first: readonly HTMLCanvasElement[],
  second: readonly HTMLCanvasElement[],
): boolean {
  if (first.length !== second.length) return true;

  return first.some((frame, index) => {
    const other = second[index];
    if (frame.width !== other.width || frame.height !== other.height) return true;

    const firstPixels = frame
      .getContext("2d", { willReadFrequently: true })!
      .getImageData(0, 0, frame.width, frame.height).data;
    const secondPixels = other
      .getContext("2d", { willReadFrequently: true })!
      .getImageData(0, 0, other.width, other.height).data;
    return firstPixels.some((pixel, pixelIndex) => pixel !== secondPixels[pixelIndex]);
  });
}

async function writeTextFileWithRetry(path: string, content: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      writeFileSync(path, content, "utf-8");
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 50));
    }
  }
  throw lastError;
}

/** 为动画模板选取与首帧差异最大的帧，作为减少动态时的静态缩略图。 */
function selectRepresentativeFrame(
  frames: readonly HTMLCanvasElement[],
  preferredFrame?: number,
): HTMLCanvasElement {
  if (
    preferredFrame !== undefined &&
    Number.isInteger(preferredFrame) &&
    preferredFrame >= 0 &&
    preferredFrame < frames.length
  ) {
    return frames[preferredFrame];
  }
  const first = frames[0];
  if (frames.length < 2) return first;

  const firstPixels = first
    .getContext("2d", { willReadFrequently: true })!
    .getImageData(0, 0, first.width, first.height).data;
  let selected = first;
  let highestDifference = -1;

  for (const frame of frames.slice(1)) {
    if (frame.width !== first.width || frame.height !== first.height) return frame;
    const pixels = frame
      .getContext("2d", { willReadFrequently: true })!
      .getImageData(0, 0, frame.width, frame.height).data;
    let difference = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (
        pixels[index] !== firstPixels[index] ||
        pixels[index + 1] !== firstPixels[index + 1] ||
        pixels[index + 2] !== firstPixels[index + 2] ||
        pixels[index + 3] !== firstPixels[index + 3]
      ) {
        difference += 1;
      }
    }
    if (difference > highestDifference) {
      highestDifference = difference;
      selected = frame;
    }
  }

  return selected;
}

async function assertPngExport(frame: HTMLCanvasElement): Promise<void> {
  const png = (frame as unknown as NCanvas).toBuffer("image/png");
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);

  const decoded = await loadImage(png);
  expect(decoded.width).toBe(frame.width);
  expect(decoded.height).toBe(frame.height);
}

describe(writeArtifacts ? "模板验证 + 预览生成 + 索引重建" : "模板完整性验证", () => {
  const rawIndex = JSON.parse(readFileSync(resolve(templatesDir, "index.json"), "utf-8"));
  const indexedEntries: Entry[] = rawIndex.templates;
  const missingSelectedKeys = [...selectedTemplateKeys].filter(
    (key) => !indexedEntries.some((entry) => entry.key === key),
  );
  const allEntries =
    selectedTemplateKeys.size > 0
      ? indexedEntries.filter((entry) => selectedTemplateKeys.has(entry.key))
      : indexedEntries;

  it(`逐像素验证并导出全部 ${allEntries.length} 个模板`, async () => {
    expect([...directoryKeys].sort()).toEqual([...indexedKeys].sort());
    expect(missingSelectedKeys).toEqual([]);
    const avatarBlob = makePlaceholderAvatarBlob();
    const alternateAvatarBlob = makeSolidAvatarBlob("#ef4444");
    const ok: Entry[] = [];
    const failed: { key: string; error: string }[] = [];
    const hidden: string[] = [];

    for (const entry of allEntries) {
      try {
        const template = JSON.parse(
          readFileSync(resolve(templatesDir, entry.key, "data.json"), "utf-8"),
        ) as RawTemplate;
        if (template.hidden === true) {
          hidden.push(entry.key);
          continue;
        }
        const parsedTemplate = parseTemplate(template);
        const layerAssets = [
          ...(parsedTemplate.background?.layers ?? []),
          ...(parsedTemplate.background?.foregroundLayers ?? []),
        ].map((layer) => layer.asset);
        const maskAssets = parsedTemplate.avatar.flatMap((avatar) =>
          avatar.mask ? [avatar.mask] : [],
        );
        const templateAssets = Array.from(new Set([...layerAssets, ...maskAssets]));
        const isProgrammaticTemplate = entry.length === 0 && templateAssets.length === 0;

        // 加载背景帧（length=0 的特效模板无背景帧，靠 template.background 生成）
        const bgPath = (i: number) => resolve(templatesDir, entry.key, `${i}.png`);
        // 没有单独 thumbnail 的模板由选择器回退使用 0.png。程序化模板在生成预览时
        // 写入该文件，但不会被加载器当作背景帧；声明了 thumbnail 的模板无需重复保存 0.png。
        if (!writeArtifacts && !entry.thumbnail && !existsSync(bgPath(0))) {
          throw new Error("缺少模板缩略图 0.png");
        }
        const bgs = [];
        for (let i = 0; i < entry.length; i++) {
          if (!existsSync(bgPath(i))) {
            throw new Error(`缺少背景帧 ${i}.png`);
          }
          bgs.push(await loadImage(bgPath(i)));
        }
        const backgroundLayerImages = Object.fromEntries(
          await Promise.all(
            templateAssets.map(async (asset) => [
              asset,
              await loadImage(resolve(templatesDir, entry.key, asset)),
            ]),
          ),
        );
        // 程序化模板的 0.png 只用于选择器预览，不参与场景背景；仍需验证它可被浏览器解码。
        if (entry.length === 0 && existsSync(bgPath(0))) {
          await loadImage(bgPath(0));
        }

        const scene = await prepareScene(template, {
          inputs: makeInputs(template, avatarBlob),
          backgroundImages: bgs,
          backgroundLayerImages,
          avatarMaskImages: backgroundLayerImages,
        });
        const frames = renderAllFrames(scene);
        if (frames.length === 0) throw new Error("渲染出 0 帧");
        if (!hasVisiblePixel(frames)) throw new Error("渲染结果没有可见像素");

        if ((template.avatar?.length ?? 0) > 0) {
          const alternateScene = await prepareScene(template, {
            inputs: makeInputs(template, alternateAvatarBlob),
            backgroundImages: bgs,
            backgroundLayerImages,
            avatarMaskImages: backgroundLayerImages,
          });
          const alternateFrames = renderAllFrames(alternateScene);
          if (!framesHaveDifferentPixels(frames, alternateFrames)) {
            throw new Error("替换头像后成品像素未变化");
          }
        }

        if ((template.text?.length ?? 0) > 0) {
          const alternateTemplate = {
            ...template,
            text: template.text!.map((text, index) => ({
              ...text,
              text: `像素校验${index + 1}`,
            })),
          };
          const alternateScene = await prepareScene(alternateTemplate, {
            inputs: makeInputs(alternateTemplate, avatarBlob),
            backgroundImages: bgs,
            backgroundLayerImages,
            avatarMaskImages: backgroundLayerImages,
          });
          if (!framesHaveDifferentPixels(frames, renderAllFrames(alternateScene))) {
            throw new Error("替换文字后成品像素未变化");
          }
        }

        if ((template.options?.length ?? 0) > 0) {
          const alternateOptionValues = makeAlternateOptionValues(template);
          const alternateScene = await prepareScene(template, {
            inputs: makeInputs(template, avatarBlob),
            optionValues: alternateOptionValues,
            backgroundImages: bgs,
            backgroundLayerImages,
            avatarMaskImages: backgroundLayerImages,
          });
          if (!framesHaveDifferentPixels(frames, renderAllFrames(alternateScene))) {
            throw new Error("修改模板选项后成品像素未变化");
          }
        }

        if (entry.type === "GIF") {
          const gif = encodeGif(frames, { delay: scene.delay, transparent: true });
          const bytes = new Uint8Array(await gif.arrayBuffer());
          if (
            gif.type !== "image/gif" ||
            String.fromCharCode(...bytes.subarray(0, 6)) !== "GIF89a"
          ) {
            throw new Error("GIF 导出格式不正确");
          }
          const decoded = await decodeGif(gif, { maxFrames: frames.length });
          if (decoded.frames.length !== frames.length) {
            throw new Error(`GIF 导出帧数错误：${decoded.frames.length}/${frames.length}`);
          }
          if (entry.length === 0) {
            const animatedPreviewPath = resolve(templatesDir, entry.key, "preview.gif");
            if (writeArtifacts) {
              writeFileSync(animatedPreviewPath, bytes);
            } else {
              if (!existsSync(animatedPreviewPath)) {
                throw new Error("缺少程序化 GIF 缩略图 preview.gif");
              }
              const preview = new Blob([readFileSync(animatedPreviewPath)], { type: "image/gif" });
              const decodedPreview = await decodeGif(preview, { maxFrames: frames.length });
              if (decodedPreview.frames.length !== frames.length) {
                throw new Error(
                  `程序化 GIF 缩略图帧数错误：${decodedPreview.frames.length}/${frames.length}`,
                );
              }
            }
          }
        } else {
          await assertPngExport(frames[0]);
        }

        if (entry.thumbnail) {
          const thumbnailPath = resolve(templatesDir, entry.key, entry.thumbnail);
          if (writeArtifacts) {
            const thumbnail = (
              selectRepresentativeFrame(frames, template.previewFrame) as unknown as NCanvas
            ).toBuffer("image/png");
            writeFileSync(thumbnailPath, thumbnail);
          } else {
            if (!existsSync(thumbnailPath)) {
              throw new Error(`缺少模板缩略图 ${entry.thumbnail}`);
            }
            await loadImage(thumbnailPath);
          }
        }

        // 程序化模板无外部背景帧：始终更新代表性静态缩略图，供减少动态偏好使用。
        if (writeArtifacts && isProgrammaticTemplate) {
          const buf = (
            selectRepresentativeFrame(frames, template.previewFrame) as unknown as NCanvas
          ).toBuffer("image/png");
          writeFileSync(bgPath(0), buf);
        }

        // index.json 的 length 语义 = 磁盘上背景帧文件数（fetchTemplate 按它加载 0.png~{n-1}.png）。
        // 特效模板无背景帧文件，length 保持 0（引擎靠 template.background.length 生成帧）。
        // 不要改成渲染帧数——否则 fetchTemplate 会去加载不存在的 1.png~9.png。
        ok.push(entry);
      } catch (e) {
        failed.push({
          key: entry.key,
          error: e instanceof Error ? e.message.split("\n")[0] : String(e),
        });
      }
    }

    if (writeArtifacts) {
      const entriesForIndex =
        selectedTemplateKeys.size > 0
          ? indexedEntries.map((entry) => {
              if (!selectedTemplateKeys.has(entry.key)) return entry;
              return ok.find((candidate) => candidate.key === entry.key) ?? entry;
            })
          : ok;
      await writeTextFileWithRetry(
        resolve(templatesDir, "index.json"),
        `${JSON.stringify({ version: "1.0.0", templates: entriesForIndex }, null, 2)}\n`,
      );
    }

    console.log(`\n模板验证：${ok.length}/${allEntries.length} 可用`);
    if (hidden.length) {
      console.log(`已跳过 ${hidden.length} 个隐藏模板: ${hidden.join(", ")}`);
    }
    if (failed.length) {
      console.log(`已排除 ${failed.length} 个（数据结构缺口，需后续修复引擎）:`);
      for (const f of failed) console.log(`  - ${f.key}: ${f.error}`);
    }
    expect(failed).toEqual([]);
    expect(ok).toHaveLength(allEntries.length - hidden.length);
  }, 180_000);
});
