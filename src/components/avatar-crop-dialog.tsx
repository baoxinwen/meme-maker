import { Crop, Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactCrop, { type PercentCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  type AvatarCrop,
  type AvatarSource,
  type DecodedGif,
  FULL_AVATAR_CROP,
  decodeGif,
  normalizeAvatarCrop,
} from "@/core";

interface AvatarCropDialogProps {
  source: AvatarSource | undefined;
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (crop: AvatarCrop) => void;
}

function toPercentCrop(crop: AvatarCrop): PercentCrop {
  return { unit: "%", ...crop };
}

function isValidCrop(crop: PercentCrop): boolean {
  try {
    normalizeAvatarCrop(crop);
    return true;
  } catch {
    return false;
  }
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function AvatarCropDialog({
  source,
  label,
  open,
  onOpenChange,
  onConfirm,
}: AvatarCropDialogProps) {
  const isVideo = source?.blob.type.startsWith("video/") ?? false;
  const isGif = source?.blob.type === "image/gif";
  const [crop, setCrop] = useState<PercentCrop>(() =>
    toPercentCrop(source?.crop ?? FULL_AVATAR_CROP),
  );
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(() => !prefersReducedMotion());
  const [gif, setGif] = useState<DecodedGif | null>(null);
  const [gifError, setGifError] = useState<string | null>(null);
  const [gifFrameIndex, setGifFrameIndex] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const gifCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (open && source) setCrop(toPercentCrop(source.crop));
  }, [open, source]);

  useEffect(() => {
    if (!open || !source || !isGif) {
      setGif(null);
      setGifError(null);
      setGifFrameIndex(0);
      return;
    }
    let active = true;
    setGif(null);
    setGifError(null);
    setGifFrameIndex(0);
    void decodeGif(source.blob)
      .then((decoded) => {
        if (active) setGif(decoded);
      })
      .catch((error) => {
        if (active) {
          setGifError(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      active = false;
    };
  }, [isGif, open, source]);

  useEffect(() => {
    if (!open || !source) {
      setMediaUrl(null);
      return;
    }
    const url = URL.createObjectURL(source.blob);
    setMediaUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [open, source]);

  useEffect(() => {
    if (!open || !source) return;
    setPlaying(!prefersReducedMotion());
  }, [open, source]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) setPlaying(false);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isVideo) return;
    if (playing) {
      void video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  }, [isVideo, playing]);

  useEffect(() => {
    if (!gif || !gifCanvasRef.current || gif.frames.length === 0) return;
    const frame = gif.frames[gifFrameIndex % gif.frames.length];
    const canvas = gifCanvasRef.current;
    canvas.width = frame.width;
    canvas.height = frame.height;
    const context = canvas.getContext("2d");
    context?.clearRect(0, 0, canvas.width, canvas.height);
    context?.drawImage(frame, 0, 0);
  }, [gif, gifFrameIndex]);

  useEffect(() => {
    if (!gif || !playing || gif.frames.length <= 1) return;
    const delay = Math.max(20, gif.delays[gifFrameIndex] ?? 100);
    const timer = window.setTimeout(
      () => setGifFrameIndex((index) => (index + 1) % gif.frames.length),
      delay,
    );
    return () => window.clearTimeout(timer);
  }, [gif, gifFrameIndex, playing]);

  const title = `调整${label}取景`;

  return (
    <Dialog open={open && source !== undefined} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[calc(100%-1rem)] max-w-3xl gap-0 overflow-hidden p-0"
        showCloseButton={false}
      >
        <DialogHeader className="border-b border-border px-4 py-4 pr-12 text-left sm:px-5">
          <DialogTitle className="flex items-center gap-2">
            <Crop className="size-5 text-primary" />
            {title}
          </DialogTitle>
          <DialogDescription>此取景将应用于所有帧，原始文件会保留。</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-52 items-center justify-center overflow-auto bg-slate-950 p-4 sm:p-6">
          {mediaUrl && (
            <ReactCrop
              className="avatar-crop-editor max-h-[58dvh] max-w-full"
              crop={crop}
              keepSelection
              minWidth={1}
              minHeight={1}
              ruleOfThirds
              ariaLabels={{
                cropArea: `${label}取景区域`,
                nwDragHandle: "调整左上角",
                nDragHandle: "调整上边缘",
                neDragHandle: "调整右上角",
                eDragHandle: "调整右边缘",
                seDragHandle: "调整右下角",
                sDragHandle: "调整下边缘",
                swDragHandle: "调整左下角",
                wDragHandle: "调整左边缘",
              }}
              onChange={(_, percentCrop) => setCrop(percentCrop)}
            >
              {isGif ? (
                gif ? (
                  <canvas
                    ref={gifCanvasRef}
                    width={gif.frames[0]?.width}
                    height={gif.frames[0]?.height}
                    aria-label={`${label}取景预览`}
                    className="max-h-[58dvh] max-w-full"
                  />
                ) : (
                  <span className="px-4 py-10 text-sm text-white/70">
                    {gifError ? `GIF 读取失败：${gifError}` : "正在读取 GIF 帧…"}
                  </span>
                )
              ) : isVideo ? (
                <video
                  ref={videoRef}
                  src={mediaUrl}
                  aria-label={`${label}取景预览`}
                  className="max-h-[58dvh] max-w-full"
                  autoPlay={playing}
                  loop
                  muted
                  playsInline
                />
              ) : (
                <img src={mediaUrl} alt={`${label}取景预览`} className="max-h-[58dvh] max-w-full" />
              )}
            </ReactCrop>
          )}
        </div>

        <DialogFooter className="border-t border-border bg-background p-3 sm:p-4">
          {(isVideo || Boolean(gif)) && (
            <Button
              type="button"
              variant="outline"
              className="h-12 sm:mr-auto"
              aria-label={playing ? "暂停取景预览" : "播放取景预览"}
              onClick={() => setPlaying((value) => !value)}
            >
              {playing ? <Pause /> : <Play />}
              {playing ? "暂停预览" : "播放预览"}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            className="h-12 sm:mr-auto"
            onClick={() => setCrop(toPercentCrop(FULL_AVATAR_CROP))}
          >
            <RotateCcw />
            恢复完整画面
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-12"
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            type="button"
            className="h-12"
            disabled={!source || !isValidCrop(crop)}
            onClick={() => {
              onConfirm(normalizeAvatarCrop(crop));
              onOpenChange(false);
            }}
          >
            <Crop />
            确认取景
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
