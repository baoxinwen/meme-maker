/**
 * 头像准备 —— 解码 Blob → 应用裁剪/风格/圆形遮罩 → 编译位置表达式。
 *
 * 头像处理拆分为两个纯函数：
 *   prepareAvatar(template, blob, sizeVars?) → PreparedAvatar
 *   drawAvatar(ctx, prepared, frameIndex)
 *
 * `posType` 默认使用 ZOOM；COVER 通过 `drawImage` 的九参数形式完成裁剪与绘制。
 */

import { DEFAULT_MAX_GIF_FRAMES, decodeGif } from "../codec/gif-decoder";
import { readImageMetadata } from "../codec/image-metadata";
import { decodeVideo } from "../codec/video-decoder";
import { type AvatarFilter, applyFilters, resolveFiltersForFrame } from "../filters";
import {
  DEFAULT_MAX_MEDIA_MEMORY_BYTES,
  DEFAULT_MAX_SCENE_TOTAL_PIXELS,
  MAX_MEDIA_EDGE,
  MAX_SCENE_FRAMES,
  MAX_USER_AVATAR_INPUTS,
} from "../limits";
import type {
  AvatarFit,
  AvatarPosType,
  AvatarProjection,
  AvatarStyle,
  AvatarTemplate,
  AvatarType,
  TransformOrigin,
} from "../schema/template";
import {
  binarizeImage,
  clipCircleImage,
  clipMaskImage,
  clipPolygonImage,
  cropImage,
  flipImage,
  grayImage,
  invertImage,
  mirrorImage,
  projectRotateY,
  rotateImage,
  squareImage,
} from "../transforms";
import { drawDeform } from "../transforms/deform";
import { drawFit } from "../transforms/fit";
import { copyAsCanvas, rotateAround } from "../utils/canvas";
import { parseColor } from "../utils/color";
import { MissingAvatarInputError } from "../utils/errors";
import { type EvalFn, compileNumber } from "../utils/expression";
import { createCanvas, loadImage } from "../utils/runtime";
import type { RuntimeCanvas, RuntimeContext, RuntimeImage } from "../utils/runtime";
import type { BackgroundLayerImages } from "./background";

// ============================================================================
// 类型
// ============================================================================

export type ZoomPosition = {
  readonly kind: "ZOOM";
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
};

export type DeformPosition = {
  readonly kind: "DEFORM";
  /** 4 个角的坐标，顺序：左上、右上、右下、左下 */
  readonly corners: readonly [number, number][];
  /** 整体偏移锚点 */
  readonly anchor: readonly [number, number];
};

export type FramePosition = ZoomPosition | DeformPosition;

export interface PreparedAvatar {
  readonly type: AvatarType;
  /** 解码前由模板逐帧字段声明的场景帧数。 */
  readonly declaredFrameCount: number;
  /** 已应用 crop/style/round 后的逐帧画布；单图只有 1 帧 */
  readonly frames: readonly RuntimeCanvas[];
  /** 每个 USER 顺序输入各自的动画帧；普通头像只有一组。 */
  readonly sourceFrames: readonly (readonly RuntimeCanvas[])[];
  /** 第一组素材的逐帧延迟；静态图片与视频抽帧没有独立时序。 */
  readonly frameDelays: readonly number[] | null;
  /** 与 sourceFrames 一一对应的 GIF 逐帧延迟。 */
  readonly sourceFrameDelays: readonly (readonly number[] | null)[];
  /** 编译后的位置表达式，按帧索引 */
  readonly posFns: readonly EvalFn[][] | readonly EvalFn[][][];
  readonly posType: AvatarPosType;
  readonly fit: AvatarFit;
  readonly origin: TransformOrigin;
  readonly avatarOnTop: boolean;
  /** 每帧角度；数组不足场景帧数时复用最后一项。 */
  readonly angles: readonly number[];
  /** 每帧不透明度；数组不足场景帧数时复用最后一项。 */
  readonly opacities: readonly number[];
  readonly rotate: boolean;
  readonly imageSmoothingEnabled: boolean | null;
  readonly projection: {
    readonly type: AvatarProjection["type"];
    readonly angles: readonly number[];
    readonly fov: number;
    readonly loop: boolean;
    readonly model?: AvatarProjection["model"];
    readonly cameraSize?: AvatarProjection["cameraSize"];
    readonly align: AvatarProjection["align"];
  } | null;
  readonly inputCycle: {
    readonly framesPerInput: number;
    readonly offset: number;
  } | null;
  readonly when: EvalFn | null;
}

export interface AvatarCrop {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface AvatarSource {
  readonly blob: Blob;
  readonly crop: AvatarCrop;
}

export type AvatarInput = Blob | AvatarSource;

export const FULL_AVATAR_CROP: AvatarCrop = { x: 0, y: 0, width: 100, height: 100 };

/** 百分比取景允许的浮点误差，避免贴边计算被二进制浮点数拒绝。 */
export const AVATAR_CROP_EPSILON = 1e-7;

export interface AvatarInputs {
  readonly from?: AvatarInput;
  readonly to?: AvatarInput;
  readonly bot?: AvatarInput;
  readonly group?: AvatarInput;
  readonly random?: readonly AvatarInput[];
  /** 顺序头像列表，由模板的 USER + input 下标引用。 */
  readonly user?: readonly AvatarInput[];
}

export interface AvatarResourceBudget {
  remainingFrames: number;
  readonly maxEdge: number;
  remainingPixels: number;
  remainingMemoryBytes: number;
  /** 场景调用方仍持有、需与头像管线同时计入的外部资源。 */
  sceneResidentPixels: number;
  sceneResidentMemoryBytes: number;
}

export interface AvatarDecodeOptions {
  readonly maxFrames?: number;
  readonly maxEdge?: number;
  readonly maxTotalPixels?: number;
  readonly maxMemoryBytes?: number;
  /** 多个头像图层共享时由场景合成器注入。 */
  readonly resourceBudget?: AvatarResourceBudget;
}

// ============================================================================
// 位置表达式预编译
// ============================================================================

/**
 * 把模板的 pos 标准化为"按帧索引"的二级嵌套：
 *   ZOOM:   FramePos[] = [[x,y,w,h], [x,y,w,h], ...]
 *   DEFORM: FramePos[] = [[[x,y],[x,y],[x,y],[x,y],[x,y]], ...]
 */
function normalizePos(template: AvatarTemplate): {
  frames: (number | string)[][] | (number | string)[][][];
  posType: AvatarPosType;
} {
  const posType: AvatarPosType = template.posType ?? "ZOOM";
  const raw = template.pos as unknown[];

  if (posType === "ZOOM") {
    // 判断是单帧 [x,y,w,h] 还是多帧 [[...],[...]]
    const isMultiFrame = Array.isArray(raw[0]) && raw[0] !== null && typeof raw[0] !== "string";
    const frames = isMultiFrame ? (raw as (number | string)[][]) : [raw as (number | string)[]];
    for (const f of frames) {
      if (f.length !== 4) {
        throw new Error(`ZOOM 位置每帧必须是 [x, y, w, h] 共 4 个元素，实际为 ${f.length}`);
      }
    }
    if (frames.length > MAX_SCENE_FRAMES) {
      throw new Error(`头像位置帧数过多：${frames.length} 帧，最多支持 ${MAX_SCENE_FRAMES} 帧`);
    }
    return { frames, posType };
  }

  // DEFORM 位置结构
  // 单帧形式 [[x,y],[x,y],[x,y],[x,y],[x,y]] —— 第一个元素是长度为 2 的数组
  // 多帧形式 [[[x,y]*5], [[x,y]*5], ...]
  const first = raw[0];
  if (!Array.isArray(first)) {
    throw new Error("DEFORM 位置必须是嵌套数组");
  }
  const isMultiFrame = Array.isArray(first[0]);
  const frames = isMultiFrame ? (raw as (number | string)[][][]) : [raw as (number | string)[][]];
  for (const f of frames) {
    if (f.length !== 5) {
      throw new Error(`DEFORM 位置每帧必须是 5 个 [x,y] 点，实际为 ${f.length}`);
    }
  }
  if (frames.length > MAX_SCENE_FRAMES) {
    throw new Error(`头像位置帧数过多：${frames.length} 帧，最多支持 ${MAX_SCENE_FRAMES} 帧`);
  }
  return { frames, posType };
}

function compilePos(template: AvatarTemplate): {
  posFns: EvalFn[][] | EvalFn[][][];
  posType: AvatarPosType;
} {
  const { frames, posType } = normalizePos(template);
  if (posType === "ZOOM") {
    const compiled = (frames as (number | string)[][]).map((row) => row.map(compileNumber));
    return { posFns: compiled, posType };
  }
  const compiled = (frames as (number | string)[][][]).map((row) =>
    row.map((pair) => pair.map(compileNumber)),
  );
  return { posFns: compiled, posType };
}

// ============================================================================
// 图像加载 + 变换流水线
// ============================================================================

function positiveAvatarBudget(value: number, label: string, integer = false): number {
  if (!Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value))) {
    throw new Error(`头像${label}预算无效：${value}`);
  }
  return value;
}

