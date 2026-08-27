/**
 * 文字图层属性面板 —— 编辑选中文字的内容/颜色/字号/字体/样式/对齐/换行/描边。
 *
 * 注：文字在模板里是全局的（非逐帧），所以这里不涉及帧切换。
 */

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import type { TextAlign, TextStyle, TextWrap } from "@/core";
import { useEditorStore } from "@/stores/editor-store";
import { ColorField, FieldRow, SelectField } from "./fields";

const STYLE_OPTIONS: { value: TextStyle; label: string }[] = [
  { value: "PLAIN", label: "PLAIN 常规" },
  { value: "BOLD", label: "BOLD 粗体" },
  { value: "ITALIC", label: "ITALIC 斜体" },
];

const ALIGN_OPTIONS: { value: TextAlign; label: string }[] = [
  { value: "LEFT", label: "LEFT 左对齐" },
  { value: "CENTER", label: "CENTER 居中" },
  { value: "RIGHT", label: "RIGHT 右对齐" },
];

const WRAP_OPTIONS: { value: TextWrap; label: string }[] = [
  { value: "NONE", label: "NONE 不换行" },
  { value: "BREAK", label: "BREAK 折行" },
  { value: "ZOOM", label: "ZOOM 缩放" },
];

export function TextLayerPanel() {
  const layer = useEditorStore((s) =>
    s.layers.find((l) => l.id === s.selectedLayerId && l.kind === "text"),
  );
  const updateText = useEditorStore((s) => s.updateText);

  if (!layer || layer.kind !== "text") {
    return <p className="text-xs text-muted-foreground">选中一个文字图层来编辑属性。</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${layer.id}-content`} className="text-xs">
          内容
        </Label>
        <textarea
          id={`${layer.id}-content`}
          value={layer.text}
          onChange={(e) => updateText(layer.id, { text: e.target.value })}
          rows={2}
          className="w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/45"
        />
      </div>

      <FieldRow>
        <ColorField
          label="颜色"
          value={layer.color}
          onChange={(v) => updateText(layer.id, { color: v })}
        />
        <ColorField
          label="描边色"
          value={layer.strokeColor}
          onChange={(v) => updateText(layer.id, { strokeColor: v })}
        />
      </FieldRow>

      <FieldRow>
        <div className="flex flex-col gap-1.5">
          <Label id={`${layer.id}-size-label`} className="text-xs">
            字号 <span className="text-muted-foreground">{layer.size}px</span>
          </Label>
          <Slider
            aria-labelledby={`${layer.id}-size-label`}
            value={[layer.size]}
            min={8}
            max={256}
            step={1}
            onValueChange={([v]) => updateText(layer.id, { size: v })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label id={`${layer.id}-stroke-size-label`} className="text-xs">
            描边 <span className="text-muted-foreground">{layer.strokeSize}px</span>
          </Label>
          <Slider
            aria-labelledby={`${layer.id}-stroke-size-label`}
            value={[layer.strokeSize]}
            min={0}
            max={16}
            step={1}
            onValueChange={([v]) => updateText(layer.id, { strokeSize: v })}
          />
        </div>
      </FieldRow>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${layer.id}-font`} className="text-xs">
          字体
        </Label>
        <Input
          id={`${layer.id}-font`}
          type="text"
          value={layer.font}
          onChange={(e) => updateText(layer.id, { font: e.target.value })}
          placeholder="如 Arial / Microsoft YaHei"
        />
      </div>

      <FieldRow>
        <SelectField
          label="样式"
          value={layer.style}
          options={STYLE_OPTIONS}
          onChange={(v) => updateText(layer.id, { style: v })}
        />
        <SelectField
          label="对齐"
          value={layer.align}
          options={ALIGN_OPTIONS}
          onChange={(v) => updateText(layer.id, { align: v })}
        />
      </FieldRow>

      <SelectField
        label="换行模式"
        value={layer.wrap}
        options={WRAP_OPTIONS}
        onChange={(v) => updateText(layer.id, { wrap: v })}
      />

      <fieldset className="grid grid-cols-2 gap-3 rounded-md border p-3">
        <legend className="px-1 text-xs font-medium">位置与旋转</legend>
        {(["X", "Y"] as const).map((label, index) => (
          <div key={label} className="flex flex-col gap-1.5">
            <Label htmlFor={`${layer.id}-position-${index}`} className="text-xs">
              {label}
            </Label>
            <Input
              id={`${layer.id}-position-${index}`}
              type="number"
              value={layer.pos[index]}
              onChange={(event) => {
                const next = [...layer.pos] as [number, number] | [number, number, number];
                next[index] = Number(event.target.value) || 0;
                updateText(layer.id, { pos: next });
              }}
            />
          </div>
        ))}
        {layer.wrap !== "NONE" && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${layer.id}-max-width`} className="text-xs">
              最大宽度
            </Label>
            <Input
              id={`${layer.id}-max-width`}
              type="number"
              min={1}
              value={layer.pos[2] ?? 100}
              onChange={(event) =>
                updateText(layer.id, {
                  pos: [layer.pos[0], layer.pos[1], Math.max(1, Number(event.target.value) || 1)],
                })
              }
            />
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${layer.id}-angle`} className="text-xs">
            角度
          </Label>
          <Input
            id={`${layer.id}-angle`}
            type="number"
            value={layer.angle}
            onChange={(event) => updateText(layer.id, { angle: Number(event.target.value) || 0 })}
          />
        </div>
      </fieldset>
      <p className="text-xs text-muted-foreground">
        换行非 NONE 时，在画布上拖拽文字右边框可调整最大宽度。
      </p>
    </div>
  );
}
