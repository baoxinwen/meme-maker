/**
 * 背景帧上传器。
 *
 * 初始导入、添加背景与替换当前帧共用解码和校验逻辑，但分别保留独立的操作语义。
 */

import { ImagePlus, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { decodeGif } from "@/core";
import { copyAsCanvas } from "@/core/utils/canvas";
import { clearRedoHistory } from "@/hooks/use-editor-history";
import { logger } from "@/lib/logger";
import {
  SUPPORTED_IMAGE_ACCEPT,
  UPLOAD_LIMITS,
  assertFrameSequence,
  assertImageDimensions,
  assertImageFileBasics,
  assertUploadCollection,
  loadValidatedImage,
} from "@/lib/upload-limits";
import { cn } from "@/lib/utils";
import { findFrameIndexByIdentity, useEditorStore } from "@/stores/editor-store";

interface FrameUploaderProps {
  compact?: boolean;
}

function sortedFiles(files: FileList | readonly File[] | null | undefined): File[] {
  return Array.from(files ?? []).sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { numeric: true }),
  );
}

async function decodeBackgroundFiles(
  files: FileList | readonly File[] | null | undefined,
  options: {
    readonly retainedFrames?: readonly { width: number; height: number }[];
    readonly maxNewFrames?: number;
  } = {},
): Promise<HTMLCanvasElement[]> {
  const images = sortedFiles(files);
  assertUploadCollection(images, "background");
  const retainedFrames = options.retainedFrames ?? [];
  const retainedPixels = totalFramePixels(retainedFrames);
  const availableFrames = UPLOAD_LIMITS.backgroundMaxFiles - retainedFrames.length;
  const budget = {
    remainingFrames: Math.min(availableFrames, options.maxNewFrames ?? availableFrames),
    remainingPixels: UPLOAD_LIMITS.backgroundMaxTotalPixels - retainedPixels,
    remainingMemoryBytes: UPLOAD_LIMITS.backgroundMaxMemoryBytes - retainedPixels * 4,
  };
  assertBackgroundBudgetAvailable(budget);

  const frames: HTMLCanvasElement[] = [];
  for (const file of images) {
    try {
      assertBackgroundBudgetAvailable(budget);
      if (file.type === "image/gif") {
        assertImageFileBasics(file, "background");
        const decoded = await decodeGif(file, {
          maxFrames: budget.remainingFrames,
          maxEdge: UPLOAD_LIMITS.imageMaxEdge,
          maxTotalPixels: budget.remainingPixels,
          maxMemoryBytes: budget.remainingMemoryBytes,
        });
        const decodedFrames = decoded.frames as HTMLCanvasElement[];
        consumeBackgroundBudget(budget, decodedFrames);
        frames.push(...decodedFrames);
      } else {
        const image = await loadValidatedImage(file, "background");
        consumeBackgroundBudget(budget, [image]);
        frames.push(copyAsCanvas(image) as HTMLCanvasElement);
      }
    } catch (error) {
      logger.error(`背景文件 ${file.name} 导入失败`, error);
      throw new Error(`${file.name} 导入失败：${getErrorMessage(error)}`);
    }
  }

  assertFrameSequence([...retainedFrames, ...frames]);
  return frames;
}

function totalFramePixels(frames: readonly { width: number; height: number }[]): number {
  let total = 0;
  for (const frame of frames) {
    assertImageDimensions(frame.width, frame.height);
    const pixels = frame.width * frame.height;
    if (!Number.isSafeInteger(pixels) || !Number.isSafeInteger(total + pixels)) {
      throw new Error("背景像素总量预算超限");
    }
    total += pixels;
  }
  return total;
}

function assertBackgroundBudgetAvailable(budget: {
  readonly remainingFrames: number;
  readonly remainingPixels: number;
  readonly remainingMemoryBytes: number;
}): void {
  if (budget.remainingFrames <= 0) throw new Error("背景帧数预算已用尽");
  if (budget.remainingPixels <= 0) throw new Error("背景像素总量预算已用尽");
  if (budget.remainingMemoryBytes <= 0) throw new Error("背景内存预算已用尽");
}