export function createAvatarResourceBudget(
  options: AvatarDecodeOptions = {},
): AvatarResourceBudget {
  return {
    remainingFrames: Math.min(
      positiveAvatarBudget(options.maxFrames ?? MAX_SCENE_FRAMES, "帧数", true),
      MAX_SCENE_FRAMES,
    ),
    maxEdge: positiveAvatarBudget(options.maxEdge ?? MAX_MEDIA_EDGE, "边长", true),
    remainingPixels: positiveAvatarBudget(
      options.maxTotalPixels ?? DEFAULT_MAX_SCENE_TOTAL_PIXELS,
      "总像素",
    ),
    remainingMemoryBytes: positiveAvatarBudget(
      options.maxMemoryBytes ?? DEFAULT_MAX_MEDIA_MEMORY_BYTES,
      "内存",
    ),
    sceneResidentPixels: 0,
    sceneResidentMemoryBytes: 0,
  };
}

export function reserveAvatarSceneResources(budget: AvatarResourceBudget, pixels: number): void {
  if (!Number.isSafeInteger(pixels) || pixels < 0) {
    throw new Error(`场景累计像素预算超限：外部资源像素无效 ${pixels}`);
  }
  const memoryBytes = pixels * 4;
  if (!Number.isSafeInteger(memoryBytes)) {
    throw new Error("场景累计内存预算超限：外部资源内存超出安全整数范围");
  }
  if (pixels > budget.remainingPixels) {
    throw new Error(`场景累计像素预算超限：外部资源需要 ${pixels}，剩余 ${budget.remainingPixels}`);
  }
  if (memoryBytes > budget.remainingMemoryBytes) {
    throw new Error(
      `场景累计内存预算超限：外部资源需要 ${memoryBytes} 字节，剩余 ${budget.remainingMemoryBytes} 字节`,
    );
  }
  budget.remainingPixels -= pixels;
  budget.remainingMemoryBytes -= memoryBytes;
  budget.sceneResidentPixels += pixels;
  budget.sceneResidentMemoryBytes += memoryBytes;
}

function assertAvatarBudgetAvailable(budget: AvatarResourceBudget): void {
  if (budget.remainingFrames <= 0) throw new Error("头像解码帧数预算超限：剩余 0 帧");
  if (budget.remainingPixels <= 0) {
    if (budget.sceneResidentPixels > 0) {
      throw new Error(
        `场景累计像素预算超限：外部资源已占 ${budget.sceneResidentPixels}，头像剩余 0`,
      );
    }
    throw new Error("头像解码像素总量超限：剩余 0");
  }
  if (budget.remainingMemoryBytes <= 0) {
    if (budget.sceneResidentMemoryBytes > 0) {
      throw new Error(
        `场景累计内存预算超限：外部资源已占 ${budget.sceneResidentMemoryBytes} 字节，头像剩余 0`,
      );
    }
    throw new Error("头像解码内存预算超限：剩余 0");
  }
}

function consumeAvatarDecodeBudget(
  budget: AvatarResourceBudget,
  frames: readonly { width: number; height: number }[],
): AvatarFrameUsage {
  return reserveAvatarFrames(budget, frames, "头像解码");
}

interface AvatarFrameSize {
  readonly width: number;
  readonly height: number;
}

interface AvatarFrameUsage {
  readonly frameCount: number;
  readonly pixels: number;
  readonly memoryBytes: number;
}

function measureAvatarFrames(
  budget: AvatarResourceBudget,
  frames: readonly AvatarFrameSize[],
  label: string,
): AvatarFrameUsage {
  let pixels = 0;
  for (const frame of frames) {
    if (
      !Number.isFinite(frame.width) ||
      !Number.isFinite(frame.height) ||
      !Number.isSafeInteger(frame.width) ||
      !Number.isSafeInteger(frame.height) ||
      frame.width <= 0 ||
      frame.height <= 0
    ) {
      throw new Error(`${label}尺寸无效：${frame.width}x${frame.height}`);
    }
    if (frame.width > budget.maxEdge || frame.height > budget.maxEdge) {
      throw new Error(
        `${label}尺寸过大：${frame.width}x${frame.height}，最大边长 ${budget.maxEdge}px`,
      );
    }
    const framePixels = frame.width * frame.height;
    if (!Number.isSafeInteger(framePixels) || !Number.isSafeInteger(pixels + framePixels)) {
      throw new Error(`${label}像素总量超限`);
    }
    pixels += framePixels;
  }
  const memoryBytes = pixels * 4;
  if (!Number.isSafeInteger(memoryBytes)) throw new Error(`${label}内存预算超限`);
  return { frameCount: frames.length, pixels, memoryBytes };
}

