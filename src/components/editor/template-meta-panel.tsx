/**
 * 模板元信息面板：编辑模板键名、帧率、别名、倒放和随机列表标记。
 *
 * `key` 用作导出 ZIP 的文件夹名与文件名（会经过安全字符处理）。
 */

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useEditorStore } from "@/stores/editor-store";
import { CheckField } from "./fields";

export function TemplateMetaPanel() {
  const meta = useEditorStore((s) => s.meta);
  const setMeta = useEditorStore((s) => s.setMeta);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="template-key" className="text-xs">
          模板 key（导出文件夹名）
        </Label>
        <Input
          id="template-key"
          type="text"
          value={meta.key}
          onChange={(e) => setMeta({ key: e.target.value })}
          placeholder="my-template"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="template-fps" className="text-xs">
          帧率 <span className="text-muted-foreground">{meta.fps} fps</span>
        </Label>
        <Input
          id="template-fps"
          type="number"
          min={1}
          max={60}
          value={meta.fps}
          onChange={(e) => setMeta({ fps: Math.max(1, Number(e.target.value) || 1) })}
        />
        <p className="text-xs text-muted-foreground">仅 GIF 模板生效；delay = 1000/fps。</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="template-alias" className="text-xs">
          别名（空格分隔，用于搜索）
        </Label>
        <Input
          id="template-alias"
          type="text"
          value={meta.alias}
          onChange={(e) => setMeta({ alias: e.target.value })}
          placeholder="打 拍 摸"
        />
      </div>

      <div className="flex flex-col gap-2">
        <CheckField
          label="反向播放"
          checked={meta.reverse}
          onChange={(v) => setMeta({ reverse: v })}
        />
        <CheckField
          label="加入随机列表"
          checked={meta.inRandomList}
          onChange={(v) => setMeta({ inRandomList: v })}
        />
      </div>
    </div>
  );
}
