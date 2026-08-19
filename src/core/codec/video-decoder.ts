/**
 * 视频解码 —— 把视频 Blob 按等间隔抽成若干帧 Canvas。
 *
 * 采用纯函数并全程使用局部 `video` 变量：
 *   - 使用 `seeked` 事件等待视频定位完成
 *   - 取每段中点抽帧，避免边界黑帧
 *   - 在 `finally` 中撤销对象 URL
 *   - 增加超时回退，避免个别视频定位卡住整个处理流程
 *
 * 仅浏览器可用（依赖 HTMLVideoElement）；Node 测试环境直接抛清晰错误。
 */

import {
  DEFAULT_MAX_MEDIA_MEMORY_BYTES,
  DEFAULT_MAX_SCENE_TOTAL_PIXELS,
  MAX_MEDIA_EDGE,
  MAX_SCENE_FRAMES,
} from "../limits";
import { createCanvas } from "../utils/runtime";
import type { RuntimeCanvas, RuntimeContext } from "../utils/runtime";

/** 监听一次事件后 resolve。 */
function once(el: HTMLVideoElement, ev: string): Promise<void> {
  return new Promise((resolve) => {
    el.addEventListener(ev, () => resolve(), { once: true });
  });
}

/**
 * 等待媒体事件；期间触发 error 事件则立即以解码失败拒绝。
 * 否则不支持的编码要等满超时才报错，且错误原因失真。
 */
async function awaitMediaEvent(
  video: HTMLVideoElement,
  ev: string,
  timeoutMs: number,
  timeoutMsg: string,
): Promise<void> {
  const arrived = once(video, ev);
  const failure = new Promise<never>((_, reject) => {
    video.addEventListener(
      "error",
      () => reject(new Error(`视频解码失败（MediaError code=${video.error?.code ?? "unknown"}）`)),
      { once: true },
    );
  });
  await withTimeout(Promise.race([arrived, failure]), timeoutMs, timeoutMsg);
}

/** 给 promise 套一个超时，超时则 reject。 */
function withTimeout(p: Promise<void>, ms: number, msg: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(msg)), ms);
    p.then(
      () => {
        clearTimeout(id);
        resolve();
      },
      (e) => {
        clearTimeout(id);
        reject(e);
      },
    );
  });
}

function videoToCanvas(video: HTMLVideoElement, width: number, height: number): RuntimeCanvas {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d") as RuntimeContext;
  ctx.drawImage(video, 0, 0, width, height);
  return canvas;
}

export interface DecodeVideoOptions {
  readonly maxFrames?: number;
  readonly maxEdge?: number;
  readonly maxTotalPixels?: number;
  readonly maxMemoryBytes?: number;
}

function positiveBudget(value: number, label: string, integer = false): number {
  if (!Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value))) {
    throw new Error(`${label}预算无效：${value}`);
  }
  return value;
}

/**
 * 解码视频，抽 frameCount 帧。
 * @param blob 视频文件
 * @param frameCount 抽帧数量（按等间隔取每段中点）
 */
export async function decodeVideo(
  blob: Blob,
  frameCount = 1,
  options: DecodeVideoOptions = {},
): Promise<RuntimeCanvas[]> {
  if (!Number.isInteger(frameCount) || frameCount <= 0) {
    throw new Error(`视频帧数无效：${frameCount}`);
  }
  const maxFrames = Math.min(
    positiveBudget(options.maxFrames ?? MAX_SCENE_FRAMES, "视频帧数", true),
    MAX_SCENE_FRAMES,
  );
  const maxEdge = positiveBudget(options.maxEdge ?? MAX_MEDIA_EDGE, "视频边长", true);
  const maxTotalPixels = positiveBudget(
    options.maxTotalPixels ?? DEFAULT_MAX_SCENE_TOTAL_PIXELS,
    "视频总像素",
  );
  const maxMemoryBytes = positiveBudget(
    options.maxMemoryBytes ?? DEFAULT_MAX_MEDIA_MEMORY_BYTES,
    "视频内存",
  );
  if (frameCount > maxFrames) {
    throw new Error(`视频帧数过多：${frameCount}，最多支持 ${maxFrames} 帧`);
  }
  if (typeof document === "undefined") {
    throw new Error("视频解码仅支持浏览器环境（需 HTMLVideoElement）");
  }

  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "metadata";
  const url = URL.createObjectURL(blob);
  video.src = url;

  try {
    await awaitMediaEvent(video, "loadedmetadata", 15000, "视频元数据加载超时");
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error("无法读取视频时长");
    }
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new Error(`视频尺寸无效：${width}x${height}`);
    }
    if (width > maxEdge || height > maxEdge) {
      throw new Error(`视频尺寸过大：${width}x${height}，最大边长 ${maxEdge}px`);
    }
    const totalPixels = width * height * frameCount;
    if (!Number.isSafeInteger(totalPixels) || totalPixels > maxTotalPixels) {
      throw new Error(`视频解码像素总量过大：${totalPixels}，最多支持 ${maxTotalPixels}`);
    }
    const framePixels = width * height;
    const peakPixels = totalPixels + framePixels;
    const estimatedMemory = peakPixels * 4;
    if (
      !Number.isSafeInteger(peakPixels) ||
      !Number.isSafeInteger(estimatedMemory) ||
      estimatedMemory > maxMemoryBytes
    ) {
      throw new Error(`视频解码内存预算超限：${estimatedMemory}，最多支持 ${maxMemoryBytes}`);
    }

    const interval = duration / frameCount;
    const frames: RuntimeCanvas[] = [];
    for (let i = 0; i < frameCount; i++) {
      const t = Math.min((i + 0.5) * interval, duration - 0.001);
      video.currentTime = Math.max(0.0001, t);
      await awaitMediaEvent(video, "seeked", 10000, `视频第 ${i + 1} 帧抽取超时`);
      frames.push(videoToCanvas(video, width, height));
    }
    return frames;
  } finally {
    URL.revokeObjectURL(url);
  }
}