function reserveAvatarFrames(
  budget: AvatarResourceBudget,
  frames: readonly AvatarFrameSize[],
  label: string,
  countFrames = true,
): AvatarFrameUsage {
  const measured = measureAvatarFrames(budget, frames, label);
  const usage = countFrames ? measured : { ...measured, frameCount: 0 };
  if (usage.frameCount > budget.remainingFrames) {
    throw new Error(
      `${label}帧数预算超限：本次需要 ${usage.frameCount}，剩余 ${budget.remainingFrames}`,
    );
  }
  if (usage.pixels > budget.remainingPixels) {
    if (budget.sceneResidentPixels > 0) {
      throw new Error(
        `场景累计像素预算超限：外部资源已占 ${budget.sceneResidentPixels}，本次还需 ${usage.pixels}，剩余 ${budget.remainingPixels}`,
      );
    }
    throw new Error(
      `${label}像素总量超限：本次需要 ${usage.pixels}，剩余 ${budget.remainingPixels}`,
    );
  }
  if (usage.memoryBytes > budget.remainingMemoryBytes) {
    if (budget.sceneResidentMemoryBytes > 0) {
      throw new Error(
        `场景累计内存预算超限：外部资源已占 ${budget.sceneResidentMemoryBytes} 字节，本次还需 ${usage.memoryBytes} 字节，剩余 ${budget.remainingMemoryBytes} 字节`,
      );
    }
    throw new Error(
      `${label}内存预算超限：本次需要 ${usage.memoryBytes}，剩余 ${budget.remainingMemoryBytes}`,
    );
  }
  budget.remainingFrames -= usage.frameCount;
  budget.remainingPixels -= usage.pixels;
  budget.remainingMemoryBytes -= usage.memoryBytes;
  return usage;
}

function releaseAvatarUsage(budget: AvatarResourceBudget, usage: AvatarFrameUsage): void {
  budget.remainingFrames += usage.frameCount;
  budget.remainingPixels += usage.pixels;
  budget.remainingMemoryBytes += usage.memoryBytes;
}

function replaceAvatarFrames(
  budget: AvatarResourceBudget,
  current: readonly AvatarFrameSize[],
  planned: readonly AvatarFrameSize[],
  label: string,
  create: () => RuntimeCanvas[],
  temporary: readonly AvatarFrameSize[] = [],
): RuntimeCanvas[] {
  const outputUsage = reserveAvatarFrames(budget, planned, label);
  let temporaryUsage: AvatarFrameUsage | null = null;
  try {
    temporaryUsage = reserveAvatarFrames(budget, temporary, `${label}临时画布`);
  } catch (error) {
    releaseAvatarUsage(budget, outputUsage);
    throw error;
  }

  try {
    const output = create();
    if (
      output.length !== planned.length ||
      output.some(
        (frame, index) =>
          frame.width !== planned[index].width || frame.height !== planned[index].height,
      )
    ) {
      throw new Error(`${label}输出与分配前预检不一致`);
    }
    releaseAvatarUsage(budget, temporaryUsage);
    releaseAvatarUsage(budget, measureAvatarFrames(budget, current, label));
    return output;
  } catch (error) {
    releaseAvatarUsage(budget, temporaryUsage);
    releaseAvatarUsage(budget, outputUsage);
    throw error;
  }
}

function frameSizes(frames: readonly AvatarFrameSize[]): AvatarFrameSize[] {
  return frames.map(({ width, height }) => ({ width, height }));
}

function largestFrame(frames: readonly AvatarFrameSize[]): AvatarFrameSize {
  return frames.reduce((largest, frame) =>
    frame.width * frame.height > largest.width * largest.height ? frame : largest,
  );
}

interface LoadedAvatarFrames {
  readonly frames: RuntimeCanvas[];
  readonly delays: number[] | null;
}

async function loadAvatarFrames(
  blob: Blob,
  videoFrameCount: number,
  budget: AvatarResourceBudget,
): Promise<LoadedAvatarFrames> {
  assertAvatarBudgetAvailable(budget);
  let frames: RuntimeCanvas[];
  let delays: number[] | null = null;
  if (blob.type === "image/gif") {
    // GIF 头像：解码成多帧，让头像自身动起来
    try {
      const decoded = await decodeGif(blob, {
        maxFrames: Math.min(DEFAULT_MAX_GIF_FRAMES, budget.remainingFrames),
        maxEdge: budget.maxEdge,
        maxTotalPixels: budget.remainingPixels,
        maxMemoryBytes: budget.remainingMemoryBytes,
      });
      frames = decoded.frames;
      delays = decoded.delays;
    } catch (error) {
      rethrowSceneDecodeBudget(error, budget);
    }
  } else if (blob.type.startsWith("video/")) {
    // 视频头像：按 pos 帧数等间隔抽帧
    try {
      frames = await decodeVideo(blob, Math.max(1, videoFrameCount), {
        maxFrames: budget.remainingFrames,
        maxEdge: budget.maxEdge,
        maxTotalPixels: budget.remainingPixels,
        maxMemoryBytes: budget.remainingMemoryBytes,
      });
    } catch (error) {
      rethrowSceneDecodeBudget(error, budget);
    }
  } else if (!SUPPORTED_STATIC_IMAGE_TYPES.has(blob.type)) {
    throw new Error(`不支持的头像格式: ${blob.type}`);
  } else {
    const metadata = await readImageMetadata(blob);
    const imageUsage = reserveAvatarFrames(budget, [metadata], "头像解码源图", false);
    let outputUsage: AvatarFrameUsage | null = null;
    try {
      outputUsage = reserveAvatarFrames(budget, [metadata], "头像解码");
      const img = await loadImage(blob);
      if (img.width !== metadata.width || img.height !== metadata.height) {
        throw new Error("头像解码尺寸与元数据预检不一致");
      }
      const output = copyAsCanvas(img);
      if (output.width !== img.width || output.height !== img.height) {
        throw new Error("头像解码输出与分配前预检不一致");
      }
      releaseAvatarUsage(budget, imageUsage);
      return { frames: [output], delays: null };
    } catch (error) {
      if (outputUsage) releaseAvatarUsage(budget, outputUsage);
      releaseAvatarUsage(budget, imageUsage);
      throw error;
    }
  }
  consumeAvatarDecodeBudget(budget, frames);
  return { frames, delays };
}

const SUPPORTED_STATIC_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);

function rethrowSceneDecodeBudget(error: unknown, budget: AvatarResourceBudget): never {
  if (!(error instanceof Error) || budget.sceneResidentPixels === 0) throw error;

  const pixelBudgetPrefixes = ["GIF 解码像素总量过大：", "视频解码像素总量过大："];
  if (pixelBudgetPrefixes.some((prefix) => error.message.startsWith(prefix))) {
    throw new Error(
      `场景累计像素预算超限：外部资源已占 ${budget.sceneResidentPixels}；${error.message}`,
      { cause: error },
    );
  }

  const memoryBudgetPrefixes = [
    "GIF 输入缓冲内存预算超限：",
    "GIF 解码内存预算超限：",
    "视频解码内存预算超限：",
  ];
  if (memoryBudgetPrefixes.some((prefix) => error.message.startsWith(prefix))) {
    throw new Error(
      `场景累计内存预算超限：外部资源已占 ${budget.sceneResidentMemoryBytes} 字节；${error.message}`,
      { cause: error },
    );
  }
  throw error;
}

