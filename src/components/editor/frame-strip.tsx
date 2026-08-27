/**
 * 背景工具栏 —— 管理帧缩略图、替换背景与清空背景。
 */

import { GripVertical, X } from "lucide-react";
import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";

import { FrameUploader } from "@/components/editor/frame-uploader";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/stores/editor-store";

const frameKeys = new WeakMap<HTMLCanvasElement, string>();
const frameThumbnails = new WeakMap<HTMLCanvasElement, string>();
let nextFrameKey = 0;

interface FrameDragState {
  pointerId: number;
  fromIndex: number;
  toIndex: number;
  indicator: { index: number; side: "before" | "after" } | null;
}

const AUTO_SCROLL_EDGE = 32;
const AUTO_SCROLL_STEP = 14;

export function resolveFrameDropIndex(
  fromIndex: number,
  targetIndex: number,
  side: "before" | "after",
): number {
  if (side === "before") return targetIndex - (fromIndex < targetIndex ? 1 : 0);
  return targetIndex + (fromIndex > targetIndex ? 1 : 0);
}

export function FrameStrip() {
  const frames = useEditorStore((s) => s.frames);
  const frameIndex = useEditorStore((s) => s.frameIndex);
  const setFrameIndex = useEditorStore((s) => s.setFrameIndex);
  const removeFrame = useEditorStore((s) => s.removeFrame);
  const moveFrame = useEditorStore((s) => s.moveFrame);
  const isBackgroundOperationInProgress = useEditorStore((s) => s.isBackgroundOperationInProgress);
  const timelineRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<FrameDragState | null>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const autoScrollDirectionRef = useRef<-1 | 0 | 1>(0);
  const animationFrameRef = useRef<number | null>(null);
  const [drag, setDrag] = useState<FrameDragState | null>(null);

  const setDragState = (next: FrameDragState | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  const findDropTarget = (
    clientX: number,
    clientY: number,
  ): { index: number; side: "before" | "after" } | null => {
    const target = document
      .elementFromPoint(clientX, clientY)
      ?.closest<HTMLElement>("[data-frame-index]");
    const value = target?.dataset.frameIndex;
    if (!target || value === undefined) return null;
    const index = Number(value);
    if (!Number.isInteger(index) || index < 0 || index >= frames.length) return null;
    const rect = target.getBoundingClientRect();
    return { index, side: clientX < rect.left + rect.width / 2 ? "before" : "after" };
  };

  const updateAutoScrollDirection = (clientX: number) => {
    const timeline = timelineRef.current;
    if (!timeline) return;
    const rect = timeline.getBoundingClientRect();
    if (clientX < rect.left + AUTO_SCROLL_EDGE) {
      autoScrollDirectionRef.current = -1;
    } else if (clientX > rect.right - AUTO_SCROLL_EDGE) {
      autoScrollDirectionRef.current = 1;
    } else {
      autoScrollDirectionRef.current = 0;
    }
  };

  const updateDragTarget = (clientX: number, clientY: number) => {
    const active = dragRef.current;
    if (!active) return;
    const target = findDropTarget(clientX, clientY);
    if (!target) return;
    const toIndex = resolveFrameDropIndex(active.fromIndex, target.index, target.side);
    const indicator = toIndex === active.fromIndex ? null : target;
    if (
      toIndex !== active.toIndex ||
      indicator?.index !== active.indicator?.index ||
      indicator?.side !== active.indicator?.side
    ) {
      setDragState({ ...active, toIndex, indicator });
    }
  };

  const stopAutoScroll = () => {
    autoScrollDirectionRef.current = 0;
    pointerRef.current = null;
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  };

  const runAutoScroll = () => {
    const timeline = timelineRef.current;
    const pointer = pointerRef.current;
    if (!timeline || !dragRef.current) {
      animationFrameRef.current = null;
      return;
    }
    if (pointer && autoScrollDirectionRef.current !== 0) {
      timeline.scrollLeft += autoScrollDirectionRef.current * AUTO_SCROLL_STEP;
      updateDragTarget(pointer.x, pointer.y);
    }
    animationFrameRef.current = window.requestAnimationFrame(runAutoScroll);
  };

  useEffect(() => {
    return () => {
      autoScrollDirectionRef.current = 0;
      pointerRef.current = null;
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  const handlePointerDown = (event: PointerEvent<HTMLElement>, index: number) => {
    if (isBackgroundOperationInProgress) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragState({ pointerId: event.pointerId, fromIndex: index, toIndex: index, indicator: null });
    animationFrameRef.current = window.requestAnimationFrame(runAutoScroll);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const active = dragRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    pointerRef.current = { x: event.clientX, y: event.clientY };
    updateAutoScrollDirection(event.clientX);
    updateDragTarget(event.clientX, event.clientY);
    if (animationFrameRef.current === null) {
      animationFrameRef.current = window.requestAnimationFrame(runAutoScroll);
    }
  };

  const finishDrag = (pointerId: number) => {
    const active = dragRef.current;
    if (!active || active.pointerId !== pointerId) return;
    stopAutoScroll();
    if (active.fromIndex !== active.toIndex) {
      moveFrame(active.fromIndex, active.toIndex);
    }
    setDragState(null);
  };

  const handleFrameKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!event.altKey || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    const nextIndex = event.key === "ArrowLeft" ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= frames.length) return;
    event.preventDefault();
    moveFrame(index, nextIndex);
  };

  if (frames.length === 0) return null;

  return (
    <div
      data-testid="background-toolbar"
      aria-busy={isBackgroundOperationInProgress}
      className="tool-panel grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md p-2 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
    >
      <div data-testid="background-status" className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-xs font-semibold text-muted-foreground">背景</span>
        <span
          data-testid="background-frame-count"
          className="status-pill shrink-0"
          data-tone={frames.length > 1 ? "amber" : "info"}
        >
          {frames.length} 帧
        </span>
      </div>
      <div
        ref={timelineRef}
        data-testid="background-timeline"
        className="order-3 col-span-2 flex min-w-0 gap-2 overflow-x-auto overflow-y-hidden px-2 py-1 sm:order-none sm:col-span-1"
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => finishDrag(event.pointerId)}
        onPointerCancel={(event) => finishDrag(event.pointerId)}
      >
        <p id="background-timeline-help" className="sr-only">
          聚焦帧后按 Alt 加左右方向键可调整帧顺序。
        </p>
        {frames.map((frame, index) => (
          <div
            key={getFrameKey(frame)}
            data-frame-index={index}
            data-frame-item
            className={cn(
              "relative size-14 shrink-0 transition-all duration-150 sm:size-16",
              drag?.fromIndex === index && "scale-95 opacity-45",
              drag?.indicator?.index === index &&
                drag.indicator.side === "before" &&
                "before:absolute before:-left-2 before:top-1 before:bottom-1 before:z-20 before:w-0.5 before:rounded-full before:bg-primary",
              drag?.indicator?.index === index &&
                drag.indicator.side === "after" &&
                "after:absolute after:-right-2 after:top-1 after:bottom-1 after:z-20 after:w-0.5 after:rounded-full after:bg-primary",
            )}
          >
            <button
              type="button"
              data-testid={`background-frame-${index}`}
              aria-label={`选择第 ${index + 1} 帧`}
              aria-describedby="background-timeline-help"
              aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
              aria-current={index === frameIndex ? "true" : undefined}
              disabled={isBackgroundOperationInProgress}
              onClick={() => setFrameIndex(index)}
              onKeyDown={(event) => handleFrameKeyDown(event, index)}
              className={cn(
                "size-full overflow-hidden rounded-md border-2 bg-muted transition-all duration-200",
                index === frameIndex
                  ? "border-primary shadow-sm shadow-primary/25"
                  : "border-transparent hover:border-primary/40",
              )}
              title={`第 ${index + 1} 帧`}
            >
              <FrameThumbnail frame={frame} index={index} />
              <span className="absolute bottom-0 right-0 rounded-tl bg-card/90 px-1 text-[10px] font-bold text-muted-foreground">
                {index + 1}
              </span>
            </button>
            {frames.length > 1 && (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      data-testid={`background-frame-drag-${index}`}
                      data-frame-control
                      aria-hidden="true"
                      className={cn(
                        "absolute -left-2 -top-2 grid size-9 touch-none place-items-center rounded-full border-2 border-line bg-card/92 shadow-pop-sm p-0",
                        isBackgroundOperationInProgress
                          ? "pointer-events-none opacity-50"
                          : "cursor-grab active:cursor-grabbing",
                      )}
                      onPointerDown={(event) => handlePointerDown(event, index)}
                    >
                      <GripVertical className="size-3.5" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>拖动调整顺序</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      data-testid={`background-frame-delete-${index}`}
                      data-frame-control
                      aria-label={`删除第 ${index + 1} 帧`}
                      disabled={isBackgroundOperationInProgress}
                      className="absolute -right-2 -top-2 size-9 rounded-full border-2 border-line bg-card/92 shadow-pop-sm p-0"
                      onClick={() => removeFrame(index)}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>删除第 {index + 1} 帧</TooltipContent>
                </Tooltip>
              </>
            )}
          </div>
        ))}
      </div>
      <FrameUploader compact />
    </div>
  );
}

function FrameThumbnail({ frame, index }: { frame: HTMLCanvasElement; index: number }) {
  const [source, setSource] = useState(() => frameThumbnails.get(frame) ?? "");
  const hostRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const cached = frameThumbnails.get(frame);
    if (cached) {
      setSource(cached);
      return;
    }

    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let idleHandle: number | null = null;
    let timeoutHandle: ReturnType<typeof globalThis.setTimeout> | null = null;
    let idleScheduled = false;

    const encode = () => {
      if (cancelled) return;
      const next = frame.toDataURL();
      frameThumbnails.set(frame, next);
      setSource(next);
    };
    const scheduleEncode = () => {
      if (idleScheduled) return;
      idleScheduled = true;
      if ("requestIdleCallback" in window) {
        idleHandle = window.requestIdleCallback(encode, { timeout: 500 });
      } else {
        timeoutHandle = globalThis.setTimeout(encode, 0);
      }
    };

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      scheduleEncode();
    });
    observer.observe(host);

    return () => {
      cancelled = true;
      observer.disconnect();
      if (idleHandle !== null && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle !== null) globalThis.clearTimeout(timeoutHandle);
    };
  }, [frame]);

  return (
    <span ref={hostRef} className="block size-full">
      {source ? (
        <img src={source} alt={`第 ${index + 1} 帧`} className="size-full object-contain" />
      ) : (
        <span className="block size-full animate-pulse bg-muted" aria-hidden="true" />
      )}
    </span>
  );
}

function getFrameKey(frame: HTMLCanvasElement): string {
  const existing = frameKeys.get(frame);
  if (existing) return existing;
  const key = `frame-${nextFrameKey}`;
  nextFrameKey += 1;
  frameKeys.set(frame, key);
  return key;
}
