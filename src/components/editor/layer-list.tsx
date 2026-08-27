/**
 * 图层列表 —— 增删/选中/上下移图层。
 *
 * 模板格式固定为：底层头像 → 背景 → 顶层头像 → 文字。
 * 列表只允许同一层级内排序，避免工作台顺序无法被 data.json 表达。
 */

import { ArrowDown, ArrowUp, Image as ImageIcon, Trash2, Type } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { canMoveLayer, useEditorStore } from "@/stores/editor-store";

const AVATAR_LABELS: Record<string, string> = {
  FROM: "发起者",
  TO: "目标",
  BOT: "机器人",
  GROUP: "群头像",
  RANDOM: "随机",
  USER: "顺序",
};

export function LayerList() {
  const layers = useEditorStore((s) => s.layers);
  const selectedLayerId = useEditorStore((s) => s.selectedLayerId);
  const hasFrames = useEditorStore((s) => s.frames.length > 0);
  const addAvatar = useEditorStore((s) => s.addAvatar);
  const addText = useEditorStore((s) => s.addText);
  const removeLayer = useEditorStore((s) => s.removeLayer);
  const selectLayer = useEditorStore((s) => s.selectLayer);
  const moveLayer = useEditorStore((s) => s.moveLayer);

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          disabled={!hasFrames}
          onClick={addAvatar}
        >
          <ImageIcon className="size-4" />
          加头像
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          disabled={!hasFrames}
          onClick={addText}
        >
          <Type className="size-4" />
          加文字
        </Button>
      </div>

      {!hasFrames && <p className="text-xs text-muted-foreground">先上传背景图才能添加图层。</p>}

      {layers.length > 0 && <Separator />}

      <div className="flex flex-col gap-1">
        {/* 从顶层到底层显示（数组末尾 = 顶层），便于直觉对应画布上下层 */}
        {[...layers].reverse().map((layer) => {
          const selected = layer.id === selectedLayerId;
          return (
            <div
              key={layer.id}
              className={cn(
                "flex items-center gap-1 rounded-lg border px-2 py-1.5 transition-colors",
                selected ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted/50",
              )}
            >
              <button
                type="button"
                aria-pressed={selected}
                className="flex min-h-9 flex-1 cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-left"
                onClick={() => selectLayer(layer.id)}
                title="选中该图层"
              >
                {layer.kind === "avatar" ? (
                  <ImageIcon className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <Type className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className="flex-1 truncate text-sm">
                  {layer.kind === "avatar"
                    ? `头像 · ${AVATAR_LABELS[layer.type] ?? layer.type}`
                    : `文字 · ${layer.text || "（空）"}`}
                </span>
              </button>
              <Button
                variant="ghost"
                size="icon-sm"
                title="上移"
                aria-label="上移图层"
                onClick={() => moveLayer(layer.id, "up")}
                disabled={!canMoveLayer(layers, layer.id, "up")}
              >
                <ArrowUp className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                title="下移"
                aria-label="下移图层"
                onClick={() => moveLayer(layer.id, "down")}
                disabled={!canMoveLayer(layers, layer.id, "down")}
              >
                <ArrowDown className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                title="删除"
                aria-label="删除图层"
                onClick={() => removeLayer(layer.id)}
              >
                <Trash2 className="size-3.5 text-destructive" />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