function cropFrameSize(
  frame: AvatarFrameSize,
  coords: readonly [number, number] | readonly [number, number, number, number],
  percentage = false,
): AvatarFrameSize {
  const x1 = coords.length === 2 ? 0 : coords[0];
  const y1 = coords.length === 2 ? 0 : coords[1];
  const x2 = coords.length === 2 ? coords[0] : coords[2];
  const y2 = coords.length === 2 ? coords[1] : coords[3];
  const scaleX = percentage ? frame.width / 100 : 1;
  const scaleY = percentage ? frame.height / 100 : 1;
  return {
    width: Math.trunc((x2 - x1) * scaleX),
    height: Math.trunc((y2 - y1) * scaleY),
  };
}

function applyCrop(
  frames: RuntimeCanvas[],
  template: AvatarTemplate,
  budget: AvatarResourceBudget,
): RuntimeCanvas[] {
  const cropType = template.cropType ?? "NONE";
  if (cropType === "NONE" || !template.crop) return frames;
  const percentage = cropType === "PERCENT";
  const planned = frames.map((frame) => cropFrameSize(frame, template.crop!, percentage));
  return replaceAvatarFrames(budget, frames, planned, "头像裁剪", () =>
    frames.map((frame) => cropImage(frame, template.crop!, percentage)),
  );
}

function isFullAvatarCrop(crop: AvatarCrop): boolean {
  return crop.x === 0 && crop.y === 0 && crop.width === 100 && crop.height === 100;
}

function snapCropPosition(value: number): number {
  if (Math.abs(value) <= AVATAR_CROP_EPSILON) return 0;
  return value;
}

function snapCropExtent(value: number): number {
  if (Math.abs(value - 100) <= AVATAR_CROP_EPSILON) return 100;
  return value;
}

/**
 * 校验并规范化用户取景矩形。
 *
 * 该函数同时供核心渲染器和取景弹窗使用，所有接近 0/100 的边界都会
 * 归一化，避免 UI 与核心层因浮点误差产生不同判断。
 */
export function normalizeAvatarCrop(crop: AvatarCrop): AvatarCrop {
  if (!crop || typeof crop !== "object") {
    throw new Error("头像取景参数缺失或无效");
  }
  const values = [crop.x, crop.y, crop.width, crop.height];
  if (
    values.some((value) => !Number.isFinite(value)) ||
    crop.x < -AVATAR_CROP_EPSILON ||
    crop.y < -AVATAR_CROP_EPSILON ||
    crop.width <= 0 ||
    crop.height <= 0 ||
    crop.x > 100 + AVATAR_CROP_EPSILON ||
    crop.y > 100 + AVATAR_CROP_EPSILON ||
    crop.x + crop.width > 100 + AVATAR_CROP_EPSILON ||
    crop.y + crop.height > 100 + AVATAR_CROP_EPSILON
  ) {
    throw new Error(
      `头像取景范围无效：x=${crop.x}, y=${crop.y}, width=${crop.width}, height=${crop.height}`,
    );
  }

  const x = Math.max(0, snapCropPosition(crop.x));
  const y = Math.max(0, snapCropPosition(crop.y));
  let width = crop.width;
  let height = crop.height;
  if (x + width > 100) width = 100 - x;
  if (y + height > 100) height = 100 - y;
  width = snapCropExtent(width);
  height = snapCropExtent(height);
  if (width <= 0 || height <= 0) {
    throw new Error(
      `头像取景范围无效：x=${crop.x}, y=${crop.y}, width=${crop.width}, height=${crop.height}`,
    );
  }
  return {
    x,
    y,
    width,
    height,
  };
}

function userCropFrame(
  frame: AvatarFrameSize,
  crop: AvatarCrop,
): { readonly size: AvatarFrameSize; readonly coords: readonly [number, number, number, number] } {
  const x = Math.min(frame.width - 1, Math.floor((crop.x / 100) * frame.width));
  const y = Math.min(frame.height - 1, Math.floor((crop.y / 100) * frame.height));
  const width = Math.max(
    1,
    Math.min(frame.width - x, Math.round((crop.width / 100) * frame.width)),
  );
  const height = Math.max(
    1,
    Math.min(frame.height - y, Math.round((crop.height / 100) * frame.height)),
  );
  return {
    size: { width, height },
    coords: [x, y, x + width, y + height],
  };
}

function applyUserCrop(
  frames: RuntimeCanvas[],
  crop: AvatarCrop,
  budget: AvatarResourceBudget,
): RuntimeCanvas[] {
  if (isFullAvatarCrop(crop)) return frames;
  const crops = frames.map((frame) => userCropFrame(frame, crop));
  return replaceAvatarFrames(
    budget,
    frames,
    crops.map(({ size }) => size),
    "头像用户取景",
    () => frames.map((frame, index) => cropImage(frame, crops[index].coords)),
  );
}

function applySquare(
  frames: RuntimeCanvas[],
  template: AvatarTemplate,
  budget: AvatarResourceBudget,
): RuntimeCanvas[] {
  if (!template.square) return frames;
  const planned = frames.map((frame) => {
    const edge = Math.min(frame.width, frame.height);
    return { width: edge, height: edge };
  });
  return replaceAvatarFrames(budget, frames, planned, "头像方形裁剪", () =>
    frames.map(squareImage),
  );
}

function applyStyles(
  frames: RuntimeCanvas[],
  styles: readonly AvatarStyle[],
  budget: AvatarResourceBudget,
): RuntimeCanvas[] {
  let out = frames;
  for (const style of styles) {
    const input = out;
    const planned = frameSizes(input);
    const needsPixelFallback = style === "BINARIZATION" || style === "INVERT" || style === "GRAY";
    const largest = largestFrame(planned);
    const temporary = needsPixelFallback ? [largest, largest] : [];
    out = replaceAvatarFrames(
      budget,
      input,
      planned,
      `头像 ${style} 样式`,
      () => {
        switch (style) {
          case "FLIP":
            return input.map(flipImage);
          case "MIRROR":
            return input.map(mirrorImage);
          case "GRAY":
            return input.map(grayImage);
          case "BINARIZATION":
            return input.map(binarizeImage);
          case "INVERT":
            return input.map(invertImage);
        }
      },
      temporary,
    );
  }
  return out;
}

/** 逐帧应用滤镜。
 *
 * 滤镜参数可能是数组（逐帧动画值，如 swirl.angle = [0, 0.6, ...]）。
 * 此时需要为每一帧单独应用滤镜：第 N 帧用解析到 N 的参数。
 *
 * - 无滤镜：返回原帧
 * - 有滤镜：按 frameCount 逐帧解析 + 应用。单值参数对所有帧取相同值；
 *   数组参数按帧索引取值。头像帧数不足时复制第 0 帧补齐到 frameCount。
 */
