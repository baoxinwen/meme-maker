/**
 * Fabric.js 7 与编辑器图层模型之间的桥接（纯操作辅助，无 React）。
 *
 * 图层映射规则：
 *   - 头像图层 = 单个 fabric.Image（占位图，可拖拽缩放）；位置 = [left, top, scaledW, scaledH]
 *   - 文字图层 = IText（不换行）或 Textbox（换行/缩放）
 *   - 文字 originX/Y 按 align 设置，使 Fabric 锚点 == 引擎渲染锚点（WYSIWYG）
 *
 * 编辑器画布只负责定位；滤镜和灰度等真实效果在预览中查看。
 */

import type { TextAlign, TextWrap } from "@/core";
import { createCanvas } from "@/core/utils/runtime";
import type { AvatarLayer, TextLayer, XYWH } from "@/stores/editor-store";
import * as fabric from "fabric";

export type LayerObject = fabric.Image | fabric.IText | fabric.Textbox;

// ---------------------------------------------------------------------------
// 图层标识 —— 用 WeakMap 附加，不污染 Fabric 对象、随对象回收自动清理
// ---------------------------------------------------------------------------

const layerIds = new WeakMap<fabric.FabricObject, string>();

/** 记录 Fabric 对象对应的图层 id。 */
export function setLayerId(obj: LayerObject, id: string): void {
  layerIds.set(obj, id);
}

/** 反查 Fabric 对象对应的图层 id；未登记返回 null。 */
export function getLayerId(obj: fabric.FabricObject | undefined | null): string | null {
  if (!obj) return null;
  return layerIds.get(obj) ?? null;
}

const AVATAR_TYPE_COLORS: Record<string, string> = {
  FROM: "#3b82f6",
  TO: "#22c55e",
  BOT: "#a855f7",
  GROUP: "#f59e0b",
  RANDOM: "#ec4899",
  USER: "#14b8a6",
};

/** 画一张带类型标签的占位图（头像无预览时用）。 */
export function makePlaceholderElement(type: string, w = 120, h = 120): HTMLCanvasElement {
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = AVATAR_TYPE_COLORS[type] ?? "#64748b";
  ctx.fillRect(0, 0, w, h);
  // 对角斜纹（示意「占位」）
  ctx.fillStyle = "rgba(255,255,255,0.15)";
  for (let i = -h; i < w; i += 16) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + h, h);
    ctx.lineTo(i + h + 8, h);
    ctx.lineTo(i + 8, 0);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 28px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(type, w / 2, h / 2);
  return c;
}

// ---------------------------------------------------------------------------
// 原点与位置读写
// ---------------------------------------------------------------------------

function textOrigin(align: TextAlign): { originX: fabric.TOriginX; originY: fabric.TOriginY } {
  switch (align) {
    case "CENTER":
      return { originX: "center", originY: "center" };
    case "RIGHT":
      return { originX: "right", originY: "bottom" };
    default:
      return { originX: "left", originY: "bottom" };
  }
}

export function editorTextFontProps(layer: TextLayer): {
  fontWeight: "bold" | "normal";
  fontStyle: "italic" | "normal";
} {
  return {
    fontWeight: layer.style === "BOLD" || layer.style === "BOLD_ITALIC" ? "bold" : "normal",
    fontStyle: layer.style === "ITALIC" || layer.style === "BOLD_ITALIC" ? "italic" : "normal",
  };
}

export function editorFontSize(layer: TextLayer): number {
  const maxWidth = layer.pos[2];
  if (layer.wrap !== "ZOOM" || maxWidth === undefined || maxWidth <= 0) return layer.size;
  const canvas = createCanvas(1, 1);
  const ctx = canvas.getContext("2d")!;
  const { fontStyle, fontWeight } = editorTextFontProps(layer);
  ctx.font = `${fontStyle} ${fontWeight} ${layer.size}px "${layer.font.replaceAll('"', '\\"')}"`;
  const width = Math.max(...layer.text.split("\n").map((line) => ctx.measureText(line).width), 1);
  return layer.size * (maxWidth / width);
}

export function readAvatarPos(obj: fabric.Image): XYWH {
  return [
    Math.round(obj.left ?? 0),
    Math.round(obj.top ?? 0),
    Math.round(obj.getScaledWidth()),
    Math.round(obj.getScaledHeight()),
  ];
}

export function readTextPos(
  obj: fabric.IText | fabric.Textbox,
  wrap: TextWrap,
): [number, number] | [number, number, number] {
  const x = Math.round(obj.left ?? 0);
  const y = Math.round(obj.top ?? 0);
  if (wrap === "NONE") return [x, y];
  return [x, y, Math.round(obj.width ?? 0)];
}

// ---------------------------------------------------------------------------
// 创建图层对象
// ---------------------------------------------------------------------------

