/**
 * 把编辑器状态仓库编译成 PetpetTemplate（即导出的 data.json 内容）。
 *
 * 纯函数，便于单测。输出风格与内置模板（osu/tightly）一致：
 *   - 省略默认值（false/0/空数组/默认枚举），让 data.json 干净
 *   - 背景是上传的图片帧 → 不写 background 字段（尺寸由 PNG 决定，与 tightly 一致）
 *   - `key` 不写入 JSON，仅用作 ZIP 文件夹名
 *   - 位置：单帧展平为 [x,y,w,h]，多帧保持 [[...],[...]]
 */

import type { AvatarTemplate, PetpetTemplate, TextTemplate } from "@/core";
import type { AvatarLayer, EditorState, TextLayer } from "@/stores/editor-store";
import { fpsToDelay } from "@/stores/editor-store";

function compileAvatar(layer: AvatarLayer): AvatarTemplate {
  const pos = layer.perFramePos.length === 1 ? layer.perFramePos[0] : layer.perFramePos;

  const out: AvatarTemplate = {
    type: layer.type,
    pos: pos as AvatarTemplate["pos"],
    posType: "ZOOM",
  };
  // 省略默认值
  if (layer.fit !== "FILL") out.fit = layer.fit;
  if (layer.style.length > 0) out.style = layer.style;
  if (layer.round) out.round = true;
  if (layer.rotate) out.rotate = true;
  if (!layer.avatarOnTop) out.avatarOnTop = false;
  if (layer.angle !== 0) {
    out.angle = layer.angle;
    // Fabric 预览围绕对象中心旋转；引擎缺省（DEFAULT）围绕 pos 左上角旋转，
    // 必须显式声明 CENTER 才能与编辑器所见一致。
    out.origin = "CENTER";
  }
  if (layer.opacity !== 1) out.opacity = layer.opacity;
  return out;
}

function compileText(layer: TextLayer): TextTemplate {
  const out: TextTemplate = {
    text: layer.text,
    pos: layer.pos,
  };
  if (layer.color) out.color = layer.color;
  if (layer.size) out.size = layer.size;
  if (layer.font && layer.font !== "Arial") out.font = layer.font;
  if (layer.style !== "PLAIN") out.style = layer.style;
  if (layer.align !== "LEFT") out.align = layer.align;
  if (layer.wrap !== "NONE") out.wrap = layer.wrap;
  if (layer.angle !== 0) {
    out.angle = layer.angle;
    out.origin = "CENTER";
  }
  if (layer.strokeSize > 0) {
    out.strokeSize = layer.strokeSize;
    out.strokeColor = layer.strokeColor;
  }
  return out;
}

export function compileTemplate(state: EditorState): PetpetTemplate {
  const type = state.frames.length === 1 ? "IMG" : "GIF";
  const alias = state.meta.alias.trim();
  const delay = fpsToDelay(state.meta.fps);

  const out: PetpetTemplate = {
    type,
    avatar: state.layers.filter((l): l is AvatarLayer => l.kind === "avatar").map(compileAvatar),
    text: state.layers.filter((l): l is TextLayer => l.kind === "text").map(compileText),
    options: [],
    delay,
  };
  if (alias) out.alias = alias.split(/\s+/);
  if (state.meta.reverse) out.reverse = true;
  if (state.meta.inRandomList) out.inRandomList = true;
  return out;
}