function applyFilterFrames(
  frames: RuntimeCanvas[],
  filters: readonly AvatarFilter[],
  frameCount: number,
  budget: AvatarResourceBudget,
): RuntimeCanvas[] {
  if (filters.length === 0) return frames;

  const source = frames[0];
  const n = Math.max(1, frameCount);

  // 静态源 + 所有帧解析参数一致时各帧输出完全相同，共享同一画布，
  // 避免按帧复制把内存与像素预算放大 N 倍（评审意见 I2）。
  if (frames.length === 1 && n > 1) {
    const resolvedList = Array.from({ length: n }, (_, index) =>
      resolveFiltersForFrame(filters, index),
    );
    const first = JSON.stringify(resolvedList[0]);
    if (resolvedList.every((resolved) => JSON.stringify(resolved) === first)) {
      const sharedSize = { width: source.width, height: source.height };
      return replaceAvatarFrames(
        budget,
        frames,
        Array.from({ length: n }, () => sharedSize),
        "头像滤镜",
        () => {
          const shared = applyFilters(source, resolvedList[0]);
          return Array.from({ length: n }, () => shared);
        },
        [sharedSize, sharedSize, sharedSize, sharedSize],
      );
    }
  }

  const planned = Array.from({ length: n }, (_, index) => {
    const frame = index < frames.length ? frames[index] : source;
    return { width: frame.width, height: frame.height };
  });
  const largest = largestFrame(planned);
  return replaceAvatarFrames(
    budget,
    frames,
    planned,
    "头像滤镜",
    () => {
      const out: RuntimeCanvas[] = [];
      for (let i = 0; i < n; i++) {
        const resolved = resolveFiltersForFrame(filters, i);
        const frame = i < frames.length ? frames[i] : source;
        out.push(applyFilters(frame, resolved));
      }
      return out;
    },
    [largest, largest, largest, largest],
  );
}

function applyRound(
  frames: RuntimeCanvas[],
  round: boolean,
  budget: AvatarResourceBudget,
): RuntimeCanvas[] {
  return round
    ? replaceAvatarFrames(budget, frames, frameSizes(frames), "头像圆形裁切", () =>
        frames.map(clipCircleImage),
      )
    : frames;
}

function applyClipPolygon(
  frames: RuntimeCanvas[],
  template: AvatarTemplate,
  budget: AvatarResourceBudget,
): RuntimeCanvas[] {
  return template.clipPolygon
    ? replaceAvatarFrames(budget, frames, frameSizes(frames), "头像多边形裁切", () =>
        frames.map((frame) => clipPolygonImage(frame, template.clipPolygon!)),
      )
    : frames;
}

function applyPreFit(
  frames: RuntimeCanvas[],
  template: AvatarTemplate,
  budget: AvatarResourceBudget,
): RuntimeCanvas[] {
  const size = template.preFitSize ?? template.deformSize;
  if (!size) return frames;
  const fit = template.fit ?? "FILL";
  const sizes: readonly (readonly [number, number])[] = Array.isArray(size[0])
    ? (size as readonly [number, number][])
    : [size as readonly [number, number]];
  const count = Math.max(frames.length, sizes.length);
  const planned = Array.from({ length: count }, (_, index) => {
    const [width, height] = sizes[Math.min(index, sizes.length - 1)];
    return { width, height };
  });

  return replaceAvatarFrames(budget, frames, planned, "头像预适配", () =>
    Array.from({ length: count }, (_, index) => {
      const { width, height } = planned[index];
      const frame = frames[index % frames.length];
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext("2d") as RuntimeContext;
      drawFit(ctx, frame, 0, 0, width, height, fit);
      return canvas;
    }),
  );
}

function applyBackgroundColor(
  frames: RuntimeCanvas[],
  template: AvatarTemplate,
  budget: AvatarResourceBudget,
): RuntimeCanvas[] {
  if (!template.backgroundColor) return frames;
  const color = parseColor(template.backgroundColor);
  return replaceAvatarFrames(budget, frames, frameSizes(frames), "头像背景色", () =>
    frames.map((frame) => {
      const canvas = createCanvas(frame.width, frame.height);
      const ctx = canvas.getContext("2d") as RuntimeContext;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(frame, 0, 0);
      return canvas;
    }),
  );
}

function applyMask(
  frames: RuntimeCanvas[],
  template: AvatarTemplate,
  assets: BackgroundLayerImages | undefined,
  budget: AvatarResourceBudget,
): RuntimeCanvas[] {
  if (!template.mask) return frames;
  const mask = assets?.[template.mask];
  if (!mask) throw new Error(`缺少头像蒙版资源: ${template.mask}`);
  return replaceAvatarFrames(budget, frames, frameSizes(frames), "头像蒙版", () =>
    frames.map((frame) => clipMaskImage(frame, mask)),
  );
}

function rotatedFrameSize(
  frame: AvatarFrameSize,
  angle: number,
  mode: "CROP" | "EXPAND",
): AvatarFrameSize {
  if (mode === "CROP") return { width: frame.width, height: frame.height };
  const radians = (angle * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians)) < 1e-10 ? 0 : Math.cos(radians);
  const sin = Math.abs(Math.sin(radians)) < 1e-10 ? 0 : Math.sin(radians);
  return {
    width: Math.max(1, Math.ceil(Math.abs(frame.width * cos) + Math.abs(frame.height * sin))),
    height: Math.max(1, Math.ceil(Math.abs(frame.width * sin) + Math.abs(frame.height * cos))),
  };
}

function applyPreRotate(
  frames: RuntimeCanvas[],
  template: AvatarTemplate,
  frameCount: number,
  budget: AvatarResourceBudget,
): RuntimeCanvas[] {
  const angles = toFrameValues(template.preRotate, 0);
  if (angles.every((angle) => Math.abs(angle) < 1e-10)) return frames;

  const count = Math.max(1, frameCount, frames.length, angles.length);
  const mode = template.preRotateMode ?? "CROP";

  // 静态源 + 全帧同角时各帧旋转结果相同，共享同一画布（评审意见 I2）。
  if (frames.length === 1 && count > 1 && angles.every((angle) => angle === angles[0])) {
    const sharedSize = rotatedFrameSize(frames[0], angles[0], mode);
    return replaceAvatarFrames(
      budget,
      frames,
      Array.from({ length: count }, () => sharedSize),
      "头像预旋转",
      () => {
        const shared = rotateImage(frames[0], angles[0], mode);
        return Array.from({ length: count }, () => shared);
      },
    );
  }

  const planned = Array.from({ length: count }, (_, index) =>
    rotatedFrameSize(frames[index % frames.length], valueAtFrame(angles, index), mode),
  );
  return replaceAvatarFrames(budget, frames, planned, "头像预旋转", () =>
    Array.from({ length: count }, (_, index) =>
      rotateImage(frames[index % frames.length], valueAtFrame(angles, index), mode),
    ),
  );
}

