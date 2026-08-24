/**
 * 共享表单套件 —— 主应用检查器与编辑器属性面板共用的字段原语。
 * 统一间距（gap-1.5 + text-xs Label）与控件密度，保证两个页面观感一致。
 */

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { type ReactNode, useId } from "react";

/** 颜色输入框只接受 #rrggbb；这里把其他形式规范化。 */
export function normalizeColorForInput(color: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color;
  if (/^#[0-9a-fA-F]{8}$/.test(color)) return color.slice(0, 7);
  if (/^#[0-9a-fA-F]{3}$/.test(color)) {
    const [, r, g, b] = color;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return "#000000";
}

export function ColorField({
  label,
  value,
  onChange,
  /** 覆盖取色器的可访问名（旧用例按“文字 N 颜色”定位） */
  pickerAriaLabel,
  /** 文本框的固定 id（旧用例依赖 template-text-{i}-color-value 形式的锚点） */
  valueId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  pickerAriaLabel?: string;
  valueId?: string;
}) {
  const autoId = useId();
  const valueInputId = valueId ?? `${autoId}-value`;

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={valueInputId} className="text-xs">
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <input
          id={`${valueInputId}-picker`}
          type="color"
          aria-label={pickerAriaLabel ?? `${label}取色器`}
          value={normalizeColorForInput(value)}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-12 shrink-0 cursor-pointer rounded-md border-2 border-line bg-card shadow-pop-sm"
        />
        <Input
          id={valueInputId}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="min-w-0 font-mono text-xs"
        />
      </div>
    </div>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const id = useId();

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Select value={value} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function CheckField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex min-h-9 cursor-pointer select-none items-center gap-2 rounded-md border border-transparent px-2 text-sm hover:border-primary/20 hover:bg-accent/60">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 rounded border-input accent-primary"
      />
      {label}
    </label>
  );
}

/** 滑杆 + 数字输入联动字段。aria 契约：滑杆与数字输入共用同一个可访问名。 */
export function SliderField({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  onValueChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** 显示在数值后的单位，如 “px” */
  suffix?: string;
  onValueChange: (v: number) => void;
}) {
  const numberId = useId();
  const displayName = `${label} ${value}${suffix ?? ""}`;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={numberId} className="text-xs">
          {label}
        </Label>
        <span aria-hidden className="font-mono text-xs text-muted-foreground">
          {value}
          {suffix}
        </span>
      </div>
      <div className="flex items-center gap-2.5">
        <Slider
          aria-label={displayName}
          value={[value]}
          min={min}
          max={max}
          step={step}
          onValueChange={([v]) => onValueChange(v)}
        />
        <Input
          id={numberId}
          type="number"
          aria-label={displayName}
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const next = Number(e.target.value);
            if (!Number.isNaN(next)) onValueChange(next);
          }}
          className="w-[4.25rem] shrink-0 text-right font-mono text-xs"
        />
      </div>
    </div>
  );
}

export function FieldRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}