export function createAvatarObject(layer: AvatarLayer): fabric.Image {
  const el = makePlaceholderElement(layer.type);
  const img = new fabric.Image(el, {
    left: layer.perFramePos[0]?.[0] ?? 0,
    top: layer.perFramePos[0]?.[1] ?? 0,
    cornerStyle: "circle",
    transparentCorners: false,
    stroke: layer.avatarOnTop ? "#000" : "#64748b",
    strokeWidth: 1,
    strokeDashArray: layer.avatarOnTop ? null : [8, 4],
  });
  // 按第一帧位置设置尺寸。
  const [, , w, h] = layer.perFramePos[0] ?? [0, 0, 120, 120];
  if (w > 0 && h > 0) {
    img.scaleX = w / el.width;
    img.scaleY = h / el.height;
  }
  applyAvatarProps(img, layer);
  // 给对象打上图层标识，便于事件回调反查
  setLayerId(img, layer.id);
  return img;
}

export function createTextObject(layer: TextLayer): fabric.IText | fabric.Textbox {
  const opts: Partial<fabric.Textbox> & {
    [k: string]: unknown;
  } = {
    left: layer.pos[0],
    top: layer.pos[1],
    fill: layer.color,
    fontSize: editorFontSize(layer),
    fontFamily: layer.font,
    ...editorTextFontProps(layer),
    stroke: layer.strokeSize > 0 ? layer.strokeColor : undefined,
    strokeWidth: layer.strokeSize,
    angle: layer.angle,
    splitByGrapheme: true,
    editable: true,
    ...textOrigin(layer.align),
  };
  let obj: fabric.IText | fabric.Textbox;
  if (layer.wrap !== "BREAK") {
    obj = new fabric.IText(layer.text, opts);
    obj.setControlsVisibility({ ml: false, mr: false });
  } else {
    const tb = new fabric.Textbox(layer.text, { ...opts, width: layer.pos[2] ?? 200 });
    tb.setControlsVisibility({ mt: false, mb: false });
    obj = tb;
  }
  setLayerId(obj, layer.id);
  return obj;
}

// ---------------------------------------------------------------------------
// 应用属性（图层元信息变更时同步到对象）
// ---------------------------------------------------------------------------

function makeCircleClipPath(w: number, h: number): fabric.Rect {
  const r = Math.min(w, h) / 2;
  return new fabric.Rect({
    width: w,
    height: h,
    rx: r,
    ry: r,
    originX: "center",
    originY: "center",
  });
}

export function applyAvatarProps(img: fabric.Image, layer: AvatarLayer): void {
  img.flipX = layer.style.includes("MIRROR");
  img.flipY = layer.style.includes("FLIP");
  img.opacity = layer.opacity;
  img.angle = layer.angle;
  img.stroke = layer.avatarOnTop ? "#000" : "#64748b";
  img.strokeDashArray = layer.avatarOnTop ? null : [8, 4];
  // 圆形裁剪
  if (layer.round) {
    img.clipPath = makeCircleClipPath(img.width, img.height);
  } else {
    img.clipPath = undefined;
  }
  img.dirty = true;
}

export function applyTextProps(obj: fabric.IText | fabric.Textbox, layer: TextLayer): void {
  obj.set({
    // 回写位置：属性面板改 X/Y、方向键移动、撤销/重做都只更新仓库，
    // 画布对象必须跟随，否则视觉与导出数据不一致，且下一次拖拽会用旧视觉位置覆盖仓库。
    left: layer.pos[0],
    top: layer.pos[1],
    fill: layer.color,
    fontSize: editorFontSize(layer),
    fontFamily: layer.font,
    ...editorTextFontProps(layer),
    stroke: layer.strokeSize > 0 ? layer.strokeColor : undefined,
    strokeWidth: layer.strokeSize,
    angle: layer.angle,
    ...textOrigin(layer.align),
  });
  if (layer.wrap !== "NONE" && obj instanceof fabric.Textbox) {
    obj.width = layer.pos[2] ?? obj.width;
  }
  obj.setCoords();
  obj.dirty = true;
}

/** 把指定帧的位置应用到头像对象，切帧时调用。 */
export function applyAvatarFramePos(img: fabric.Image, pos: XYWH): void {
  const [x, y, w, h] = pos;
  if (w === 0 && h === 0) {
    img.visible = false;
    return;
  }
  img.visible = true;
  img.left = x;
  img.top = y;
  if (img.width && img.height && w > 0 && h > 0) {
    img.scaleX = w / img.width;
    img.scaleY = h / img.height;
  }
  img.setCoords();
}

/** 选中/取消选中样式（Fabric 自带选中框，这里只做额外高亮）。 */
export function setSelected(obj: LayerObject, selected: boolean): void {
  if (selected) {
    obj.set("shadow", new fabric.Shadow({ color: "#3b82f6", blur: 8 }));
  } else {
    obj.set("shadow", undefined);
  }
}
