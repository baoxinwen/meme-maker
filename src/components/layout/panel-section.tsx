/**
 * 检查器分区卡片 —— 梗图风的步骤/属性分区，两页共用。
 *
 * tone:
 *   active  当前进行中（蜜橘底 + 虚线描边）
 *   done    已完成（薄荷对勾徽章）
 *   idle    未激活的普通分区
 */

import { Check, ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type PanelSectionTone = "active" | "done" | "idle";

export function PanelSection({
  step,
  icon,
  title,
  summary,
  tone = "idle",
  collapsible = false,
  defaultOpen = true,
  children,
  className,
  actions,
}: {
  /** 步骤徽章数字；tone 为 done 时自动替换为对勾 */
  step?: number;
  icon?: ReactNode;
  title: ReactNode;
  /** 折叠态或右侧展示的状态摘要，如 “FROM · TO 已就绪” */
  summary?: ReactNode;
  tone?: PanelSectionTone;
  collapsible?: boolean;
  defaultOpen?: boolean;
  children?: ReactNode;
  className?: string;
  /** 标题行右侧的动作插槽（显示时隐藏摘要） */
  actions?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();
  const collapsed = collapsible && !open;
  const showSummary = collapsed && summary !== undefined;

  return (
    <section
      className={cn(
        "rounded-lg border-2 border-line bg-card shadow-pop-sm",
        tone === "active" && "border-dashed border-primary/60 bg-accent shadow-none",
        className,
      )}
    >
      <button
        type="button"
        disabled={!collapsible}
        aria-expanded={collapsible ? open : undefined}
        aria-controls={collapsible ? contentId : undefined}
        onClick={() => collapsible && setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center gap-2.5 px-3 pt-2.5 text-left",
          collapsible && "cursor-pointer",
          !children && "pb-2.5",
          open && children && "pb-1",
        )}
      >
        {step !== undefined ? (
          tone === "done" ? (
            <span
              aria-hidden
              className="grid size-[26px] shrink-0 place-items-center rounded-md border-2 border-line bg-mint text-mint-foreground"
            >
              <Check className="size-4" strokeWidth={3.5} />
            </span>
          ) : (
            <span className="step-badge size-[26px] shrink-0">{step}</span>
          )
        ) : icon !== undefined ? (
          <span aria-hidden className="grid size-[26px] shrink-0 place-items-center">
            {icon}
          </span>
        ) : null}
        <h2 className="min-w-0 flex-1 truncate text-[0.95rem] leading-tight font-extrabold">
          {title}
        </h2>
        {!showSummary && summary !== undefined && !actions && (
          <span className="hidden shrink-0 truncate text-xs font-semibold text-muted-foreground sm:block">
            {summary}
          </span>
        )}
        {actions}
        {showSummary && (
          <span className="shrink-0 truncate text-xs font-semibold text-muted-foreground">
            {summary}
          </span>
        )}
        {collapsible && (
          <ChevronDown
            aria-hidden
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        )}
      </button>
      {children !== undefined && (!collapsible || open) && (
        <div id={contentId} className="px-3 pt-1 pb-3">
          {children}
        </div>
      )}
    </section>
  );
}
