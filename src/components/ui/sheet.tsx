/**
 * 底部抽屉（Sheet）—— 基于现有 radix Dialog 的移动端形态。
 * 从底部滑入、圆角顶边、可拖拽把手视觉提示；桌面端也可用作紧凑弹层。
 */

import { XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";

const Sheet = DialogPrimitive.Root;
const SheetTrigger = DialogPrimitive.Trigger;
const SheetClose = DialogPrimitive.Close;

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-slate-950/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className,
      )}
      {...props}
    />
  );
}

function SheetContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
}) {
  return (
    // 不做退出动画、直接卸载：重开永远从干净挂载开始，避免关闭/重开竞态，
    // 也避免把整份列表常驻在隐藏 DOM 里拖慢首屏。
    <DialogPrimitive.Portal data-slot="sheet-portal">
      <SheetOverlay />
      <DialogPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col gap-4 rounded-t-xl border-t-2 border-line bg-card px-4 pt-3 pb-6 shadow-pop-lg outline-none",
          "duration-300 data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom",
          className,
        )}
        {...props}
      >
        {/* 把手：纯装饰 */}
        <div aria-hidden className="mx-auto h-1.5 w-10 rounded-full bg-input" />
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            aria-label="关闭"
            className="absolute top-3 right-3 grid size-10 place-items-center rounded-md opacity-70 transition-opacity hover:bg-accent hover:opacity-100 focus:ring-2 focus:ring-ring focus:outline-none"
          >
            <XIcon className="size-4" />
            <span className="sr-only">关闭</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1 pr-8", className)}
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-base font-extrabold", className)}
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function SheetBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-body"
      className={cn("-mx-4 min-h-0 flex-1 overflow-y-auto px-4", className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
};
