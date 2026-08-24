/**
 * 模板编辑器页面（/editor）—— 组合画布、图层列表、属性面板、预览、导出。
 *
 * 左侧：背景帧上传 → Fabric 画布 + 帧条
 * 右侧：图层 / 模板信息 / 属性面板
 */

import { Download, Home, Loader2, PencilRuler, Redo2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useBeforeUnload, useBlocker } from "react-router-dom";
import type { BlockerFunction } from "react-router-dom";
import { toast } from "sonner";

import { AvatarLayerPanel } from "@/components/editor/avatar-layer-panel";
import { EditorCanvas } from "@/components/editor/editor-canvas";
import { FrameStrip } from "@/components/editor/frame-strip";
import { FrameUploader } from "@/components/editor/frame-uploader";
import { LayerList } from "@/components/editor/layer-list";
import { PreviewDialog } from "@/components/editor/preview-dialog";
import { TemplateMetaPanel } from "@/components/editor/template-meta-panel";
import { TextLayerPanel } from "@/components/editor/text-layer-panel";
import { PanelSection } from "@/components/layout/panel-section";
import { TWO_COL_GRID, WorkspaceShell } from "@/components/layout/workspace-shell";
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
import { isEditableTarget, isUndoShortcut, useEditorHistory } from "@/hooks/use-editor-history";
import { downloadBlob } from "@/lib/download";
import { exportTemplateZip, templateFileName } from "@/lib/editor/export-zip";
import { logger } from "@/lib/logger";
import { useEditorStore } from "@/stores/editor-store";

export function TemplateEditorPage() {
  const hasFrames = useEditorStore((s) => s.frames.length > 0);
  const isDirty = useEditorStore((s) => s.isDirty);
  const markSaved = useEditorStore((s) => s.markSaved);
  const resetEditor = useEditorStore((s) => s.reset);
  const selectedKind = useEditorStore(
    (s) => s.layers.find((l) => l.id === s.selectedLayerId)?.kind ?? null,
  );
  const [exporting, setExporting] = useState(false);
  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) =>
      isDirty && currentLocation.pathname !== nextLocation.pathname,
    [isDirty],
  );
  const blocker = useBlocker(shouldBlock);

  useEffect(() => {
    document.title = "模板编辑器 · MemeMaker";
  }, []);

  useBeforeUnload(
    useCallback(
      (event) => {
        if (!isDirty) return;
        event.preventDefault();
        event.returnValue = "";
      },
      [isDirty],
    ),
  );

  const handleExport = async () => {
    setExporting(true);
    try {
      const state = useEditorStore.getState();
      const blob = await exportTemplateZip(state);
      downloadBlob(blob, `${templateFileName(state)}.zip`);
      markSaved();
      logger.info(`已导出 ZIP：${templateFileName(state)}.zip（${state.frames.length} 帧）`);
      toast.success("已导出 ZIP");
    } catch (e) {
      logger.error("导出 ZIP 失败", e);
      toast.error(`导出失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  };

  const { canUndo, canRedo, undo, redo } = useEditorHistory();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = isUndoShortcut(event);
      if (!action || isEditableTarget(event.target)) return;
      event.preventDefault();
      if (action === "undo") undo();
      else redo();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);

  const handleReturnHome = () => {
    if (!isDirty) resetEditor();
  };

  const discardAndLeave = () => {
    resetEditor();
    blocker.proceed?.();
  };

  return (
    <WorkspaceShell
      skipTarget="editor-main-content"
      documentTitle="模板编辑器 · MemeMaker"
      icon={
        <span className="grid size-9 shrink-0 place-items-center rounded-lg border-2 border-line bg-grape text-white shadow-pop-sm sm:size-10 dark:text-[color:var(--banana-foreground)]">
          <PencilRuler className="size-4 sm:size-5" />
        </span>
      }
      brand={
        <div className="min-w-0">
          <h1 className="font-display truncate text-base leading-tight whitespace-nowrap sm:text-lg">
            <span className="sm:hidden">编辑器</span>
            <span className="hidden sm:inline">模板编辑器</span>
          </h1>
          <p className="hidden text-xs font-semibold opacity-75 sm:block">工作台</p>
        </div>
      }
      actions={
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="撤销"
                disabled={!canUndo}
                onClick={() => undo()}
                className="rounded-full hover:bg-white/40 dark:hover:bg-white/10"
              >
                <Undo2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent>撤销（Ctrl+Z）</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="重做"
                disabled={!canRedo}
                onClick={() => redo()}
                className="rounded-full hover:bg-white/40 dark:hover:bg-white/10"
              >
                <Redo2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent>重做（Ctrl+Shift+Z）</TooltipContent>
          </Tooltip>
          <Button
            size="sm"
            onClick={handleExport}
            disabled={!hasFrames || exporting}
            className="rounded-full shadow-pop-sm"
          >
            {exporting ? <Loader2 className="animate-spin" /> : <Download />}
            导出 ZIP
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                asChild
                variant="ghost"
                size="icon-sm"
                className="rounded-full hover:bg-white/40 dark:hover:bg-white/10"
              >
                <Link to="/" aria-label="返回主页" onClick={handleReturnHome}>
                  <Home />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>返回主页</TooltipContent>
          </Tooltip>
        </>
      }
    >
      <div className={TWO_COL_GRID} data-testid="editor-workspace">
        {/* 主列：画布 + 帧时间轴 */}
        <section className="surface-panel min-w-0 p-2.5 sm:p-3.5">
          <div className="mb-2.5 flex items-center justify-end">
            <PreviewDialog disabled={!hasFrames} />
          </div>
          {hasFrames ? (
            <div className="space-y-3">
              <EditorCanvas />
              <FrameStrip />
            </div>
          ) : (
            <FrameUploader />
          )}
        </section>

        {/* 检查器列 */}
        <aside className="flex min-w-0 flex-col gap-3 xl:sticky xl:top-[68px]">
          <PanelSection icon={<span aria-hidden>🗂️</span>} title="图层">
            <LayerList />
          </PanelSection>

          <PanelSection
            icon={<span aria-hidden>🧾</span>}
            title="模板信息"
            collapsible
            defaultOpen={false}
          >
            <TemplateMetaPanel />
          </PanelSection>

          <PanelSection
            icon={<span aria-hidden>🎛️</span>}
            title={
              selectedKind === "avatar" ? "头像属性" : selectedKind === "text" ? "文字属性" : "属性"
            }
            summary={selectedKind ? undefined : "未选中图层"}
          >
            {selectedKind === "avatar" ? (
              <AvatarLayerPanel />
            ) : selectedKind === "text" ? (
              <TextLayerPanel />
            ) : (
              <p className="pb-1 text-xs leading-relaxed text-muted-foreground">
                选中一个图层来编辑其属性，或在画布上双击文字编辑内容。
              </p>
            )}
          </PanelSection>
        </aside>
      </div>

      <Dialog
        open={blocker.state === "blocked"}
        onOpenChange={(open) => {
          if (!open && blocker.state === "blocked") blocker.reset?.();
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>放弃未导出的修改？</DialogTitle>
            <DialogDescription>
              当前背景、图层和模板设置尚未导出为 ZIP。离开后这些修改将无法恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => blocker.reset?.()}>
              继续编辑
            </Button>
            <Button type="button" variant="destructive" onClick={discardAndLeave}>
              放弃修改并离开
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </WorkspaceShell>
  );
}
