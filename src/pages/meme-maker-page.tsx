/**
 * 主页面 —— 表情包制作工作台。
 *
 * ≥xl 三栏：模板库（常驻）｜预览舞台｜检查器。
 * <xl 舞台优先：舞台置顶并吸边，检查器分区随后纵向排布；
 * 模板库收进底部抽屉，顶栏胶囊始终提供“选择模板”入口。
 */

import { ChevronDown, PencilRuler } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { AvatarUploader, getAvatarSlots } from "@/components/avatar-uploader";
import { ActionBar } from "@/components/layout/action-bar";
import { PanelSection } from "@/components/layout/panel-section";
import { StageMetaBar } from "@/components/layout/stage-panel";
import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { MemeCanvas } from "@/components/meme-canvas";
import { OptionEditor } from "@/components/option-editor";
import { TemplateChipView, TemplateLibrary } from "@/components/template-library";
import { TextEditor } from "@/components/text-editor";
import { Toolbar } from "@/components/toolbar";
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
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { AvatarTemplate } from "@/core";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useScene } from "@/hooks/use-scene";
import { logger } from "@/lib/logger";
import { type TemplateIndexEntry, fetchTemplateIndex } from "@/lib/template-loader";
import { cn } from "@/lib/utils";
import { type AvatarState, useMemeStore } from "@/stores/meme-store";

const LIBRARY_MEDIA_QUERY = "(min-width: 1280px)";