function applyDeformCrop(
  frames: RuntimeCanvas[],
  template: AvatarTemplate,
  budget: AvatarResourceBudget,
): RuntimeCanvas[] {
  return template.deformCrop
    ? replaceAvatarFrames(
        budget,
        frames,
        frames.map((frame) => cropFrameSize(frame, template.deformCrop!)),
        "头像变形裁剪",
        () => frames.map((frame) => cropImage(frame, template.deformCrop!)),
      )
    : frames;
}

function toFrameValues(
  value: number | readonly number[] | undefined,
  fallback: number,
): readonly number[] {
  if (typeof value !== "number" && value !== undefined) {
    return value.length > 0 ? value : [fallback];
  }
  return [value ?? fallback];
}

function valueAtFrame(values: readonly number[], frameIndex: number): number {
  return values[Math.min(frameIndex, values.length - 1)];
}

// ============================================================================
// 主入口
// ============================================================================

export function hasAvatarInput(template: AvatarTemplate, inputs: AvatarInputs): boolean {
  if (template.type === "RANDOM") return (inputs.random?.length ?? 0) > 0;
  if (template.type === "USER") {
    const list = inputs.user ?? [];
    if (template.inputCycle) return list.length > 0;
    if (template.visibleWhenInput !== undefined && !list[template.visibleWhenInput]) return false;
    return !!list[template.input ?? 0] || !!list[template.fallbackInput ?? -1];
  }
  const key = template.type.toLowerCase() as keyof AvatarInputs;
  return isAvatarInputCandidate(inputs[key]);
}

/**
 * 图层声明了 visibleWhenInput 且该 USER 输入缺失。
 *
 * 该条件独立于 optional 生效：schema 注释承诺「仅当指定 USER 输入存在时才显示此图层」，
 * 与「缺输入时是否回退/报错」是两个独立语义。
 */
export function isAvatarHiddenByVisibleWhen(
  template: AvatarTemplate,
  inputs: AvatarInputs,
): boolean {
  if (template.type !== "USER" || template.visibleWhenInput === undefined) return false;
  if (template.inputCycle) return false;
  return !(inputs.user ?? [])[template.visibleWhenInput];
}

function hasAvatarSourceBlob(input: unknown): boolean {
  return (
    typeof input === "object" &&
    input !== null &&
    "blob" in input &&
    (input as { readonly blob?: unknown }).blob instanceof Blob
  );
}

function isAvatarInputCandidate(input: unknown): boolean {
  return input instanceof Blob || hasAvatarSourceBlob(input);
}

function normalizeAvatarInput(input: AvatarInput): AvatarSource {
  if (input instanceof Blob) return { blob: input, crop: { ...FULL_AVATAR_CROP } };
  if (input.crop === undefined || input.crop === null) {
    throw new Error("头像取景参数缺失或无效");
  }
  return { blob: input.blob, crop: normalizeAvatarCrop(input.crop) };
}

function pickSources(template: AvatarTemplate, inputs: AvatarInputs): readonly AvatarInput[] {
  if (template.type !== "USER" || !template.inputCycle) return [pickSource(template, inputs)];
  const list = inputs.user ?? [];
  if (list.length === 0) throw new MissingAvatarInputError("缺少 USER 头像输入", "USER");
  const maxInputs = template.inputCycle.maxInputs;
  return maxInputs === undefined ? list : list.slice(0, maxInputs);
}

function pickSource(template: AvatarTemplate, inputs: AvatarInputs): AvatarInput {
  const key = template.type.toLowerCase() as keyof AvatarInputs;
  if (template.type === "RANDOM") {
    const list = inputs.random ?? [];
    if (!list.length) throw new MissingAvatarInputError("缺少 RANDOM 头像输入", "RANDOM");
    return list[Math.floor(Math.random() * list.length)];
  }
  if (template.type === "USER") {
    const input = template.input ?? 0;
    const blob = inputs.user?.[input] ?? inputs.user?.[template.fallbackInput ?? -1];
    if (!blob) {
      throw new MissingAvatarInputError(`缺少 USER 头像输入 #${input + 1}`, "USER", input);
    }
    return blob;
  }
  const source = inputs[key];
  if (!isAvatarInputCandidate(source)) {
    throw new MissingAvatarInputError(`缺少 ${template.type} 头像输入`, template.type);
  }
  return source as AvatarInput;
}

export async function prepareAvatar(
  template: AvatarTemplate,
  inputs: AvatarInputs,
  /** 该头像所在场景的总帧数（用于逐帧滤镜参数数组按帧展开）。无滤镜数组时可传 1。 */
  frameCount = 1,
  assets?: BackgroundLayerImages,
  decodeOptions: AvatarDecodeOptions = {},
): Promise<PreparedAvatar> {
  if (template.type === "USER" && (inputs.user?.length ?? 0) > MAX_USER_AVATAR_INPUTS) {
    throw new Error(
      `USER 头像输入数量过多：${inputs.user?.length ?? 0} 个，最多支持 ${MAX_USER_AVATAR_INPUTS} 个`,
    );
  }
  const sources = pickSources(template, inputs).map(normalizeAvatarInput);
  const declaredFrameCount = getAvatarDeclaredFrameCount(template, inputs);
  const resourceBudget = decodeOptions.resourceBudget ?? createAvatarResourceBudget(decodeOptions);

  // 1. 解码（视频按 pos 帧数等间隔抽帧，故先算出 pos 帧数）
  const { frames: posFrames } = normalizePos(template);
  const sourceFrames: RuntimeCanvas[][] = [];
  const sourceFrameDelays: (number[] | null)[] = [];
  for (const source of sources) {
    const loaded = await loadAvatarFrames(source.blob, posFrames.length, resourceBudget);
    let frames = loaded.frames;

    // 2. 每个输入都走相同变换管线，USER 循环时保留为独立帧组。
    frames = applyUserCrop(frames, source.crop, resourceBudget);
    frames = applySquare(frames, template, resourceBudget);
    frames = applyCrop(frames, template, resourceBudget);
    frames = applyStyles(frames, template.style ?? [], resourceBudget);
    frames = applyFilterFrames(
      frames,
      template.filter ?? [],
      Math.max(frameCount, frames.length, posFrames.length),
      resourceBudget,
    );
    frames = applyRound(frames, template.round ?? false, resourceBudget);
    frames = applyPreFit(frames, template, resourceBudget);
    frames = applyClipPolygon(frames, template, resourceBudget);
    frames = applyBackgroundColor(frames, template, resourceBudget);
    frames = applyMask(frames, template, assets, resourceBudget);
    frames = applyDeformCrop(frames, template, resourceBudget);
    frames = applyPreRotate(frames, template, frameCount, resourceBudget);
    sourceFrames.push(frames);
    sourceFrameDelays.push(
      loaded.delays
        ? Array.from(
            { length: frames.length },
            (_, index) => loaded.delays?.[index % loaded.delays.length] ?? 100,
          )
        : null,
    );
  }
  const frames = sourceFrames[0];

  // 3. 编译位置
  const { posFns, posType } = compilePos(template);

  return {
    type: template.type,
    declaredFrameCount,
    frames,
    sourceFrames,
    frameDelays: sourceFrameDelays[0],
    sourceFrameDelays,
    posFns,
    posType,
    fit: template.fit ?? "FILL",
    origin: template.origin ?? "DEFAULT",
    avatarOnTop: template.avatarOnTop ?? true,
    angles: toFrameValues(template.angle, 0),
    opacities: toFrameValues(template.opacity, 1),
    rotate: template.rotate ?? false,
    imageSmoothingEnabled: template.resampling ?? template.antialias ?? null,
    projection: template.projection
      ? {
          type: template.projection.type,
          angles: toFrameValues(template.projection.angle, 0),
          fov: template.projection.fov,
          loop: template.projection.loop,
          ...(template.projection.model && { model: template.projection.model }),
          ...(template.projection.cameraSize && {
            cameraSize: template.projection.cameraSize,
          }),
          align: template.projection.align,
        }
      : null,
    inputCycle: template.inputCycle
      ? {
          framesPerInput: template.inputCycle.framesPerInput,
          offset: template.inputCycle.offset,
        }
      : null,
    when: template.when === undefined ? null : compileNumber(template.when),
  };
}

