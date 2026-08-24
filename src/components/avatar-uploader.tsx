/**
 * 头像上传器 —— 每个 AvatarType 一个槽位，支持点击/拖拽上传图片。
 * 上传完成后：缩略图 + 图下方的紧凑动作行（取景/清空），不再遮挡图片。
 */

import { ChevronLeft, ChevronRight, Crop, Info, Loader2, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { AvatarCropDialog } from "@/components/avatar-crop-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  type AvatarCrop,
  type AvatarSource,
  type AvatarType,
  FULL_AVATAR_CROP,
  type PetpetTemplate,
} from "@/core";
import { BlobUrlRegistry } from "@/lib/blob-url";
import { logger } from "@/lib/logger";
import {
  SUPPORTED_IMAGE_ACCEPT,
  assertUploadCollection,
  validateAvatarFile,
} from "@/lib/upload-limits";
import { cn } from "@/lib/utils";
import { type AvatarState, type AvatarValue, createAvatarSource } from "@/stores/meme-store";

const AVATAR_LABELS: Record<AvatarType, string> = {
  FROM: "发起者头像（FROM）",
  TO: "目标头像（TO）",
  BOT: "机器人头像（BOT）",
  GROUP: "群头像（GROUP）",
  RANDOM: "随机头像（RANDOM）",
  USER: "顺序头像（USER）",
};

const EMPTY_CANDIDATES: readonly AvatarSource[] = [];

interface AvatarMediaPreviewProps {
  source: AvatarSource;
  url: string;
  alt: string;
  className?: string;
}

/**
 * 在固定缩略图窗口中显示完整用户取景矩形。
 *
 * 媒体先按 crop 的宽高放大，再按 crop 的 x/y 偏移；这样同一个组件同时
 * 支持静态图、GIF 和视频，不会把不同取景都错误地压到中心点。
 */
function AvatarMediaPreview({ source, url, alt, className }: AvatarMediaPreviewProps) {
  const cropWidth = Math.max(0.0001, source.crop.width);
  const cropHeight = Math.max(0.0001, source.crop.height);
  const mediaStyle = {
    position: "absolute" as const,
    width: `${10000 / cropWidth}%`,
    height: `${10000 / cropHeight}%`,
    left: `${(-source.crop.x / cropWidth) * 100}%`,
    top: `${(-source.crop.y / cropHeight) * 100}%`,
    objectFit: "fill" as const,
  };
  const mediaClassName = "absolute max-w-none";

  return (
    <div className={cn("relative size-full overflow-hidden", className)}>
      {source.blob.type.startsWith("video/") ? (
        <video
          src={url}
          muted
          playsInline
          preload="auto"
          aria-label={alt}
          className={mediaClassName}
          style={mediaStyle}
        />
      ) : (
        <img src={url} alt={alt} className={mediaClassName} style={mediaStyle} />
      )}
    </div>
  );
}

function isFullCrop(crop: AvatarCrop): boolean {
  return (
    crop.x === FULL_AVATAR_CROP.x &&
    crop.y === FULL_AVATAR_CROP.y &&
    crop.width === FULL_AVATAR_CROP.width &&
    crop.height === FULL_AVATAR_CROP.height
  );
}

interface AvatarSlotProps {
  type: AvatarType;
  value: AvatarValue | undefined;
  requiredCount: number;
  maxCount?: number;
  onChange: (value: AvatarValue) => void;
}