function consumeBackgroundBudget(
  budget: {
    remainingFrames: number;
    remainingPixels: number;
    remainingMemoryBytes: number;
  },
  frames: readonly { width: number; height: number }[],
): void {
  const pixels = totalFramePixels(frames);
  const memoryBytes = pixels * 4;
  if (frames.length > budget.remainingFrames) {
    throw new Error(
      `背景帧数预算超限：还可导入 ${budget.remainingFrames} 帧，本次解码得到 ${frames.length} 帧`,
    );
  }
  if (pixels > budget.remainingPixels) {
    throw new Error(`背景像素总量预算超限：本次需要 ${pixels}，剩余 ${budget.remainingPixels}`);
  }
  if (!Number.isSafeInteger(memoryBytes) || memoryBytes > budget.remainingMemoryBytes) {
    throw new Error(
      `背景内存预算超限：本次需要 ${memoryBytes}，剩余 ${budget.remainingMemoryBytes}`,
    );
  }
  budget.remainingFrames -= frames.length;
  budget.remainingPixels -= pixels;
  budget.remainingMemoryBytes -= memoryBytes;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function FrameUploader({ compact = false }: FrameUploaderProps) {
  const replaceFrames = useEditorStore((state) => state.replaceFrames);
  const clearFrames = useEditorStore((state) => state.clearFrames);
  const isBackgroundOperationInProgress = useEditorStore(
    (state) => state.isBackgroundOperationInProgress,
  );
  const setBackgroundOperationInProgress = useEditorStore(
    (state) => state.setBackgroundOperationInProgress,
  );
  const initialInputRef = useRef<HTMLInputElement>(null);
  const addInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);

  const beginBackgroundOperation = () => {
    if (useEditorStore.getState().isBackgroundOperationInProgress) return false;
    setBackgroundOperationInProgress(true);
    useEditorStore.temporal.getState().pause();
    return true;
  };

  const importInitialFrames = async (files: FileList | null | undefined) => {
    if (!files || files.length === 0) return;
    if (!beginBackgroundOperation()) return;
    try {
      const frames = await decodeBackgroundFiles(files);
      replaceFrames(frames);
      toast.success(`已导入 ${frames.length} 帧背景`);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBackgroundOperationInProgress(false);
      useEditorStore.temporal.getState().resume();
      clearRedoHistory();
    }
  };

  const addFrames = async (files: FileList | null | undefined) => {
    if (!files || files.length === 0) return;
    const initialState = useEditorStore.getState();
    const targetFrame = initialState.frames[initialState.frameIndex];
    if (!targetFrame) {
      toast.error("请先导入背景图");
      return;
    }
    if (!beginBackgroundOperation()) return;
    try {
      const frames = await decodeBackgroundFiles(files, {
        retainedFrames: initialState.frames,
      });
      const state = useEditorStore.getState();
      const targetIndex = findFrameIndexByIdentity(state.frames, targetFrame);
      if (targetIndex < 0) throw new Error("当前背景帧已被移除，请重新选择后再添加");
      assertFrameSequence([...state.frames, ...frames]);
      state.insertFrames(targetIndex, frames);
      toast.success(`已在当前帧后添加 ${frames.length} 帧背景`);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBackgroundOperationInProgress(false);
      useEditorStore.temporal.getState().resume();
      clearRedoHistory();
    }
  };

  const replaceCurrentFrame = async (files: FileList | null | undefined) => {
    if (!files || files.length === 0) return;
    const initialState = useEditorStore.getState();
    const targetFrame = initialState.frames[initialState.frameIndex];
    if (!targetFrame) {
      toast.error("请先导入背景图");
      return;
    }
    if (!beginBackgroundOperation()) return;
    try {
      if (files.length !== 1) {
        throw new Error("替换当前帧仅支持一张静态图片或单帧 GIF");
      }
      const frames = await decodeBackgroundFiles(files, {
        retainedFrames: initialState.frames.filter((_, index) => index !== initialState.frameIndex),
      });
      if (frames.length !== 1) {
        throw new Error("替换当前帧仅支持静态图片或单帧 GIF，请使用“添加背景”导入动画 GIF");
      }
      const state = useEditorStore.getState();
      const targetIndex = findFrameIndexByIdentity(state.frames, targetFrame);
      if (targetIndex < 0) throw new Error("当前背景帧已被移除，请重新选择后再替换");
      assertFrameSequence([targetFrame, frames[0]]);
      state.replaceFrame(targetIndex, frames[0]);
      toast.success("已替换当前背景帧");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBackgroundOperationInProgress(false);
      useEditorStore.temporal.getState().resume();
      clearRedoHistory();
    }
  };

  const initialInput = (
    <input
      ref={initialInputRef}
      data-testid="background-initial-input"
      type="file"
      accept={SUPPORTED_IMAGE_ACCEPT}
      multiple
      disabled={isBackgroundOperationInProgress}
      className="hidden"
      onChange={(event) => {
        void importInitialFrames(event.target.files);
        event.currentTarget.value = "";
      }}
    />
  );

  if (compact) {
    return (
      <>
        <div data-testid="background-actions" className="flex shrink-0 items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="在当前帧后添加背景"
                data-testid="background-add-button"
                disabled={isBackgroundOperationInProgress}
                className="border-primary/35 bg-primary/5 text-primary hover:bg-primary/10 hover:text-primary"
                onClick={() => addInputRef.current?.click()}
              >
                {isBackgroundOperationInProgress ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <ImagePlus />
                )}
                <span className="hidden sm:inline">添加</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>在当前帧后添加背景</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="替换当前帧"
                data-testid="background-replace-button"
                disabled={isBackgroundOperationInProgress}
                onClick={() => replaceInputRef.current?.click()}
              >
                <RefreshCw />
                <span className="hidden sm:inline">替换</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>替换当前帧</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="清空全部背景"
                data-testid="background-clear-button"
                disabled={isBackgroundOperationInProgress}
                onClick={() => setClearDialogOpen(true)}
              >
                <Trash2 className="text-destructive" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>清空全部背景</TooltipContent>
          </Tooltip>
        </div>
        <input
          ref={addInputRef}
          data-testid="background-add-input"
          type="file"
          accept={SUPPORTED_IMAGE_ACCEPT}
          multiple
          disabled={isBackgroundOperationInProgress}
          className="hidden"
          onChange={(event) => {
            void addFrames(event.target.files);
            event.currentTarget.value = "";
          }}
        />
        <input
          ref={replaceInputRef}
          data-testid="background-replace-input"
          type="file"
          accept={SUPPORTED_IMAGE_ACCEPT}
          disabled={isBackgroundOperationInProgress}
          className="hidden"
          onChange={(event) => {
            void replaceCurrentFrame(event.target.files);
            event.currentTarget.value = "";
          }}
        />
        <Dialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
          <DialogContent className="sm:max-w-md" showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>清空当前模板？</DialogTitle>
              <DialogDescription>
                将移除全部背景和图层，但保留模板名称、帧率、别名与播放设置。
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setClearDialogOpen(false)}>
                取消
              </Button>
              <Button
                type="button"
                variant="destructive"
                data-testid="background-clear-confirm"
                onClick={() => {
                  clearFrames();
                  setClearDialogOpen(false);
                  toast.success("已清空背景和图层");
                }}
              >
                清空背景和图层
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <div className="canvas-stage relative flex min-h-[360px] items-center justify-center overflow-hidden rounded-md p-3 sm:min-h-[420px]">
      <button
        type="button"
        className={cn(
          "upload-dropzone flex min-h-[320px] w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-md p-8 text-center transition-colors duration-200 sm:min-h-[380px]",
          dragOver ? "border-primary bg-primary/5" : "hover:border-primary/40",
        )}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          if (isBackgroundOperationInProgress) return;
          void importInitialFrames(event.dataTransfer.files);
        }}
        onClick={() => {
          if (!isBackgroundOperationInProgress) initialInputRef.current?.click();
        }}
        disabled={isBackgroundOperationInProgress}
      >
        <span className="grid size-14 place-items-center rounded-md bg-white text-primary shadow-xs">
          {isBackgroundOperationInProgress ? (
            <Loader2 className="size-6 animate-spin" />
          ) : (
            <ImagePlus className="size-6" />
          )}
        </span>
        <div className="font-display text-lg text-foreground">
          {isBackgroundOperationInProgress ? "加载中…" : "点击或拖拽上传背景图"}
        </div>
        <div className="max-w-sm text-xs leading-relaxed text-muted-foreground">
          可一次导入多张图片或 GIF，文件名顺序将作为背景帧顺序
        </div>
      </button>
      {initialInput}
    </div>
  );
}
