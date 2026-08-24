/**
 * 模板库列表 —— 搜索 + 类型筛选 + 缩略图网格。
 * 桌面端嵌在左侧常驻栏里，移动端装进底部抽屉；两个形态共用本组件。
 */

import { CheckCircle2, Film, Image as ImageIcon, Search } from "lucide-react";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type TemplateIndexEntry,
  templateAnimatedThumbnailUrl,
  templateThumbnailUrl,
} from "@/lib/template-loader";
import { cn } from "@/lib/utils";

export interface TemplateLibraryProps {
  selected: string | null;
  onSelect: (entry: TemplateIndexEntry) => void;
  templates: readonly TemplateIndexEntry[];
  loading: boolean;
  error: string | null;
  search: string;
  onSearchChange: (value: string) => void;
  typeFilter: "ALL" | "IMG" | "GIF";
  onTypeFilterChange: (value: "ALL" | "IMG" | "GIF") => void;
  /** 网格列数：侧栏窄容器用两列，抽屉宽容器可用三列 */
  dense?: boolean;
  /** 搜索框固定 id（桌面端顶栏胶囊聚焦定位用） */
  searchInputId?: string;
}

function TemplateThumbnail({
  entry,
  className,
  animated = false,
}: {
  readonly entry: TemplateIndexEntry;
  readonly className: string;
  readonly animated?: boolean;
}) {
  const image = (
    <img src={templateThumbnailUrl(entry)} alt="" className={className} loading="lazy" />
  );

  if (!animated || entry.type !== "GIF" || entry.length !== 0) return image;

  return (
    <picture className="contents">
      <source
        media="(prefers-reduced-motion: no-preference)"
        srcSet={templateAnimatedThumbnailUrl(entry.key, entry.revision)}
        type="image/gif"
      />
      {image}
    </picture>
  );
}

export function TemplateLibrary({
  selected,
  onSelect,
  templates,
  loading,
  error,
  search,
  onSearchChange,
  typeFilter,
  onTypeFilterChange,
  dense = false,
  searchInputId,
}: TemplateLibraryProps) {
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const byType =
      typeFilter === "ALL" ? templates : templates.filter((t) => t.type === typeFilter);
    if (!q) return byType;
    return byType.filter(
      (t) =>
        t.key.toLowerCase().includes(q) ||
        t.alias.some((a) => a.toLowerCase().includes(q)) ||
        t.description.toLowerCase().includes(q),
    );
  }, [templates, search, typeFilter]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id={searchInputId}
            aria-label="搜索模板"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="按名称、别名或描述搜索…"
            className="border-line bg-secondary pl-9 shadow-pop-sm placeholder:text-muted-foreground/70"
          />
        </div>
        <div className="grid grid-cols-3 gap-2" aria-label="按类型筛选">
          {(["ALL", "IMG", "GIF"] as const).map((type) => (
            <Button
              key={type}
              type="button"
              variant={typeFilter === type ? "default" : "outline"}
              size="sm"
              aria-label={
                type === "ALL"
                  ? "显示全部模板"
                  : type === "IMG"
                    ? "仅显示静态图片模板"
                    : "仅显示动态 GIF 模板"
              }
              aria-pressed={typeFilter === type}
              onClick={() => onTypeFilterChange(type)}
              className={cn(
                "rounded-full font-bold",
                typeFilter !== type && "border-line bg-card text-muted-foreground",
              )}
            >
              {type === "GIF" ? <Film /> : type === "IMG" ? <ImageIcon /> : null}
              {type === "ALL" ? "全部" : type}
            </Button>
          ))}
        </div>
      </div>

      <output className="sr-only" aria-live="polite">
        {loading ? "正在加载模板" : `找到 ${filtered.length} 个模板`}
      </output>

      <div className="-mr-1 mt-2 min-h-0 flex-1 overflow-y-auto pr-1 pb-1">
        {loading && <div className="py-8 text-center text-muted-foreground">加载中…</div>}
        {error && <div className="py-8 text-center text-destructive">{error}</div>}
        {!loading && !error && filtered.length === 0 && (
          <div className="py-8 text-center text-muted-foreground">没有匹配的模板 😶</div>
        )}
        <div className={cn("grid gap-2.5", dense ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2")}>
          {filtered.map((entry) => {
            const isSelected = entry.key === selected;
            return (
              <button
                key={entry.key}
                type="button"
                data-testid={`template-card-${entry.key}`}
                aria-label={`使用模板 ${entry.key}`}
                aria-current={isSelected || undefined}
                onClick={() => onSelect(entry)}
                className={cn(
                  "group relative flex flex-col items-center gap-1.5 rounded-lg border-2 bg-card p-2 text-left transition-transform duration-150",
                  isSelected
                    ? "border-primary bg-accent shadow-pop-sm"
                    : "border-line hover:-translate-y-0.5 hover:bg-accent/60",
                )}
              >
                {isSelected && (
                  <span className="absolute top-1.5 right-1.5 z-10 rounded-full bg-mint p-1 text-mint-foreground shadow-pop-sm ">
                    <CheckCircle2 className="size-3.5" strokeWidth={3} />
                  </span>
                )}
                <TemplateThumbnail
                  entry={entry}
                  animated
                  className="aspect-square w-full rounded-md border border-border bg-muted object-contain transition-transform group-hover:scale-[1.02]"
                />
                <span className="w-full truncate text-xs font-extrabold">{entry.key}</span>
                <span className="line-clamp-2 h-7 w-full text-[10px] leading-tight text-muted-foreground">
                  {entry.description}
                </span>
                <span
                  className={cn(
                    "inline-flex items-center rounded-full border px-1.5 py-px text-[9.5px] leading-none font-extrabold",
                    entry.type === "GIF"
                      ? "border-line bg-media-gif/15 text-media-gif "
                      : "border-line bg-media-img/10 text-media-img",
                  )}
                  data-testid={`template-type-${entry.key}`}
                >
                  {entry.type === "GIF" && entry.length === 0
                    ? "GIF · 特效"
                    : entry.length > 0
                      ? `${entry.type} · ${entry.length} 帧`
                      : entry.type}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** 顶栏/工具条里的当前模板胶囊，触发库的展开。 */
export function TemplateChipView({ entry }: { entry: TemplateIndexEntry | null }) {
  return entry ? (
    <>
      <img
        src={templateThumbnailUrl(entry)}
        alt=""
        className="size-6 shrink-0 rounded border border-line bg-muted object-contain"
      />
      <span className="truncate font-extrabold">{entry.key}</span>
      <span
        className={cn(
          "hidden shrink-0 rounded-full px-1.5 py-px text-[9.5px] leading-none font-extrabold sm:inline",
          entry.type === "GIF"
            ? "bg-media-gif/20 text-media-gif "
            : "bg-media-img/15 text-media-img",
        )}
      >
        {entry.type}
      </span>
    </>
  ) : (
    <span className="truncate text-muted-foreground">点击选择一个模板…</span>
  );
}
