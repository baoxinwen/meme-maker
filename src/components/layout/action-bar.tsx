/**
 * 行动条 —— 舞台下方的导出动作区（下载/复制等）。
 * 桌面端右对齐；移动端吸底时由页面自行加定位类。
 */

import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export function ActionBar({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex w-full flex-wrap items-center justify-end gap-2.5", className)}
      {...props}
    />
  );
}
