/**
 * 预览对话框 —— 用占位头像把当前编辑的模板跑一遍真实引擎（prepareScene），
 * 复用 MemeCanvas 播放，便于在导出前确认效果。
 */

import { Play } from "lucide-react";
import { useEffect, useState } from "react";

import { MemeCanvas } from "@/components/meme-canvas";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  type AvatarInputs,
  type AvatarTemplate,
  type AvatarType,
  type PreparedScene,
  parseTemplate,
  prepareScene,
} from "@/core";
import { compileTemplate } from "@/lib/editor/compile";
import { getPlaceholderAvatarBlob } from "@/lib/editor/placeholder";
import { logger } from "@/lib/logger";
import { type SceneError, toSceneError } from "@/lib/scene-error";
import { useEditorStore } from "@/stores/editor-store";

function buildInputs(avatars: readonly AvatarTemplate[], blob: Blob): AvatarInputs {
  // AvatarInputs 字段只读，这里先用可变映射构造，再转换为目标类型。
  const o: Record<string, Blob | Blob[]> = {};
  const types = Array.from(new Set(avatars.map((avatar) => avatar.type))) as AvatarType[];
  for (const t of types) {
    o[t.toLowerCase()] = t === "RANDOM" || t === "USER" ? [blob] : blob;
  }
  const requiredUserInputs = avatars
    .filter((avatar) => avatar.type === "USER")
    .reduce((count, avatar) => Math.max(count, (avatar.input ?? 0) + 1), 0);
  if (requiredUserInputs > 0) {
    o.user = Array.from({ length: requiredUserInputs }, () => blob);
  }
  return o as unknown as AvatarInputs;
}

interface PreviewDialogProps {
  disabled: boolean;
}

export function PreviewDialog({ disabled }: PreviewDialogProps) {
  const [open, setOpen] = useState(false);
  const [scene, setScene] = useState<PreparedScene | null>(null);
  const [error, setError] = useState<SceneError | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || disabled) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setScene(null);

    (async () => {
      try {
        const state = useEditorStore.getState();
        if (state.frames.length === 0) throw new Error("请先上传背景图");
        const template = compileTemplate(state);
        // 走一遍 parseTemplate 校验 + 规范化（与导出/主应用一致）
        const parsed = parseTemplate(template);
        const blob = await getPlaceholderAvatarBlob();
        const inputs = buildInputs(parsed.avatar, blob);
        const sc = await prepareScene(parsed, {
          inputs,
          backgroundImages: state.frames,
        });
        if (cancelled) return;
        setScene(sc);
      } catch (e) {
        if (!cancelled) {
          logger.error("编辑器预览渲染失败", e);
          setError(toSceneError(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [disabled, open]);

  const trigger = (
    <Button
      variant="outline"
      size="sm"
      data-testid="editor-preview-button"
      aria-label="预览导出效果"
      disabled={disabled}
      className="rounded-full border-line bg-card font-extrabold shadow-pop-sm hover:border-primary/60 hover:text-primary"
    >
      <Play />
      预览
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {disabled ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">{trigger}</span>
          </TooltipTrigger>
          <TooltipContent>请先上传背景图后预览</TooltipContent>
        </Tooltip>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <DialogTrigger asChild>{trigger}</DialogTrigger>
          </TooltipTrigger>
          <TooltipContent>预览导出效果</TooltipContent>
        </Tooltip>
      )}
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>实时预览（占位头像）</DialogTitle>
          <DialogDescription>使用占位头像渲染当前模板。</DialogDescription>
        </DialogHeader>
        <MemeCanvas scene={scene} loading={loading} error={error} />
      </DialogContent>
    </Dialog>
  );
}
