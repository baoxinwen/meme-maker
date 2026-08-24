/**
 * 表情包预览舞台 —— 显示引擎渲染好的帧。
 *
 * 多帧模板自动播放；播放条支持拖拽定位任意帧（拖拽即暂停），
 * 键盘左右键按帧步进。静态模板只显示第 0 帧且不渲染播放条。
 */

import { Loader2, Pause, Play, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { type PreparedScene, renderFrame } from "@/core";
import type { SceneError } from "@/lib/scene-error";
import { cn } from "@/lib/utils";

interface MemeCanvasProps {
  scene: PreparedScene | null;
  loading: boolean;
  /** 场景错误；missingAvatar 非 null 时是"缺头像引导态"而非报错 */
  error: SceneError | null;
}

/** 把缺头像信息还原成展示标签，如 "TO" 或 "USER #2"。 */
function missingAvatarLabel(missing: NonNullable<SceneError["missingAvatar"]>): string {
  return `${missing.type}${missing.inputIndex !== null ? ` #${missing.inputIndex + 1}` : ""}`;
}

export function MemeCanvas({ scene, loading, error }: MemeCanvasProps) {
  const displayRef = useRef<HTMLCanvasElement>(null);
  const previewAreaRef = useRef<HTMLDivElement>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(
    () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [availableWidth, setAvailableWidth] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [renderError, setRenderError] = useState<string | null>(null);
  const missingAvatar = error?.missingAvatar ?? null;
  const errorMessage = error?.message ?? null;
  const frameCount = scene?.frameCount ?? 0;
  const isAnimated = frameCount > 1;
  const rawDelay =
    scene?.frameDelays?.[Math.min(frameIndex, (scene.frameDelays?.length ?? 1) - 1)] ??
    scene?.delay ??
    65;
  // 非有限延迟会让 setTimeout 退化为 0ms 全速空转，这里做最后一道兜底
  const delay = Number.isFinite(rawDelay) ? Math.max(20, rawDelay) : 65;
  const totalMs =
    scene?.frameDelays?.reduce((sum, d) => sum + d, 0) ?? (scene?.delay ?? 65) * frameCount;
  const ratio = scene ? scene.width / scene.height : 4 / 3;
  const maxHeight = Math.min(
    600,
    Math.max(220, viewportHeight * (availableWidth < 640 ? 0.42 : 0.58)),
  );
  const maximumWidth = scene ? availableWidth : Math.min(availableWidth, 512);
  const stageWidth = availableWidth > 0 ? Math.min(maximumWidth, maxHeight * ratio) : null;

  useEffect(() => {
    const area = previewAreaRef.current;
    if (!area) return;

    const measure = () => {
      setAvailableWidth(Math.max(0, area.clientWidth - 22));
      setViewportHeight(window.innerHeight);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  useEffect(() => {
    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const stopPlayback = (event: MediaQueryListEvent) => {
      if (event.matches) setPlaying(false);
    };
    if (motionPreference.matches) setPlaying(false);
    motionPreference.addEventListener("change", stopPlayback);
    return () => motionPreference.removeEventListener("change", stopPlayback);
  }, []);

  // 当帧数量变短时，避免当前帧下标越界
  useEffect(() => {
    if (frameIndex >= frameCount) setFrameIndex(0);
  }, [frameIndex, frameCount]);

  // 只把当前展示帧画到复用的显示画布，避免编辑时常驻全部导出帧。
  useEffect(() => {
    const display = displayRef.current;
    if (!display || !scene) return;
    display.width = scene.width;
    display.height = scene.height;
    const displayIndex = Math.min(frameIndex, scene.frameCount - 1);
    const rawFrameIndex = scene.reverse ? scene.frameCount - 1 - displayIndex : displayIndex;
    try {
      renderFrame(scene, rawFrameIndex, display);
      setRenderError(null);
    } catch (error) {
      // 逐帧 pos 表达式等错误只会在渲染期暴露；就地展示而不是让异常冒泡重置路由
      setRenderError(error instanceof Error ? error.message : String(error));
    }
  }, [scene, frameIndex]);

  // GIF 动画播放：每次根据当前帧的延迟重新排程，保留源 GIF 的逐帧时序。
  useEffect(() => {
    if (!playing || frameCount <= 1) return;
    const id = window.setTimeout(() => {
      setFrameIndex((i) => (i + 1) % frameCount);
    }, delay);
    return () => window.clearTimeout(id);
  }, [playing, frameCount, delay]);

  return (
    <div className="relative flex flex-col items-center gap-3 sm:gap-4">
      <div ref={previewAreaRef} className="flex w-full justify-center">
        <div
          className="sticker-frame max-w-full"
          style={stageWidth ? { width: `${Math.round(stageWidth + 24)}px` } : undefined}
        >
          <div
            data-testid="preview-stage"
            aria-busy={loading}
            className={cn(
              "canvas-stage relative w-full overflow-hidden",
              "flex items-center justify-center",
            )}
            style={{ aspectRatio: `${scene?.width ?? 4} / ${scene?.height ?? 3}` }}
          >
            {loading && (
              <output
                aria-live="polite"
                aria-atomic="true"
                className="absolute inset-0 z-10 flex items-center justify-center bg-background/85 backdrop-blur-sm"
              >
                <div className="flex flex-col items-center gap-3">
                  <div className="size-20 animate-pulse rounded-lg bg-primary/15" />
                  <Loader2 className="size-7 animate-spin text-primary" />
                  <span className="sr-only">正在生成预览</span>
                </div>
              </output>
            )}
            {missingAvatar && (
              <output
                aria-live="polite"
                aria-atomic="true"
                className="absolute inset-0 flex items-center justify-center bg-background/70 p-4 backdrop-blur-[2px]"
              >
                <div className="text-center">
                  <span aria-hidden className="mb-2 block text-3xl">
                    📷
                  </span>
                  <p className="text-sm font-bold">
                    请上传{" "}
                    <strong className="text-primary">{missingAvatarLabel(missingAvatar)}</strong>{" "}
                    头像
                  </p>
                  <p className="mt-1 text-xs opacity-70">在「头像」分区选择图片</p>
                </div>
              </output>
            )}
            {!missingAvatar && (errorMessage || renderError) && (
              <div
                role="alert"
                className="absolute inset-0 flex items-center justify-center bg-destructive/10 p-4"
              >
                <div className="text-center text-sm text-destructive">
                  <strong>渲染失败</strong>
                  <br />
                  <pre className="mt-2 text-xs whitespace-pre-wrap">
                    {errorMessage ?? renderError}
                  </pre>
                </div>
              </div>
            )}
            {scene ? (
              <canvas
                ref={displayRef}
                role="img"
                className="block size-full"
                aria-label="表情包生成预览"
              />
            ) : (
              !loading &&
              !error && (
                <div className="flex flex-col items-center gap-2 px-6 text-center text-muted-foreground">
                  <Sparkles className="size-8 text-primary/50" />
                  <span>选择模板后，预览会在这里出现</span>
                </div>
              )
            )}
          </div>
        </div>
      </div>

      {/* 播放控制条：可拖拽定位帧 */}
      {isAnimated && (
        <PlaybackBar
          frameCount={frameCount}
          frameIndex={frameIndex}
          playing={playing}
          delay={delay}
          totalMs={totalMs}
          onTogglePlay={() => setPlaying((p) => !p)}
          onSeek={(index) => {
            setPlaying(false);
            setFrameIndex(index);
          }}
        />
      )}
    </div>
  );
}

function PlaybackBar({
  frameCount,
  frameIndex,
  playing,
  delay,
  totalMs,
  onTogglePlay,
  onSeek,
}: {
  frameCount: number;
  frameIndex: number;
  playing: boolean;
  delay: number;
  totalMs: number;
  onTogglePlay: () => void;
  onSeek: (index: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const progress = ((frameIndex + 1) / frameCount) * 100;

  const seekFromPointer = (clientX: number) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const ratioX = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    onSeek(Math.min(frameCount - 1, Math.floor(ratioX * frameCount)));
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      onSeek(Math.max(0, frameIndex - 1));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      onSeek(Math.min(frameCount - 1, frameIndex + 1));
    } else if (event.key === "Home") {
      event.preventDefault();
      onSeek(0);
    } else if (event.key === "End") {
      event.preventDefault();
      onSeek(frameCount - 1);
    }
  };

  return (
    <div className="tool-panel flex w-full max-w-2xl items-center gap-2.5 px-3 py-2 shadow-pop-sm">
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={playing ? "暂停预览" : "播放预览"}
        onClick={onTogglePlay}
        className="shrink-0 rounded-full border-line hover:border-primary hover:text-primary"
      >
        {playing ? <Pause /> : <Play />}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="上一帧"
        disabled={frameIndex === 0}
        onClick={() => onSeek(frameIndex - 1)}
        className="hidden shrink-0 text-muted-foreground sm:inline-flex"
      >
        ⟨
      </Button>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="播放进度"
        aria-valuemin={1}
        aria-valuemax={frameCount}
        aria-valuenow={frameIndex + 1}
        aria-valuetext={`第 ${frameIndex + 1} 帧，共 ${frameCount} 帧`}
        onKeyDown={handleKeyDown}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          seekFromPointer(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons > 0) seekFromPointer(e.clientX);
        }}
        className="group relative h-7 min-w-0 flex-1 cursor-pointer touch-none select-none"
      >
        <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 overflow-hidden rounded-full border border-line bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-150"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div
          aria-hidden
          className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-line bg-card shadow-pop-sm group-focus-visible:ring-2 group-focus-visible:ring-ring"
          style={{ left: `${progress}%` }}
        />
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="下一帧"
        disabled={frameIndex >= frameCount - 1}
        onClick={() => onSeek(frameIndex + 1)}
        className="hidden shrink-0 text-muted-foreground sm:inline-flex"
      >
        ⟩
      </Button>
      <span className="status-pill shrink-0 font-mono" data-tone="amber">
        {frameIndex + 1} / {frameCount}
      </span>
      <span
        aria-hidden
        className="hidden shrink-0 font-mono text-[10px] text-muted-foreground sm:block"
        title={`每帧 ${delay}ms`}
      >
        {(totalMs / 1000).toFixed(2)}s
      </span>
    </div>
  );
}
