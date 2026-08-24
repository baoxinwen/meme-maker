/**
 * 工作台外壳 —— 两个页面共用的彩色页头 + 主区容器 + 页脚。
 * 主区内部的三栏排布由页面自行组合：侧栏 / 舞台 / 检查器。
 */

import { ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect } from "react";

import { ThemeToggle } from "@/components/ui/theme-toggle";
import { cn } from "@/lib/utils";

export function StandardFooter() {
  return (
    <footer className="mx-auto mt-auto flex w-full max-w-[1500px] flex-col gap-1 border-t border-border px-4 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <p className="inline-flex items-center gap-1.5">
        <ShieldCheck className="size-3.5" aria-hidden />
        所有图像处理都在你的浏览器里完成，不上传任何数据
      </p>
      <p className="opacity-60">© 2026 MemeMaker</p>
    </footer>
  );
}

export function WorkspaceShell({
  /** 页头左侧的品牌区（含唯一的 h1） */
  brand,
  /** 品牌区前的方形图标位（编辑器页使用） */
  icon,
  /** 页头右侧动作区；主题切换按钮会自动追加在最后 */
  actions,
  /** 主内容锚点 id，配合“跳到主要内容”链接 */
  skipTarget,
  /** 页面标题，用于 document.title */
  documentTitle,
  mainClassName,
  children,
  footer = <StandardFooter />,
}: {
  brand: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  skipTarget?: string;
  documentTitle?: string;
  mainClassName?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (documentTitle) document.title = documentTitle;
  }, [documentTitle]);

  return (
    <div className="app-shell flex min-h-dvh flex-col text-foreground">
      {skipTarget && (
        <a
          href={`#${skipTarget}`}
          className="fixed top-3 left-3 z-100 -translate-y-20 rounded-md border-2 border-line bg-card px-4 py-2 font-semibold shadow-pop-sm transition-transform focus:translate-y-0"
        >
          跳到主要内容
        </a>
      )}
      <header className="fun-topbar sticky top-0 z-30">
        <div
          className={
            "mx-auto flex w-full max-w-[1500px] items-center gap-3 px-3 py-2 sm:px-4 sm:py-2.5"
          }
        >
          {icon}
          <div className="min-w-0 flex-1">{brand}</div>
          <div className="flex shrink-0 items-center gap-1.5">
            {actions}
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main
        id={skipTarget}
        tabIndex={-1}
        className={cn(
          "mx-auto w-full max-w-[1500px] flex-1 px-3 py-3 sm:px-4 sm:py-4",
          mainClassName,
        )}
      >
        {children}
      </main>
      {footer}
    </div>
  );
}

/** 工作台三栏的标准列宽：侧栏 / 自适应舞台 / 检查器。xl 以下由页面自行退化为单列。 */
export const WORKSPACE_GRID =
  "grid min-w-0 grid-cols-1 items-start gap-3 sm:gap-4 xl:grid-cols-[264px_minmax(0,1fr)_304px] xl:gap-4";

/** 检查器单独成栏时的栅格（编辑器页 / 两栏变体共用） */
export const TWO_COL_GRID =
  "grid min-w-0 grid-cols-1 items-start gap-3 sm:gap-4 xl:grid-cols-[minmax(0,1fr)_320px] xl:gap-5";
