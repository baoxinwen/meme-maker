/**
 * 模板加载器 —— 从 public/data/templates/ 加载模板和背景图片。
 *
 * 数据流：
 *   1. fetchTemplateIndex()        →  返回所有可用模板的元数据
 *   2. fetchTemplate(key)          →  返回某个模板的 data.json + 背景帧
 *   3. (传入引擎做 prepareScene)
 */

import { loadImage, parseTemplate } from "@/core";
import type { PetpetTemplate } from "@/core";
import { MAX_MEDIA_EDGE, MAX_SCENE_FRAMES } from "@/core";
import { logger } from "@/lib/logger";

export interface TemplateIndexEntry {
  /** 模板 ID（即文件夹名） */
  readonly key: string;
  /** 类型（IMG 静态 / GIF 多帧） */
  readonly type: "IMG" | "GIF";
  /** 背景帧数 */
  readonly length: number;
  /** 中文别名（用于搜索） */
  readonly alias: readonly string[];
  /** 一句话描述 */
  readonly description: string;
  /** 是否隐藏；规范化索引会过滤 true 的条目 */
  readonly hidden?: boolean;
  /** 可选的独立缩略图文件名；用于输入图驱动模板展示完整效果。 */
  readonly thumbnail?: string;
  /** 内容寻址版本号（SHA-256）；构建期写入，运行时据此请求不可变资源。 */
  readonly revision?: string;
}

export interface TemplateIndex {
  readonly version: string;
  readonly templates: readonly TemplateIndexEntry[];
}

const BASE_PATH = "/data/templates";
/** 应用层请求超时。Service Worker 仅对 index.json 兜底，这里覆盖所有模板相关请求。 */
const TEMPLATE_FETCH_TIMEOUT_MS = 15_000;
let templateIndexPromise: Promise<TemplateIndex> | null = null;

function isTimeoutError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "TimeoutError";
}

/** 带超时的 fetch：挂起连接超过上限时抛出可读的中文错误。 */
async function fetchTemplateResource(url: string): Promise<Response> {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(TEMPLATE_FETCH_TIMEOUT_MS) });
  } catch (error) {
    if (isTimeoutError(error)) {
      const message = `请求超时（${TEMPLATE_FETCH_TIMEOUT_MS / 1000} 秒）：${url}`;
      logger.error(message);
      throw new Error(message);
    }
    throw error;
  }
}

function templateBasePath(key: string, revision: string | undefined): string {
  return revision ? `/data/template-assets/${key}/${revision}` : `${BASE_PATH}/${key}`;
}

function versionedResourceError(key: string, cause: unknown): Error {
  return new Error(`无法加载模板 ${key} 的版本资源，请检查网络或刷新页面后重试`, { cause });
}

