/**
 * 工具栏 —— 下载 / 复制到剪贴板。
 *
 * 静态 IMG 模板：下载/复制 PNG
 * 动态 GIF 模板：用 gifenc 编码出真正的 GIF；浏览器剪贴板复制 GIF 暂不支持
 */

import { Copy, Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { type PreparedScene, createCanvas, encodeGif, renderFrame } from "@/core";
import { downloadBlob } from "@/lib/download";
import { canvasToBlob } from "@/lib/image-blob";
import { logger } from "@/lib/logger";
import { useMemeStore } from "@/stores/meme-store";

interface ToolbarProps {
  scene: PreparedScene | null;
  templateKey: string | null;
  loading: boolean;
}

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * 根据场景生成成品 Blob：多帧场景导出 GIF，否则导出 PNG。
 *
 * 逐帧渲染并按批次让出主线程：大场景（512 帧 × 4096² 上限）同步渲染
 * 会冻结页面数十秒且不可取消。GIF 编码（gifenc）暂仍为同步执行。
 *
 * `shouldAbort` 在每帧渲染前与编码前检查：导出期间用户切换模板时，
 * 调用方借此放弃过期场景，返回 null（评审意见 I7）。
 */
export async function buildSceneBlob(
  scene: PreparedScene,
  options: { shouldAbort?: () => boolean } = {},
): Promise<{ blob: Blob; ext: "gif" | "png" } | null> {
  const { shouldAbort } = options;
  const aborted = () => shouldAbort?.() ?? false;
  const frames: HTMLCanvasElement[] = [];
  for (let displayIndex = 0; displayIndex < scene.frameCount; displayIndex += 1) {
    if (aborted()) return null;
    const rawFrameIndex = scene.reverse ? scene.frameCount - 1 - displayIndex : displayIndex;
    const canvas = createCanvas(scene.width, scene.height);
    renderFrame(scene, rawFrameIndex, canvas);
    frames.push(canvas);
    if ((displayIndex & 0b11) === 0b11) await yieldToMain();
  }

  if (aborted()) return null;
  if (scene.frameCount > 1) {
    const blob = encodeGif(frames, {
      delay: scene.frameDelays,
      transparent: true,
      repeat: 0,
    });
    return { blob, ext: "gif" };
  }
  const blob = await canvasToBlob(frames[0], "image/png");
  return { blob, ext: "png" };
}

export function Toolbar({ scene, templateKey, loading }: ToolbarProps) {
  const [busy, setBusy] = useState<"download" | "copy" | null>(null);
  const ready = !loading && scene !== null;
  const isAnimated = (scene?.frameCount ?? 0) > 1;
  const canCopy = ready && !isAnimated;

  const handleDownload = async () => {
    if (!ready) return;
    setBusy("download");
    try {
      if (!scene) throw new Error("场景尚未准备完成");
      const result = await buildSceneBlob(scene, {
        // 导出期间切换模板会清空 selectedTemplate，据此放弃过期场景
        shouldAbort: () => useMemeStore.getState().selectedTemplate !== templateKey,
      });
      if (!result) {
        logger.info("导出已取消：导出期间切换了模板");
        toast.info("已切换模板，本次导出已取消");
        return;
      }
      const { blob, ext } = result;
      downloadBlob(blob, `${templateKey ?? "meme"}.${ext}`);
      logger.info(`已下载 ${ext.toUpperCase()}：${templateKey ?? "meme"}`);
      toast.success(ext === "gif" ? "已下载 GIF" : "已下载 PNG");
    } catch (e) {
      logger.error("导出下载失败", e);
      toast.error(`下载失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const handleCopy = async () => {
    if (!canCopy) return;
    setBusy("copy");
    try {
      if (!scene) throw new Error("场景尚未准备完成");
      const result = await buildSceneBlob(scene, {
        shouldAbort: () => useMemeStore.getState().selectedTemplate !== templateKey,
      });
      if (!result) {
        logger.info("复制已取消：导出期间切换了模板");
        toast.info("已切换模板，本次复制已取消");
        return;
      }
      const item = new ClipboardItem({ [result.blob.type]: result.blob });
      await navigator.clipboard.write([item]);
      toast.success("已复制到剪贴板");
    } catch (e) {
      logger.error("复制到剪贴板失败", e);
      toast.error(`复制失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className="flex w-full flex-wrap items-center justify-end gap-2"
      aria-busy={loading || busy !== null}
    >
      <Button
        size="default"
        onClick={handleDownload}
        disabled={!ready || busy !== null}
        aria-label={isAnimated ? "下载 GIF" : "下载 PNG"}
        className="font-bold shadow-sm shadow-primary/25"
      >
        {busy === "download" ? <Loader2 className="animate-spin" /> : <Download />}
        {isAnimated ? "下载 GIF" : "下载 PNG"}
      </Button>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <Button
              size="icon-sm"
              variant="outline"
              onClick={handleCopy}
              disabled={!canCopy || busy !== null}
              aria-label={isAnimated ? "GIF 暂不支持复制，请使用下载" : "复制"}
              className="hover:border-media-img hover:text-media-img"
            >
              {busy === "copy" ? <Loader2 className="animate-spin" /> : <Copy />}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {isAnimated ? "浏览器剪贴板暂不支持复制 GIF，请使用下载" : "复制到剪贴板"}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
