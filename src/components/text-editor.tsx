/**
 * 文字编辑器 —— 列出模板里所有可编辑 text 项：内容/颜色/字号，支持隐藏。
 */

import { Eye, EyeOff, Info } from "lucide-react";

import { ColorField, SliderField } from "@/components/form/fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type PetpetTemplate, resolveTemplateText } from "@/core";
import { cn } from "@/lib/utils";
import type { TemplateOptionState, TextOverride } from "@/stores/meme-store";

interface TextEditorProps {
  template: PetpetTemplate | null;
  overrides: Record<number, TextOverride>;
  optionValues: TemplateOptionState;
  onChange: (index: number, override: TextOverride) => void;
}

export function TextEditor({ template, overrides, optionValues, onChange }: TextEditorProps) {
  const editableTexts =
    template?.text
      .map((text, index) => ({ text, index }))
      .filter(({ text }) => !text.text.includes("$option[")) ?? [];

  if (!template || editableTexts.length === 0) {
    return (
      <div className="flex items-start gap-2 py-1 text-sm text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0 text-media-img" />
        <span>此模板没有可编辑的文字。</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {editableTexts.map(({ text: t, index: i }) => {
        const ov = overrides[i] ?? {};
        const currentText = ov.text ?? resolveTemplateText(t.text, optionValues);
        const currentColor = ov.color ?? t.color ?? "#000000";
        const currentSize = ov.size ?? (typeof t.size === "number" ? t.size : 16);
        const isHidden = ov.hidden ?? false;

        return (
          <div
            key={i}
            className={cn(
              "rounded-md border-2 border-line bg-secondary p-3 shadow-pop-sm",
              isHidden && "opacity-60",
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-extrabold">✏️ 文字 #{i + 1}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={isHidden ? "显示文字" : "隐藏文字"}
                onClick={() => onChange(i, { hidden: !isHidden })}
                title={isHidden ? "显示" : "隐藏"}
                className="text-muted-foreground"
              >
                {isHidden ? <EyeOff /> : <Eye />}
              </Button>
            </div>

            {!isHidden && (
              <>
                <div className="mt-2 flex flex-col gap-1.5">
                  <Label htmlFor={`template-text-${i}-content`} className="text-xs">
                    内容
                  </Label>
                  <Input
                    id={`template-text-${i}-content`}
                    type="text"
                    value={currentText}
                    aria-label={`文字 ${i + 1} 内容`}
                    onChange={(e) => onChange(i, { text: e.target.value })}
                    placeholder="输入文字…"
                  />
                </div>

                {/* 检查器栏宽约 280px，横排会挤压色值输入，纵向堆叠最稳 */}
                <div className="mt-3 flex flex-col gap-2.5">
                  <ColorField
                    label="颜色"
                    value={currentColor}
                    pickerAriaLabel={`文字 ${i + 1} 颜色`}
                    valueId={`template-text-${i}-color-value`}
                    onChange={(v) => onChange(i, { color: v })}
                  />
                  <SliderField
                    label="字号"
                    suffix="px"
                    value={currentSize}
                    min={8}
                    max={256}
                    step={1}
                    onValueChange={(v) => onChange(i, { size: v })}
                  />
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