async function loadTemplateImage(
  url: string,
  key: string,
  revision: string | undefined,
): Promise<HTMLImageElement> {
  try {
    const image = await loadImage(url);
    // 上传路径有 assertImageDimensions；模板静态资源此处补同等校验，
    // 防止超大模板图绕过预算直接 createCanvas 巨型画布
    if (image.width <= 0 || image.height <= 0) {
      throw new Error(`模板资源尺寸无效：${url}`);
    }
    if (image.width > MAX_MEDIA_EDGE || image.height > MAX_MEDIA_EDGE) {
      throw new Error(
        `模板资源尺寸超出限制（${image.width}×${image.height}，单边最多 ${MAX_MEDIA_EDGE}px）：${url}`,
      );
    }
    return image;
  } catch (error) {
    logger.error(`模板资源加载失败：${url}`, error);
    if (revision) throw versionedResourceError(key, error);
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeTemplateIndexEntry(value: unknown, index: number): TemplateIndexEntry {
  if (!isRecord(value)) {
    throw new Error(`模板索引第 ${index + 1} 项格式不正确`);
  }

  const { key, type, length, alias, description, hidden, thumbnail, revision } = value;
  if (typeof key !== "string" || key.length === 0) {
    throw new Error(`模板索引第 ${index + 1} 项缺少 key`);
  }
  // key 会拼进资源 URL；白名单阻断路径穿越与外源地址（内置 327 个模板全部匹配）
  if (!/^[\w-]+$/.test(key)) {
    throw new Error(`模板索引 ${key} 的 key 含不允许的字符`);
  }
  if (type !== "IMG" && type !== "GIF") {
    throw new Error(`模板索引 ${key} 的 type 不正确`);
  }
  if (
    typeof length !== "number" ||
    !Number.isInteger(length) ||
    length < 0 ||
    length > MAX_SCENE_FRAMES
  ) {
    throw new Error(`模板索引 ${key} 的 length 不正确（需为 0–${MAX_SCENE_FRAMES} 的整数）`);
  }
  if (hidden !== undefined && typeof hidden !== "boolean") {
    throw new Error(`模板索引 ${key} 的 hidden 字段不正确`);
  }
  if (
    thumbnail !== undefined &&
    (typeof thumbnail !== "string" || !/^[\w.-]+\.png$/.test(thumbnail))
  ) {
    throw new Error(`模板索引 ${key} 的 thumbnail 字段不正确`);
  }
  if (
    revision !== undefined &&
    (typeof revision !== "string" || !/^[a-f0-9]{64}$/.test(revision))
  ) {
    throw new Error(`模板索引 ${key} 的 revision 字段不正确`);
  }

  return {
    key,
    type,
    length,
    alias: Array.isArray(alias)
      ? alias.filter((item): item is string => typeof item === "string")
      : [],
    description: typeof description === "string" ? description : key,
    ...(hidden !== undefined && { hidden }),
    ...(thumbnail !== undefined && { thumbnail }),
    ...(revision !== undefined && { revision }),
  };
}

export function normalizeTemplateIndex(raw: unknown): TemplateIndex {
  if (!isRecord(raw) || !Array.isArray(raw.templates)) {
    throw new Error("模板索引格式不正确");
  }

  // 单条坏数据只跳过并告警，不让全部模板不可见（评审意见 M11）
  const entries: TemplateIndexEntry[] = [];
  let lastError: unknown = null;
  for (const [index, entry] of raw.templates.entries()) {
    try {
      entries.push(normalizeTemplateIndexEntry(entry, index));
    } catch (error) {
      lastError = error;
      logger.warn(`跳过无效的模板索引条目 #${index}`, error);
    }
  }
  if (raw.templates.length > 0 && entries.length === 0) {
    const reason = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`模板索引没有任何有效条目：${reason}`);
  }

  return {
    version: String(raw.version ?? "unknown"),
    templates: entries.filter((entry) => entry.hidden !== true),
  };
}

/**
 * 加载模板索引（不含每个模板的具体内容）。
 */
export async function fetchTemplateIndex(): Promise<TemplateIndex> {
  if (templateIndexPromise) return templateIndexPromise;
  templateIndexPromise = fetchTemplateResource(`${BASE_PATH}/index.json`)
    .then(async (res) => {
      if (!res.ok) {
        logger.error(`无法加载模板索引: HTTP ${res.status}`);
        throw new Error(`无法加载模板索引: HTTP ${res.status}`);
      }
      return normalizeTemplateIndex(await res.json());
    })
    .catch((error) => {
      templateIndexPromise = null;
      throw error;
    });
  return templateIndexPromise;
}

/** 仅供测试：清空索引缓存，恢复"尚未加载"状态（与 editor-store 的 _resetIdCounter 同款）。 */
export function _resetTemplateIndexCacheForTest(): void {
  templateIndexPromise = null;
}

/**
 * 加载某个模板的 data.json + 所有背景帧 PNG。
 *
 * 返回原始模板对象（未校验），由调用方 parseTemplate() 校验。
 */
export async function fetchTemplate(
  key: string,
  length: number,
  revision?: string,
): Promise<{
  rawTemplate: unknown;
  backgrounds: HTMLImageElement[];
  backgroundLayers: Record<string, HTMLImageElement>;
}> {
  const base = templateBasePath(key, revision);
  // 1. 加载 data.json
  const dataRes = await fetchTemplateResource(`${base}/data.json`);
  if (!dataRes.ok) {
    if (revision && (dataRes.status === 404 || dataRes.status === 410)) {
      logger.error(`模板 ${key} 的版本资源缺失：HTTP ${dataRes.status}`);
      throw versionedResourceError(key, new Error(`HTTP ${dataRes.status}`));
    }
    logger.error(`无法加载模板 ${key}/data.json: HTTP ${dataRes.status}`);
    throw new Error(`无法加载模板 ${key}/data.json: HTTP ${dataRes.status}`);
  }
  const rawTemplate = (await dataRes.json()) as PetpetTemplate;

  // 2. 并行加载所有背景帧
  const backgrounds = await Promise.all(
    Array.from({ length }, (_, i) => loadTemplateImage(`${base}/${i}.png`, key, revision)),
  );

  const parsedTemplate = parseTemplate(rawTemplate);
  const layerAssets = [
    ...(parsedTemplate.background?.layers ?? []),
    ...(parsedTemplate.background?.foregroundLayers ?? []),
  ].map((layer) => layer.asset);
  const maskAssets = parsedTemplate.avatar.flatMap((avatar) => (avatar.mask ? [avatar.mask] : []));
  const templateAssets = Array.from(new Set([...layerAssets, ...maskAssets]));
  const layerEntries = await Promise.all(
    templateAssets.map(async (asset) => {
      const image = await loadTemplateImage(`${base}/${asset}`, key, revision);
      return [asset, image] as const;
    }),
  );
  const backgroundLayers = Object.fromEntries(layerEntries);

  return { rawTemplate, backgrounds, backgroundLayers };
}

/**
 * 取模板的缩略图 URL（用于模板选择器中显示）。
 */
export function templateThumbnailUrl(entry: TemplateIndexEntry): string {
  return `${templateBasePath(entry.key, entry.revision)}/${entry.thumbnail ?? "0.png"}`;
}

/**
 * 程序化 GIF 模板的动态缩略图。静态背景模板仍直接使用首帧，避免额外下载重复资源。
 */
export function templateAnimatedThumbnailUrl(key: string, revision?: string): string {
  return `${templateBasePath(key, revision)}/preview.gif`;
}