function AvatarSlot({ type, value, requiredCount, maxCount, onChange }: AvatarSlotProps) {
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cropTargetIndex, setCropTargetIndex] = useState<number | null | undefined>(undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isRandom = type === "RANDOM";
  const isUser = type === "USER";
  const isCollection = isRandom || isUser;
  const collectionCandidates = isCollection && Array.isArray(value) ? value : EMPTY_CANDIDATES;
  const singleSource = !isCollection && value && !Array.isArray(value) ? value : undefined;
  const label = isUser
    ? `${AVATAR_LABELS[type]}（${maxCount ? `${requiredCount}–${maxCount}` : `至少 ${requiredCount}`} 张）`
    : AVATAR_LABELS[type];

  const urlRegistryRef = useRef<BlobUrlRegistry | null>(null);
  if (!urlRegistryRef.current) urlRegistryRef.current = new BlobUrlRegistry();
  const urlRegistry = urlRegistryRef.current;
  const sources =
    isCollection && Array.isArray(value)
      ? value
      : !isCollection && value && !Array.isArray(value)
        ? [value]
        : EMPTY_CANDIDATES;
  // 按 blob 身份取稳定 URL：删除/重排/取景后其余缩略图不变、媒体元素不重挂载（评审意见 I6）。
  const previewUrls = useMemo(
    () => sources.map((source) => urlRegistry.get(source.blob)),
    [sources, urlRegistry],
  );
  useEffect(() => {
    urlRegistry.retain(sources.map((source) => source.blob));
  }, [sources, urlRegistry]);
  useEffect(() => () => urlRegistry.dispose(), [urlRegistry]);

  // 校验进行中忽略新上传：accept 闭包捕获渲染时的 candidates，
  // 并发批次会互相覆盖、丢掉已通过校验的文件（评审意见 I5）。
  const acceptingRef = useRef(false);

  const accept = async (incoming: FileList | File[] | null | undefined) => {
    if (acceptingRef.current) {
      toast.error("正在校验上一批头像，请稍候再试");
      return;
    }
    acceptingRef.current = true;
    try {
      const files = Array.from(incoming ?? []);
      const remaining =
        maxCount === undefined ? files.length : maxCount - collectionCandidates.length;
      const selected = isCollection ? files.slice(0, Math.max(0, remaining)) : files.slice(0, 1);
      if (isCollection && selected.length < files.length && maxCount !== undefined) {
        toast.error(`此模板最多使用 ${maxCount} 张头像`);
      }
      if (selected.length === 0) return;

      setLoading(true);
      try {
        if (isCollection) {
          assertUploadCollection(
            [...collectionCandidates.map((candidate) => candidate.blob), ...selected],
            isRandom ? "random-avatar" : "user-avatar",
          );
        }
        const accepted: File[] = [];
        for (const file of selected) {
          try {
            await validateAvatarFile(file);
            accepted.push(file);
          } catch (error) {
            logger.debug(`头像 ${file.name} 校验未通过`, error);
            toast.error(
              `${file.name} 上传失败：${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }

        if (accepted.length === 0) return;
        const acceptedSources = accepted.map(createAvatarSource);
        onChange(isCollection ? [...collectionCandidates, ...acceptedSources] : acceptedSources[0]);
      } catch (error) {
        logger.debug("头像批量上传校验未通过", error);
        toast.error(error instanceof Error ? error.message : String(error));
      } finally {
        setLoading(false);
      }
    } finally {
      acceptingRef.current = false;
    }
  };

  const openPicker = () => fileInputRef.current?.click();
  const clearValue = () => onChange(isCollection ? [] : null);
  const removeCollectionCandidate = (index: number) => {
    onChange(collectionCandidates.filter((_, candidateIndex) => candidateIndex !== index));
  };
  const moveCollectionCandidate = (index: number, offset: -1 | 1) => {
    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= collectionCandidates.length) return;
    const reordered = [...collectionCandidates];
    [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
    onChange(reordered);
  };
  const hasPreview = previewUrls.length > 0;
  const inputId = `avatar-input-${type.toLowerCase()}`;
  const cropSource =
    cropTargetIndex === null
      ? singleSource
      : cropTargetIndex === undefined
        ? undefined
        : collectionCandidates[cropTargetIndex];
  const cropTargetLabel =
    cropTargetIndex === null || cropTargetIndex === undefined
      ? AVATAR_LABELS[type]
      : `${isRandom ? "随机头像候选" : "顺序头像"} ${cropTargetIndex + 1}`;

  const confirmCrop = (crop: AvatarCrop) => {
    if (!cropSource) return;
    const nextSource: AvatarSource = { blob: cropSource.blob, crop };
    if (cropTargetIndex === null) {
      onChange(nextSource);
      return;
    }
    if (cropTargetIndex === undefined) return;
    onChange(
      collectionCandidates.map((candidate, index) =>
        index === cropTargetIndex ? nextSource : candidate,
      ),
    );
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={inputId} className="text-xs font-bold">
        {label}
      </Label>
      {!hasPreview ? (
        <div
          className={cn(
            "upload-dropzone relative flex h-32 w-full items-center justify-center overflow-hidden rounded-lg transition-colors duration-200",
            dragOver && "border-primary bg-accent/70",
          )}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void accept(e.dataTransfer.files);
          }}
        >
          <button
            type="button"
            className="flex h-full w-full cursor-pointer items-center justify-center"
            aria-label={`上传${label}`}
            disabled={loading}
            onClick={openPicker}
          >
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <span className="grid size-11 place-items-center rounded-lg border-2 border-line bg-card shadow-pop-sm">
                {loading ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : (
                  <Upload className="size-5" />
                )}
              </span>
              <span className="text-xs font-bold">
                {loading
                  ? "校验中…"
                  : isRandom
                    ? "点击或拖拽上传多个候选"
                    : isUser
                      ? "点击或拖拽上传多张头像"
                      : "点击或拖拽上传"}
              </span>
            </div>
          </button>
        </div>
      ) : (
        <>
          {/* 已有素材：只读预览（点击重新选择文件），操作移到下方动作行 */}
          <button
            type="button"
            className="relative block h-28 w-full cursor-pointer overflow-hidden rounded-lg border-2 border-line bg-muted"
            title="重新选择文件"
            onClick={openPicker}
          >
            {isCollection ? (
              <span className="grid size-full grid-cols-4 gap-1 p-1">
                {collectionCandidates.slice(0, 4).map((candidate, index) => {
                  const url = previewUrls[index];
                  return url ? (
                    <AvatarMediaPreview
                      key={url}
                      source={candidate}
                      url={url}
                      alt=""
                      className="size-full rounded object-cover"
                    />
                  ) : null;
                })}
              </span>
            ) : (
              singleSource && (
                <AvatarMediaPreview
                  source={singleSource}
                  url={previewUrls[0]}
                  alt=""
                  className="size-full bg-muted"
                />
              )
            )}
            {isCollection && (
              <span className="absolute bottom-2 left-2 rounded bg-background/90 px-2 py-1 text-xs font-bold shadow-pop-sm">
                {isRandom
                  ? `${collectionCandidates.length} 个候选`
                  : `${collectionCandidates.length} / ${requiredCount} 张`}
              </span>
            )}
          </button>

          {/* 动作行：单素材显示取景/清空；集合素材的操作在下方每个候选卡上 */}
          {!isCollection && (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full border-line bg-card font-bold"
                aria-label={`调整${AVATAR_LABELS[type]}取景`}
                onClick={() => setCropTargetIndex(null)}
              >
                <Crop />
                {singleSource && !isFullCrop(singleSource.crop) ? "重新取景" : "调整取景"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive"
                aria-label={`清空${label}`}
                onClick={clearValue}
              >
                <X />
                清空
              </Button>
            </div>
          )}
        </>
      )}
      {isCollection && hasPreview && (
        <div
          data-testid={isRandom ? "random-avatar-candidates" : "user-avatar-candidates"}
          className="-mx-1 flex max-w-full gap-3 overflow-x-auto px-1 py-1"
        >
          {collectionCandidates.map((candidate, index) => {
            const url = previewUrls[index];
            return url ? (
              <div key={url} className="w-[6.5rem] shrink-0">
                <div className="relative h-16 w-[6.5rem] overflow-hidden rounded-md border-2 border-line bg-muted">
                  <AvatarMediaPreview
                    url={url}
                    source={candidate}
                    alt={`${isRandom ? "随机头像候选" : "顺序头像"} ${index + 1}`}
                    className="size-full"
                  />
                  <span className="absolute bottom-1 left-1 rounded-sm bg-line px-1.5 py-0.5 text-[11px] font-extrabold text-background">
                    {index + 1}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        className="size-8 rounded-md border-line"
                        aria-label={`调整${isRandom ? "随机头像候选" : "顺序头像"} ${index + 1} 取景`}
                        onClick={() => setCropTargetIndex(index)}
                      >
                        <Crop className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {isFullCrop(candidate.crop) ? "调整取景" : "重新取景"}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="size-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        aria-label={`删除${isRandom ? "随机头像候选" : "顺序头像"} ${index + 1}`}
                        data-testid={`${isRandom ? "random-avatar" : "user-avatar"}-delete-${index}`}
                        onClick={() => removeCollectionCandidate(index)}
                      >
                        <X className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>删除此头像</TooltipContent>
                  </Tooltip>
                  <span className="ml-auto inline-flex">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="size-8 text-muted-foreground"
                          disabled={index === 0}
                          aria-label={`向前移动${isRandom ? "随机头像候选" : "顺序头像"} ${index + 1}`}
                          onClick={() => moveCollectionCandidate(index, -1)}
                        >
                          <ChevronLeft className="size-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>向前移动</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="size-8 text-muted-foreground"
                          disabled={index === collectionCandidates.length - 1}
                          aria-label={`向后移动${isRandom ? "随机头像候选" : "顺序头像"} ${index + 1}`}
                          onClick={() => moveCollectionCandidate(index, 1)}
                        >
                          <ChevronRight className="size-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>向后移动</TooltipContent>
                    </Tooltip>
                  </span>
                </div>
              </div>
            ) : null;
          })}
        </div>
      )}
      <input
        id={inputId}
        ref={fileInputRef}
        data-testid={`avatar-input-${type}`}
        type="file"
        accept={`${SUPPORTED_IMAGE_ACCEPT},video/*`}
        multiple={isCollection}
        className="hidden"
        onChange={(e) => {
          const files = e.currentTarget.files ? Array.from(e.currentTarget.files) : null;
          void accept(files);
          e.currentTarget.value = "";
        }}
      />
      <AvatarCropDialog
        source={cropSource}
        label={cropTargetLabel}
        open={cropTargetIndex !== undefined}
        onOpenChange={(open) => !open && setCropTargetIndex(undefined)}
        onConfirm={confirmCrop}
      />
    </div>
  );
}

interface AvatarUploaderProps {
  template: PetpetTemplate | null;
  avatars: AvatarState;
  onChange: (type: AvatarType, value: AvatarValue) => void;
}

/**
 * 根据模板自动展示需要的头像槽位。
 * 模板里 `avatar: []`（如 osu）时则不显示任何槽位。
 */
export function AvatarUploader({ template, avatars, onChange }: AvatarUploaderProps) {
  if (!template) return null;

  const slots = getAvatarSlots(template);

  if (slots.length === 0) {
    return (
      <div className="flex items-start gap-2 py-1 text-sm text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0 text-media-img" />
        <span>此模板不需要上传头像，直接编辑文字即可。</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {slots.map((slot) => (
        <AvatarSlot
          key={slot.type}
          type={slot.type}
          value={avatars[slot.type]}
          requiredCount={slot.requiredCount}
          maxCount={slot.maxCount}
          onChange={(value) => onChange(slot.type, value)}
        />
      ))}
    </div>
  );
}

export interface AvatarSlotDefinition {
  readonly type: AvatarType;
  readonly requiredCount: number;
  readonly maxCount?: number;
}

export function getAvatarSlots(template: PetpetTemplate): AvatarSlotDefinition[] {
  return Array.from(new Set(template.avatar.map((avatar) => avatar.type))).map((type) => {
    const definitions = template.avatar.filter((avatar) => avatar.type === type);
    const requiredCount = definitions.reduce((count, avatar) => {
      if (avatar.optional) return count;
      if (type !== "USER") return Math.max(count, 1);
      return Math.max(count, (avatar.fallbackInput ?? avatar.input ?? 0) + 1);
    }, 0);

    if (type !== "USER") return { type, requiredCount };

    const cycles = definitions.flatMap((avatar) => (avatar.inputCycle ? [avatar.inputCycle] : []));
    const fixedInputCount = definitions.reduce((count, avatar) => {
      if (avatar.inputCycle) return count;
      return Math.max(
        count,
        (avatar.input ?? 0) + 1,
        (avatar.fallbackInput ?? -1) + 1,
        (avatar.visibleWhenInput ?? -1) + 1,
      );
    }, 0);
    const hasUnboundedCycle = cycles.some((cycle) => cycle.maxInputs === undefined);
    const maxCount =
      cycles.length > 0 && !hasUnboundedCycle
        ? Math.max(requiredCount, fixedInputCount, ...cycles.map((cycle) => cycle.maxInputs ?? 0))
        : undefined;

    return {
      type,
      requiredCount,
      ...(maxCount !== undefined && { maxCount }),
    };
  });
}