// ============================================================================
// 渲染
// ============================================================================

/**
 * 求出该 PreparedAvatar 在当前 sizeMap 下，第 index 帧的实际位置。
 */
function evalPos(
  prepared: PreparedAvatar,
  index: number,
  sizeMap: Record<string, number>,
  fallbackSize: { width: number; height: number },
): FramePosition {
  const vars = {
    ...sizeMap,
    width: fallbackSize.width,
    height: fallbackSize.height,
  };

  if (prepared.posType === "ZOOM") {
    const list = prepared.posFns as EvalFn[][];
    const row = list[Math.min(index, list.length - 1)];
    const [x, y, w, h] = row.map((fn) => fn(vars));
    return { kind: "ZOOM", x, y, w, h };
  }

  const list = prepared.posFns as EvalFn[][][];
  const row = list[Math.min(index, list.length - 1)];
  const points = row.map((pair) => [pair[0](vars), pair[1](vars)] as [number, number]);
  return {
    kind: "DEFORM",
    corners: points.slice(0, 4),
    anchor: points[4],
  };
}

interface ResolvedAvatarProjection {
  readonly width: number;
  readonly height: number;
  readonly corners: [[number, number], [number, number], [number, number], [number, number]];
}

function resolveAvatarSourceFrame(prepared: PreparedAvatar, frameIndex: number): RuntimeCanvas {
  const cycle = prepared.inputCycle;
  const inputIndex = cycle
    ? (((Math.floor(frameIndex / cycle.framesPerInput) + cycle.offset) %
        prepared.sourceFrames.length) +
        prepared.sourceFrames.length) %
      prepared.sourceFrames.length
    : 0;
  const sourceFrames = prepared.sourceFrames[inputIndex];
  return sourceFrames[frameIndex % sourceFrames.length];
}

/** 返回当前场景帧使用的 GIF 源帧延迟；静态图片与视频返回 null。 */
export function getAvatarFrameDelay(prepared: PreparedAvatar, frameIndex: number): number | null {
  const cycle = prepared.inputCycle;
  const inputIndex = cycle
    ? (((Math.floor(frameIndex / cycle.framesPerInput) + cycle.offset) %
        prepared.sourceFrameDelays.length) +
        prepared.sourceFrameDelays.length) %
      prepared.sourceFrameDelays.length
    : 0;
  const delays = prepared.sourceFrameDelays[inputIndex];
  return delays?.[frameIndex % delays.length] ?? null;
}

function resolveAvatarProjection(
  prepared: PreparedAvatar,
  frameIndex: number,
  pos: ZoomPosition,
): ResolvedAvatarProjection | null {
  const projection = prepared.projection;
  if (!projection || projection.type !== "ROTATE_Y") return null;

  const projectionIndex = projection.loop ? frameIndex % projection.angles.length : frameIndex;
  const projectionAngle = valueAtFrame(projection.angles, projectionIndex);
  const projected = projectRotateY(pos.w, pos.h, projectionAngle, projection.fov, {
    ...(projection.model && { model: projection.model }),
    ...(projection.cameraSize && { cameraSize: projection.cameraSize }),
    align: projection.align,
  });
  const projectedWidth =
    Math.max(...projected.map(([px]) => px)) - Math.min(...projected.map(([px]) => px));
  const projectedHeight =
    Math.max(...projected.map(([, py]) => py)) - Math.min(...projected.map(([, py]) => py));
  if (!(pos.w > 0 && pos.h > 0 && projectedWidth >= 0.5 && projectedHeight >= 0.5)) {
    return null;
  }

  return {
    width: Math.max(1, Math.round(pos.w)),
    height: Math.max(1, Math.round(pos.h)),
    corners: projected.map(([px, py]) => [px + pos.x, py + pos.y]) as [
      [number, number],
      [number, number],
      [number, number],
      [number, number],
    ],
  };
}

export function assertAvatarRenderBudget(
  avatars: readonly PreparedAvatar[],
  frameCount: number,
  sizeMap: Record<string, number>,
  budget: AvatarResourceBudget,
): number {
  let largestProjection: AvatarFrameSize | null = null;
  let largestPixels = 0;

  for (const prepared of avatars) {
    if (prepared.posType !== "ZOOM" || prepared.projection?.type !== "ROTATE_Y") continue;
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
      const frame = resolveAvatarSourceFrame(prepared, frameIndex);
      const pos = evalPos(prepared, frameIndex, sizeMap, frame);
      if (pos.kind !== "ZOOM") continue;
      const projection = resolveAvatarProjection(prepared, frameIndex, pos);
      if (!projection) continue;
      const usage = measureAvatarFrames(budget, [projection], "头像投影临时画布");
      if (usage.pixels > largestPixels) {
        largestProjection = projection;
        largestPixels = usage.pixels;
      }
    }
  }

  if (!largestProjection) return 0;
  const usage = reserveAvatarFrames(budget, [largestProjection], "头像投影临时画布");
  releaseAvatarUsage(budget, usage);
  return usage.pixels;
}

/**
 * 在指定 ctx 上绘制一个头像帧。
 *
 * ZOOM：直接按 [x,y,w,h] 缩放贴图；DEFORM：透视变形到四边形（drawDeform）。
 */
