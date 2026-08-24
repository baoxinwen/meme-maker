/**
 * 空状态引导 —— 大图形 + 标题 + 说明 + 可选动作。
 */

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function EmptyState({
  emoji,
  icon,
  title,
  hint,
  action,
  className,
  children,
}: {
  /** 表情符号，梗图风的默认选择 */
  emoji?: string;
  /** 或自定义图标 */
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex h-full min-h-[12rem] w-full flex-col items-center justify-center gap-3 px-6 py-10 text-center",
        className,
      )}
    >
      {emoji ? (
        <span aria-hidden className="text-4xl drop-shadow-pop-sm select-none">
          {emoji}
        </span>
      ) : (
        icon
      )}
      <p className="font-display text-sm font-extrabold">{title}</p>
      {hint && <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">{hint}</p>}
      {action && <div className="mt-1">{action}</div>}
      {children}
    </div>
  );
}
