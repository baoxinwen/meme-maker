import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * shadcn/ui 标准辅助函数：合并 `className`，并对 Tailwind 类名去重。
 * 用法：<div className={cn("p-2", isActive && "bg-primary", className)} />
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