export function drawAvatar(
  ctx: RuntimeContext,
  prepared: PreparedAvatar,
  frameIndex: number,
  sizeMap: Record<string, number> = {},
): void {
  if (prepared.when && prepared.when({ ...sizeMap, frameIndex }) === 0) return;
  // GIF 头像帧数少于场景时循环播放（取模）；静态图只有 1 帧，取模后恒为 0。
  const frame = resolveAvatarSourceFrame(prepared, frameIndex);
  const pos = evalPos(prepared, frameIndex, sizeMap, frame);

  const frameCount =
    prepared.posType === "ZOOM"
      ? (prepared.posFns as EvalFn[][]).length
      : (prepared.posFns as EvalFn[][][]).length;

  let angle = valueAtFrame(prepared.angles, frameIndex);
  if (prepared.rotate) angle += (360 / frameCount) * frameIndex;

  const prevAlpha = ctx.globalAlpha;
  const prevImageSmoothing = ctx.imageSmoothingEnabled;
  ctx.globalAlpha = valueAtFrame(prepared.opacities, frameIndex);
  if (prepared.imageSmoothingEnabled !== null) {
    ctx.imageSmoothingEnabled = prepared.imageSmoothingEnabled;
  }

  if (pos.kind === "ZOOM") {
    const { x, y, w, h } = pos;
    const projection = resolveAvatarProjection(prepared, frameIndex, pos);
    if (prepared.projection?.type === "ROTATE_Y") {
      if (projection) {
        const fitted = createCanvas(projection.width, projection.height);
        const fittedCtx = fitted.getContext("2d") as RuntimeContext;
        drawFit(fittedCtx, frame, 0, 0, fitted.width, fitted.height, prepared.fit);
        drawDeform(ctx, fitted, projection.corners);
      }
    } else {
      const needRotate = angle !== 0;
      if (needRotate) {
        ctx.save();
        const centerX = prepared.origin === "CENTER";
        rotateAround(ctx, angle, x + (centerX ? w / 2 : 0), y + (centerX ? h / 2 : 0));
      }
      drawFit(ctx, frame, x, y, w, h, prepared.fit);
      if (needRotate) ctx.restore();
    }
  } else {
    // DEFORM 透视变形：4 个角 + 锚点偏移
    const { corners, anchor } = pos;
    const [ax, ay] = anchor;
    const shifted = corners.map(([x, y]) => [x + ax, y + ay] as [number, number]);
    drawDeform(
      ctx,
      frame,
      shifted as [[number, number], [number, number], [number, number], [number, number]],
    );
  }

  ctx.globalAlpha = prevAlpha;
  if (prepared.imageSmoothingEnabled !== null) {
    ctx.imageSmoothingEnabled = prevImageSmoothing;
  }
}

/**
 * 取该头像在当前 sizeMap 下解码后的原始尺寸。
 */
export function getAvatarSize(prepared: PreparedAvatar): { width: number; height: number } {
  const f = prepared.frames[0];
  return { width: f.width, height: f.height };
}

/**
 * 取该头像的位置帧数。
 */
export function getAvatarPosLength(prepared: PreparedAvatar): number {
  return prepared.posType === "ZOOM"
    ? (prepared.posFns as EvalFn[][]).length
    : (prepared.posFns as EvalFn[][][]).length;
}

/** 取头像透视投影声明的帧数。 */
export function getAvatarProjectionLength(prepared: PreparedAvatar): number {
  return prepared.projection?.angles.length ?? 0;
}

/**
 * 取该头像的帧数（解码后）。GIF 时大于 1。
 */
export function getAvatarFrameCount(prepared: PreparedAvatar): number {
  return prepared.sourceFrames.reduce((max, frames) => Math.max(max, frames.length), 1);
}

/** USER 顺序输入完整播放一轮所需的场景帧数。 */
export function getAvatarInputCycleLength(prepared: PreparedAvatar): number {
  return prepared.inputCycle
    ? prepared.sourceFrames.length * prepared.inputCycle.framesPerInput
    : 0;
}

/** 在解码头像前，根据模板声明与已有输入估算该图层需要的场景帧数。 */
export function getAvatarDeclaredFrameCount(
  template: AvatarTemplate,
  inputs: AvatarInputs,
): number {
  const posLength = normalizePos(template).frames.length;
  const preFitSizeLength = Array.isArray(template.preFitSize?.[0]) ? template.preFitSize.length : 0;
  const filterLength = (template.filter ?? []).reduce(
    (max, filter) => Math.max(max, getFilterDeclaredFrameCount(filter)),
    0,
  );
  const inputCycleLength = template.inputCycle
    ? Math.min(
        inputs.user?.length ?? 0,
        template.inputCycle.maxInputs ?? Number.POSITIVE_INFINITY,
      ) * template.inputCycle.framesPerInput
    : 0;
  return Math.max(
    posLength,
    frameValueLength(template.angle),
    frameValueLength(template.opacity),
    preFitSizeLength,
    frameValueLength(template.preRotate),
    frameValueLength(template.projection?.angle),
    filterLength,
    inputCycleLength,
    1,
  );
}

function frameValueLength(value: number | readonly number[] | undefined): number {
  return Array.isArray(value) ? value.length : 0;
}

function maxFrameValueLength(...values: readonly (number | readonly number[])[]): number {
  return values.reduce<number>((max, value) => Math.max(max, frameValueLength(value)), 0);
}

function getFilterDeclaredFrameCount(filter: AvatarFilter): number {
  switch (filter.type) {
    case "SWIRL":
      return maxFrameValueLength(filter.radius, filter.angle);
    case "BULGE":
      return maxFrameValueLength(filter.radius, filter.strength);
    case "SWIM":
      return maxFrameValueLength(
        filter.scale,
        filter.stretch,
        filter.angle,
        filter.amount,
        filter.turbulence,
        filter.time,
      );
    case "BLUR":
      return frameValueLength(filter.radius);
    case "CONTRAST":
      return maxFrameValueLength(filter.brightness, filter.contrast);
    case "HSB":
      return maxFrameValueLength(filter.hue, filter.saturation, filter.brightness);
    case "HALFTONE":
    case "DOT_SCREEN":
      return maxFrameValueLength(filter.angle, filter.radius);
    case "NOISE":
      return frameValueLength(filter.amount);
    case "DENOISE":
      return frameValueLength(filter.exponent);
    case "OIL":
      return maxFrameValueLength(filter.skip, filter.levels, filter.range);
    case "AFTERIMAGE":
      return maxFrameValueLength(filter.fraction, filter.opacity);
    case "PIXELATE":
      return frameValueLength(filter.size);
    case "COLORIZE":
      return 0;
    default: {
      const exhaustive: never = filter;
      return exhaustive;
    }
  }
}

/** 仅供测试用：导出辅助函数 */
export const __internals = { normalizePos, compilePos };

// 头像在此场景中能用到的最大帧数（决定播放循环长度）
export function getAvatarMaxLength(prepared: PreparedAvatar): number {
  return Math.max(
    prepared.declaredFrameCount,
    getAvatarPosLength(prepared),
    getAvatarFrameCount(prepared),
    getAvatarProjectionLength(prepared),
    getAvatarInputCycleLength(prepared),
  );
}

// 给一个 Image 类型的兼容性辅助：把 RuntimeCanvas 当 RuntimeImage 使用时类型对齐
export type AvatarFrame = RuntimeCanvas | RuntimeImage;
