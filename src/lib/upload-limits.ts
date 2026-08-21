import { DEFAULT_MAX_GIF_FRAMES, loadImage, readImageMetadata } from "@/core";
import type { RuntimeImage } from "@/core";
import {
  DEFAULT_MAX_MEDIA_MEMORY_BYTES,
  DEFAULT_MAX_SCENE_TOTAL_PIXELS,
  MAX_MEDIA_EDGE,
} from "@/core/limits";

const MB = 1024 * 1024;

export const SUPPORTED_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
] as const;
export const SUPPORTED_IMAGE_ACCEPT = SUPPORTED_IMAGE_MIME_TYPES.join(",");
const SUPPORTED_IMAGE_TYPE_SET = new Set<string>(SUPPORTED_IMAGE_MIME_TYPES);

export const UPLOAD_LIMITS = {
  avatarMaxBytes: 10 * MB,
  backgroundMaxBytes: 20 * MB,
  imageMaxEdge: MAX_MEDIA_EDGE,
  gifMaxFrames: DEFAULT_MAX_GIF_FRAMES,
  randomAvatarMaxFiles: 20,
  randomAvatarMaxTotalBytes: 100 * MB,
  backgroundMaxFiles: DEFAULT_MAX_GIF_FRAMES,
  backgroundMaxTotalBytes: 200 * MB,
  backgroundMaxTotalPixels: DEFAULT_MAX_SCENE_TOTAL_PIXELS,
  backgroundMaxMemoryBytes: DEFAULT_MAX_MEDIA_MEMORY_BYTES,
} as const;

export type UploadImageKind = "avatar" | "background";
export type UploadCollectionKind = "random-avatar" | "user-avatar" | "background";

const KIND_LABELS: Record<UploadImageKind, string> = {
  avatar: "头像",
  background: "背景图",
};

export function assertImageFileBasics(file: File, kind: UploadImageKind): void {
  const label = KIND_LABELS[kind];
  if (!SUPPORTED_IMAGE_TYPE_SET.has(file.type)) {
    throw new Error(`不支持的${label}格式：${file.type || "未知"}，请选择图片文件`);
  }

  const maxBytes =
    kind === "avatar" ? UPLOAD_LIMITS.avatarMaxBytes : UPLOAD_LIMITS.backgroundMaxBytes;
  if (file.size > maxBytes) {
    throw new Error(`${label}文件过大：${formatBytes(file.size)}，最多 ${formatBytes(maxBytes)}`);
  }
}

export function assertAvatarFileBasics(file: File): void {
  if (!SUPPORTED_IMAGE_TYPE_SET.has(file.type) && !file.type.startsWith("video/")) {
    throw new Error(`不支持的头像格式：${file.type || "未知"}，请选择图片或视频文件`);
  }
  if (file.size > UPLOAD_LIMITS.avatarMaxBytes) {
    throw new Error(
      `头像文件过大：${formatBytes(file.size)}，最多 ${formatBytes(UPLOAD_LIMITS.avatarMaxBytes)}`,
    );
  }
}

export function assertUploadCollection(files: readonly Blob[], kind: UploadCollectionKind): void {
  const isAvatarCollection = kind === "random-avatar" || kind === "user-avatar";
  const maxFiles = isAvatarCollection
    ? UPLOAD_LIMITS.randomAvatarMaxFiles
    : UPLOAD_LIMITS.backgroundMaxFiles;
  const maxTotalBytes = isAvatarCollection
    ? UPLOAD_LIMITS.randomAvatarMaxTotalBytes
    : UPLOAD_LIMITS.backgroundMaxTotalBytes;
  const label =
    kind === "random-avatar" ? "随机头像候选" : kind === "user-avatar" ? "顺序头像" : "背景帧";

  if (files.length > maxFiles) {
    throw new Error(`${label}数量过多：${files.length} 个，最多支持 ${maxFiles} 个`);
  }
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > maxTotalBytes) {
    throw new Error(
      `${label}总大小过大：${formatBytes(totalBytes)}，最多 ${formatBytes(maxTotalBytes)}`,
    );
  }
}

export function assertFrameSequence(frames: readonly { width: number; height: number }[]): void {
  if (frames.length === 0) throw new Error("没有可用的背景帧");
  if (frames.length > UPLOAD_LIMITS.backgroundMaxFiles) {
    throw new Error(
      `背景帧数量过多：${frames.length} 帧，最多支持 ${UPLOAD_LIMITS.backgroundMaxFiles} 帧`,
    );
  }
  const first = frames[0];
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    assertImageDimensions(frame.width, frame.height);
    if (frame.width !== first.width || frame.height !== first.height) {
      throw new Error(
        `背景帧尺寸不一致：第 1 帧为 ${first.width}×${first.height}，第 ${i + 1} 帧为 ${frame.width}×${frame.height}`,
      );
    }
  }
}

export function assertImageDimensions(width: number, height: number): void {
  const maxEdge = UPLOAD_LIMITS.imageMaxEdge;
  if (width > maxEdge || height > maxEdge) {
    throw new Error(`图片尺寸过大：${width}×${height}，最大边长 ${maxEdge}px`);
  }
}

export function assertGifFrameLimit(
  frameCount: number,
  maxFrames = UPLOAD_LIMITS.gifMaxFrames,
): void {
  if (frameCount > maxFrames) {
    throw new Error(`GIF 帧数过多：${frameCount} 帧，最多支持 ${maxFrames} 帧`);
  }
}

export async function loadValidatedImage(file: File, kind: UploadImageKind): Promise<RuntimeImage> {
  assertImageFileBasics(file, kind);
  const metadata = await readImageMetadata(file);
  assertImageDimensions(metadata.width, metadata.height);
  const image = await loadImage(file);
  if (image.width !== metadata.width || image.height !== metadata.height) {
    throw new Error("图片解码尺寸与元数据预检不一致");
  }
  assertImageDimensions(image.width, image.height);
  return image;
}

export async function validateAvatarFile(file: File): Promise<void> {
  assertAvatarFileBasics(file);
  if (file.type.startsWith("video/")) {
    await validateVideoDimensions(file);
    return;
  }
  const metadata = await readImageMetadata(file);
  assertImageDimensions(metadata.width, metadata.height);
  const image = await loadImage(file);
  if (image.width !== metadata.width || image.height !== metadata.height) {
    throw new Error("头像解码尺寸与元数据预检不一致");
  }
  assertImageDimensions(image.width, image.height);
}

async function validateVideoDimensions(file: File): Promise<void> {
  if (typeof document === "undefined") {
    throw new Error("视频尺寸校验仅支持浏览器环境");
  }

  const video = document.createElement("video");
  const url = URL.createObjectURL(file);
  video.preload = "metadata";
  video.muted = true;

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("视频信息读取超时")), 15_000);
      video.onloadedmetadata = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      video.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error("无法读取视频信息"));
      };
      video.src = url;
    });
    assertImageDimensions(video.videoWidth, video.videoHeight);
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

function formatBytes(bytes: number): string {
  return `${(bytes / MB).toFixed(bytes % MB === 0 ? 0 : 1)}MB`;
}
