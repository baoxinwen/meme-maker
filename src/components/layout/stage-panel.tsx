/**
 * 舞台面板 —— 棋盘格底的中央展示区，内容自适应居中。
 * 主应用预览与编辑器画布共用；棋盘格颜色随主题切换。
 */

import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export function StagePanel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "canvas-stage relative flex min-h-[12rem] w-full items-center justify-center overflow-hidden p-2 sm:min-h-[14rem]",
        className,
      )}
      {...props}
    />
  );
}

/** 舞台顶部信息条：标题 + 尺寸/帧数等元信息徽章。 */
export function StageMetaBar({
  title,
  meta,
  actions,
  className,
}: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center justify-between gap-2", className)}>
      <div className="flex min-w-0 items-baseline gap-2">
        <h2 className="font-display shrink-0 text-base font-extrabold">{title}</h2>
        {meta && (
          <span className="status-pill font-mono truncate" data-tone="info">
            {meta}
          </span>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
