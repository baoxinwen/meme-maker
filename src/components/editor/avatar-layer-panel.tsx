/**
 * 头像图层属性面板 —— 编辑选中头像的 type/fit/style/round/opacity 等。
 */

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import type { AvatarFit, AvatarStyle, AvatarType } from "@/core";
import { useEditorStore } from "@/stores/editor-store";
import { CheckField, FieldRow, SelectField } from "./fields";

const TYPE_OPTIONS: { value: AvatarType; label: string }[] = [
  { value: "FROM", label: "FROM 发起者" },
  { value: "TO", label: "TO 目标" },
  { value: "BOT", label: "BOT 机器人" },
  { value: "GROUP", label: "GROUP 群头像" },
  { value: "RANDOM", label: "RANDOM 随机" },
];

const FIT_OPTIONS: { value: AvatarFit; label: string }[] = [
  { value: "FILL", label: "FILL 拉伸填充" },
  { value: "CONTAIN", label: "CONTAIN 包含" },
  { value: "COVER", label: "COVER 覆盖" },
];

const ALL_STYLES: AvatarStyle[] = ["FLIP", "MIRROR", "GRAY", "BINARIZATION", "INVERT"];

export function AvatarLayerPanel() {
  const layer = useEditorStore((s) =>
    s.layers.find((l) => l.id === s.selectedLayerId && l.kind === "avatar"),
  );
  const updateAvatar = useEditorStore((s) => s.updateAvatar);
  const frameIndex = useEditorStore((s) => s.frameIndex);
  const updateFramePos = useEditorStore((s) => s.updateFramePos);

  if (!layer || layer.kind !== "avatar") {
    return <p className="text-xs text-muted-foreground">选中一个头像图层来编辑属性。</p>;
  }

  const toggleStyle = (style: AvatarStyle, on: boolean) => {
    const next = on ? [...layer.style, style] : layer.style.filter((s) => s !== style);
    updateAvatar(layer.id, { style: next });
  };
  const position = layer.perFramePos[frameIndex] ?? [0, 0, 100, 100];
  const updatePosition = (index: number, value: number) => {
    const next = [...position] as [number, number, number, number];
    next[index] = Number.isFinite(value) ? value : 0;
    updateFramePos(layer.id, frameIndex, next);
  };

  return (
    <div className="flex flex-col gap-3">
      <SelectField
        label="头像类型"
        value={layer.type}
        options={TYPE_OPTIONS}
        onChange={(v) => updateAvatar(layer.id, { type: v })}
      />

      <SelectField
        label="适配方式"
        value={layer.fit}
        options={FIT_OPTIONS}
        onChange={(v) => updateAvatar(layer.id, { fit: v })}
      />

      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium">样式（可叠加）</p>
        <div className="grid grid-cols-2 gap-2">
          {ALL_STYLES.map((st) => (
            <CheckField
              key={st}
              label={st}
              checked={layer.style.includes(st)}
              onChange={(on) => toggleStyle(st, on)}
            />
          ))}
        </div>
      </div>

      <FieldRow>
        <CheckField
          label="圆形裁剪"
          checked={layer.round}
          onChange={(v) => updateAvatar(layer.id, { round: v })}
        />
        <CheckField
          label="置顶"
          checked={layer.avatarOnTop}
          onChange={(v) => updateAvatar(layer.id, { avatarOnTop: v })}
        />
        <CheckField
          label="旋转动画"
          checked={layer.rotate}
          onChange={(v) => updateAvatar(layer.id, { rotate: v })}
        />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${layer.id}-angle`} className="text-xs">
            角度 <span className="text-muted-foreground">{layer.angle}°</span>
          </Label>
          <Input
            id={`${layer.id}-angle`}
            type="number"
            value={layer.angle}
            onChange={(e) => updateAvatar(layer.id, { angle: Number(e.target.value) || 0 })}
          />
        </div>
      </FieldRow>

      <fieldset className="grid grid-cols-2 gap-3 rounded-md border p-3">
        <legend className="px-1 text-xs font-medium">当前帧位置与尺寸</legend>
        {(["X", "Y", "宽度", "高度"] as const).map((label, index) => (
          <div key={label} className="flex flex-col gap-1.5">
            <Label htmlFor={`${layer.id}-position-${index}`} className="text-xs">
              {label}
            </Label>
            <Input
              id={`${layer.id}-position-${index}`}
              type="number"
              min={index > 1 ? 1 : undefined}
              value={position[index]}
              onChange={(event) =>
                updatePosition(
                  index,
                  index > 1
                    ? Math.max(1, Number(event.target.value) || 1)
                    : Number(event.target.value),
                )
              }
            />
          </div>
        ))}
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <Label id={`${layer.id}-opacity-label`} className="text-xs">
          不透明度 <span className="text-muted-foreground">{Math.round(layer.opacity * 100)}%</span>
        </Label>
        <Slider
          aria-labelledby={`${layer.id}-opacity-label`}
          value={[layer.opacity]}
          min={0}
          max={1}
          step={0.01}
          onValueChange={([v]) => updateAvatar(layer.id, { opacity: v })}
        />
      </div>
    </div>
  );
}