export function MemeMakerPage() {
  const {
    selectedTemplate,
    avatars,
    textOverrides,
    optionValues,
    setSelectedTemplate,
    setAvatar,
    setTextOverride,
    setOptionValue,
  } = useMemeStore();

  const [templates, setTemplates] = useState<TemplateIndexEntry[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [pendingTemplate, setPendingTemplate] = useState<TemplateIndexEntry | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"ALL" | "IMG" | "GIF">("ALL");

  useEffect(() => {
    let cancelled = false;
    fetchTemplateIndex()
      .then((idx) => {
        if (cancelled) return;
        setTemplates([...idx.templates]);
        setTemplatesError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        logger.error("模板索引加载失败", error);
        setTemplatesError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setTemplatesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const entry = templates.find((t) => t.key === selectedTemplate) ?? null;
  const { loading, error, template, scene } = useScene(entry, avatars, textOverrides, optionValues);
  const avatarReady = template?.avatar.every((avatar) => isAvatarReady(avatar, avatars)) ?? false;
  const readyAvatarCount = template
    ? template.avatar.filter((avatar) => isAvatarReady(avatar, avatars)).length
    : 0;
  const textTouched = Object.keys(textOverrides).length > 0;
  const optionTouched = Object.keys(optionValues).length > 0;
  const editedOptionCount = Object.keys(optionValues).length;

  const hasAvatarInput = Object.values(avatars).some((value) =>
    Array.isArray(value) ? value.length > 0 : Boolean(value?.blob),
  );
  const hasInputToDiscard =
    selectedTemplate !== null && (hasAvatarInput || textTouched || optionTouched);

  const requestTemplateChange = (next: TemplateIndexEntry) => {
    if (next.key === selectedTemplate) return;
    if (hasInputToDiscard) {
      setPendingTemplate(next);
      setLibraryOpen(false);
      return;
    }
    setSelectedTemplate(next.key);
    setLibraryOpen(false);
  };

  /** 顶栏胶囊：桌面端聚焦侧栏搜索框；窄屏打开抽屉。 */
  const isWide = useMediaQuery(LIBRARY_MEDIA_QUERY);
  const openLibrary = () => {
    if (isWide) {
      document.getElementById("template-library-search")?.focus();
      return;
    }
    setLibraryOpen(true);
  };

  const sceneMeta = scene ? `${scene.width}×${scene.height}` : undefined;
  const frameSummary = scene && scene.frameCount > 1 ? ` · ${scene.frameCount} 帧` : "";
  const avatarSlotCount = template ? getAvatarSlots(template).length : 0;

  const renderLibrary = (opts?: { onClose?: () => void; dense?: boolean }) => (
    <TemplateLibrary
      selected={selectedTemplate}
      onSelect={(target) => {
        requestTemplateChange(target);
        opts?.onClose?.();
      }}
      templates={templates}
      loading={templatesLoading}
      error={templatesError}
      search={search}
      onSearchChange={setSearch}
      typeFilter={typeFilter}
      onTypeFilterChange={setTypeFilter}
      dense={opts?.dense ?? false}
      searchInputId={opts?.dense ? undefined : "template-library-search"}
    />
  );

  return (
    <WorkspaceShell
      skipTarget="main-content"
      documentTitle="MemeMaker · 表情包工坊"
      brand={<h1 className="font-display truncate text-xl leading-none">MemeMaker</h1>}
      actions={
        <>
          <Button
            variant="outline"
            size="sm"
            aria-label="选择模板"
            onClick={openLibrary}
            className="max-w-[15rem] rounded-full border-line bg-card font-extrabold shadow-pop-sm sm:min-w-44"
          >
            <TemplateChipView entry={entry} />
            <ChevronDown aria-hidden className="size-4 shrink-0 opacity-60" />
          </Button>
          <Button
            asChild
            variant="outline"
            size="sm"
            className="hidden rounded-full border-line bg-card text-muted-foreground shadow-pop-sm hover:text-primary md:inline-flex"
          >
            <Link to="/editor">
              <PencilRuler />
              模板编辑器
            </Link>
          </Button>
        </>
      }
    >
      <div className="grid min-w-0 grid-cols-1 items-start gap-3 sm:gap-4 xl:grid-cols-[264px_minmax(0,1fr)_308px]">
        {/* ===== 左栏：模板库（仅桌面端挂载；窄屏由抽屉接管，避免重复节点） ===== */}
        {isWide && (
          <aside
            aria-label="模板库"
            className="surface-panel sticky top-[68px] flex max-h-[calc(100dvh-6rem)] min-h-0 flex-col self-start overflow-hidden"
          >
            <div className="fun-divider flex items-center justify-between px-3 py-2">
              <span className="text-sm font-extrabold">📚 模板库</span>
              {!templatesLoading && (
                <span className="status-pill" data-tone="amber">
                  {templates.length}
                </span>
              )}
            </div>
            <div className="flex min-h-0 flex-1 flex-col p-3">{renderLibrary()}</div>
          </aside>
        )}

        {/* ===== 中栏：预览舞台（移动端吸边常驻） ===== */}
        <section className="order-1 min-w-0 max-xl:sticky max-xl:top-[62px] max-xl:z-20 xl:order-none">
          <div className="surface-panel overflow-hidden p-3 sm:p-4">
            <StageMetaBar
              title="预览"
              meta={
                entry
                  ? `${entry.key}${sceneMeta ? ` · ${sceneMeta}` : ""}${frameSummary}`
                  : undefined
              }
              actions={
                scene &&
                entry && (
                  <span
                    className={cn(
                      "rounded-full border-2 border-line px-2 py-0.5 text-[10px] leading-none font-extrabold",
                      scene.frameCount > 1
                        ? "bg-media-gif text-media-gif-foreground"
                        : "bg-media-img text-media-img-foreground",
                    )}
                  >
                    {scene.frameCount > 1 ? "GIF" : "IMG"}
                  </span>
                )
              }
              className="mb-3"
            />
            <MemeCanvas scene={scene} loading={loading} error={error} />
            {selectedTemplate !== null && (
              <>
                <div className="fun-divider my-3 border-b-0 sm:my-4" />
                <ActionBar>
                  <Toolbar scene={scene} templateKey={selectedTemplate} loading={loading} />
                </ActionBar>
              </>
            )}
          </div>
        </section>

        {/* ===== 右栏：检查器（移动端跟在舞台后面） ===== */}
        <aside className="order-2 flex min-w-0 flex-col gap-3 xl:order-none xl:sticky xl:top-[68px]">
          {template && template.avatar.length > 0 && (
            <PanelSection
              step={2}
              title="😀 上传头像"
              tone={avatarReady ? "done" : "active"}
              summary={
                avatarReady
                  ? `${readyAvatarCount}/${template.avatar.length} 已就绪`
                  : avatarSlotCount > 1
                    ? `${readyAvatarCount}/${avatarSlotCount} 已就绪`
                    : "等待上传"
              }
            >
              <AvatarUploader template={template} avatars={avatars} onChange={setAvatar} />
            </PanelSection>
          )}

          {template && template.options.length > 0 && (
            <PanelSection
              step={2 + Number(template.avatar.length > 0)}
              title="🎛️ 模板设置"
              tone={optionTouched ? "done" : "active"}
              summary={optionTouched ? `${editedOptionCount} 项已调整` : "可选项"}
              collapsible
            >
              <OptionEditor template={template} values={optionValues} onChange={setOptionValue} />
            </PanelSection>
          )}

          {template && template.text.length > 0 && (
            <PanelSection
              step={2 + Number(template.avatar.length > 0) + Number(template.options.length > 0)}
              title="✏️ 编辑文字"
              tone={textTouched ? "done" : "active"}
              summary={textTouched ? "已自定义" : undefined}
            >
              <TextEditor
                template={template}
                overrides={textOverrides}
                optionValues={optionValues}
                onChange={setTextOverride}
              />
            </PanelSection>
          )}

          {!template && !templatesLoading && (
            <PanelSection step={1} title="🎨 开始创作">
              <p className="pb-1 text-xs leading-relaxed text-muted-foreground">
                从左侧模板库挑一个喜欢的效果；上传头像、改文字，预览会实时更新。🎉
              </p>
            </PanelSection>
          )}
        </aside>
      </div>

      {/* 移动端模板库抽屉 */}
      <Sheet open={libraryOpen} onOpenChange={setLibraryOpen}>
        <SheetContent className="h-[86dvh]">
          <SheetHeader>
            <SheetTitle>选择模板</SheetTitle>
            <SheetDescription>共 {templates.length} 个模板可用</SheetDescription>
          </SheetHeader>
          <SheetBody>
            {renderLibrary({ onClose: () => setLibraryOpen(false), dense: true })}
          </SheetBody>
        </SheetContent>
      </Sheet>

      <Dialog
        open={pendingTemplate !== null}
        onOpenChange={(open) => !open && setPendingTemplate(null)}
      >
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>🔄 切换模板？</DialogTitle>
            <DialogDescription>
              切换到 {pendingTemplate?.key ?? "新模板"}{" "}
              会清除当前已上传的头像、模板设置和文字修改，无法恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingTemplate(null)}>
              继续编辑
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (pendingTemplate) setSelectedTemplate(pendingTemplate.key);
                setPendingTemplate(null);
              }}
            >
              清空并切换
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </WorkspaceShell>
  );
}

function isAvatarReady(avatar: AvatarTemplate, avatars: AvatarState): boolean {
  if (avatar.optional) return true;
  if (avatar.type === "RANDOM") return (avatars.RANDOM?.length ?? 0) > 0;
  if (avatar.type === "USER") {
    const inputs = avatars.USER ?? [];
    if (avatar.visibleWhenInput !== undefined && !inputs[avatar.visibleWhenInput]) {
      return false;
    }
    return !!inputs[avatar.input ?? 0] || !!inputs[avatar.fallbackInput ?? -1];
  }
  return Boolean(avatars[avatar.type]?.blob);
}
