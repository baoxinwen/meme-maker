// 修改自 shadcn 默认的 sonner.tsx —— 去掉了 next-themes 依赖（我们不是 Next.js 项目）
// 主题固定为浅色：跟随系统会使通知在深色操作系统中变暗，与应用界面不一致。
import type { CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = (props: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      position="bottom-right"
      richColors
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
