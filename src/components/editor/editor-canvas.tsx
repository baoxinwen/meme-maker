/**
 * 编辑器画布：Fabric.js 7 的 React 封装。
 *
 * 职责：
 *   - 初始化和销毁 `Fabric.Canvas`（生命周期）
 *   - 画布尺寸、背景帧（当前 frameIndex）
 *   - 图层 reconcile：增删/属性同步/z 序
 *   - 切帧时把头像对象定位到该帧位置（文字全局生效，不随帧切换）
 *   - 选中状态在状态仓库与 Fabric 活动对象之间双向同步
 *   - 对象修改或文字编辑结束后，把位置和内容写回状态仓库
 *
 * Fabric 是命令式库，这里用多个细粒度副作用分别响应状态仓库切片，避免全量重建。
 */

import * as fabric from "fabric";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";

import {
  type LayerObject,
  applyAvatarFramePos,
  applyAvatarProps,
  applyTextProps,
  createAvatarObject,
  createTextObject,
  getLayerId,
  readAvatarPos,
  readTextPos,
  setSelected,
} from "@/lib/editor/fabric-utils";
import { type EditorLayer, editorLayerGroup, useEditorStore } from "@/stores/editor-store";

const VIEWPORT_PADDING = 16;

function syncObjectOrder(
  canvas: fabric.Canvas,
  layers: readonly EditorLayer[],
  registry: ReadonlyMap<string, LayerObject>,
  background: fabric.Image | null,
): void {
  const groups = ["bottom-avatar", "top-avatar", "text"] as const;
  let objectIndex = 0;
  for (const group of groups) {
    if (group === "top-avatar" && background) {
      canvas.moveObjectTo(background, objectIndex);
      objectIndex += 1;
    }
    for (const layer of layers) {
      if (editorLayerGroup(layer) !== group) continue;
      const object = registry.get(layer.id);
      if (!object) continue;
      canvas.moveObjectTo(object, objectIndex);
      objectIndex += 1;
    }
  }
}

function previewStageHeight(
  availableWidth: number,
  canvasSize: { width: number; height: number },
): string | undefined {
  if (availableWidth <= 0 || canvasSize.width <= 0 || canvasSize.height <= 0) {
    return undefined;
  }
  const contentHeight = Math.ceil((availableWidth * canvasSize.height) / canvasSize.width);
  return `clamp(20rem, min(64dvh, ${contentHeight + VIEWPORT_PADDING}px), 44rem)`;
}

export function EditorCanvas() {
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const fabricRef = useRef<fabric.Canvas | null>(null);
  const registryRef = useRef<Map<string, LayerObject>>(new Map());
  const backgroundRef = useRef<fabric.Image | null>(null);

  const canvasSize = useEditorStore((s) => s.canvasSize);
  const frames = useEditorStore((s) => s.frames);
  const frameIndex = useEditorStore((s) => s.frameIndex);
  const layers = useEditorStore((s) => s.layers);
  const selectedLayerId = useEditorStore((s) => s.selectedLayerId);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const measure = () => {
      setViewportSize({
        width: Math.max(0, viewport.clientWidth - VIEWPORT_PADDING),
        height: Math.max(0, viewport.clientHeight - VIEWPORT_PADDING),
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  // ---- 初始化 / 销毁 ----
  useEffect(() => {
    const el = canvasElRef.current;
    if (!el) return;
    const fc = new fabric.Canvas(el, {
      backgroundColor: "#ffffff",
      preserveObjectStacking: true,
      selection: true,
    });
    fabricRef.current = fc;

    const onModified = (e: { target?: fabric.Object }) => {
      const obj = e.target;
      const id = getLayerId(obj);
      if (!id || !obj) return;
      const state = useEditorStore.getState();
      const layer = state.layers.find((l) => l.id === id);
      if (!layer) return;
      if (layer.kind === "avatar") {
        state.updateFramePos(id, state.frameIndex, readAvatarPos(obj as fabric.Image));
      } else {
        state.updateText(id, { pos: readTextPos(obj as fabric.IText, layer.wrap) });
      }
    };
    // 文字编辑退出时回写内容
    const onTextExited = (e: { target?: fabric.Object }) => {
      const obj = e.target as fabric.IText | undefined;
      const id = getLayerId(obj);
      if (!id || !obj) return;
      useEditorStore.getState().updateText(id, { text: obj.text ?? "" });
    };
    const onSelection = () => {
      const id = getLayerId(fc.getActiveObject());
      const cur = useEditorStore.getState().selectedLayerId;
      if (id !== cur) useEditorStore.getState().selectLayer(id);
    };
    const onCleared = () => {
      if (useEditorStore.getState().selectedLayerId) useEditorStore.getState().selectLayer(null);
    };

    fc.on("object:modified", onModified);
    fc.on("text:editing:exited", onTextExited);
    fc.on("selection:created", onSelection);
    fc.on("selection:updated", onSelection);
    fc.on("selection:cleared", onCleared);

    return () => {
      fc.dispose();
      fabricRef.current = null;
      registryRef.current.clear();
      backgroundRef.current = null;
    };
  }, []);

  // ---- 画布尺寸 ----
  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc) return;
    fc.setDimensions(
      { width: canvasSize.width, height: canvasSize.height },
      { backstoreOnly: true },
    );
    fc.renderAll();
  }, [canvasSize]);

  // 保留原始像素用于导出，只缩放 CSS 预览尺寸以完整放入工作区。
  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc || canvasSize.width <= 0 || canvasSize.height <= 0) return;
    if (viewportSize.width <= 0 || viewportSize.height <= 0) return;

    const scale = Math.min(
      viewportSize.width / canvasSize.width,
      viewportSize.height / canvasSize.height,
    );
    fc.setDimensions(
      {
        width: `${Math.max(1, Math.floor(canvasSize.width * scale))}px`,
        height: `${Math.max(1, Math.floor(canvasSize.height * scale))}px`,
      },
      { cssOnly: true },
    );
    fc.requestRenderAll();
  }, [canvasSize, viewportSize]);

  // ---- 背景帧 ----
  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc) return;
    const frame = frames[frameIndex];
    const previous = backgroundRef.current;
    if (previous) {
      fc.remove(previous);
      backgroundRef.current = null;
    }
    if (!frame) {
      fc.renderAll();
      return;
    }
    const targetWidth = canvasSize.width || frame.width;
    const targetHeight = canvasSize.height || frame.height;
    const img = new fabric.Image(frame, {
      left: 0,
      top: 0,
      originX: "left",
      originY: "top",
      selectable: false,
      evented: false,
      objectCaching: false,
      scaleX: targetWidth / frame.width,
      scaleY: targetHeight / frame.height,
    });
    backgroundRef.current = img;
    fc.add(img);
    const state = useEditorStore.getState();
    syncObjectOrder(fc, state.layers, registryRef.current, img);
    fc.requestRenderAll();
  }, [frames, frameIndex, canvasSize]);

  // ---- 图层 reconcile（增删 / 属性 / z 序）----
  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc) return;
    const registry = registryRef.current;

    // 删除已不存在的图层对象
    for (const [id, obj] of registry) {
      if (!layers.find((l) => l.id === id)) {
        fc.remove(obj);
        registry.delete(id);
      }
    }

    // 新增 / 更新
    for (const layer of layers) {
      const existing = registry.get(layer.id);
      if (!existing) {
        const obj = layer.kind === "avatar" ? createAvatarObject(layer) : createTextObject(layer);
        registry.set(layer.id, obj);
        fc.add(obj);
      } else if (layer.kind === "text") {
        // 换行方式变化时需要在 IText 与 Textbox 之间切换，因此重建对象。
        const needTextbox = layer.wrap === "BREAK";
        const isTextbox = existing instanceof fabric.Textbox;
        if (needTextbox !== isTextbox) {
          fc.remove(existing);
          const obj = createTextObject(layer);
          registry.set(layer.id, obj);
          fc.add(obj);
        } else {
          applyTextProps(existing as fabric.IText, layer);
        }
      } else {
        applyAvatarProps(existing as fabric.Image, layer);
      }
    }

    syncObjectOrder(fc, layers, registry, backgroundRef.current);

    // 选中高亮
    for (const [id, obj] of registry) {
      setSelected(obj, id === selectedLayerId);
    }
    fc.renderAll();
  }, [layers, selectedLayerId]);

  // ---- 切帧：把头像对象定位到当前帧位置 ----
  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc) return;
    const registry = registryRef.current;
    for (const layer of layers) {
      if (layer.kind !== "avatar") continue;
      const obj = registry.get(layer.id) as fabric.Image | undefined;
      if (!obj) continue;
      applyAvatarFramePos(obj, layer.perFramePos[frameIndex] ?? [0, 0, 0, 0]);
    }
    fc.renderAll();
  }, [frameIndex, layers]);

  // ---- 状态仓库 → Fabric 选中对象 ----
  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc) return;
    const obj = selectedLayerId ? registryRef.current.get(selectedLayerId) : null;
    const active = fc.getActiveObject();
    if (obj && active !== obj) {
      fc.setActiveObject(obj);
      fc.renderAll();
    } else if (!obj && active) {
      fc.discardActiveObject();
      fc.renderAll();
    }
  }, [selectedLayerId]);

  const stageHeight = previewStageHeight(viewportSize.width, canvasSize);
  const handleKeyDown = (event: KeyboardEvent<HTMLFieldSetElement>) => {
    if (
      !selectedLayerId ||
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    ) {
      return;
    }
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    const state = useEditorStore.getState();
    const layer = state.layers.find((item) => item.id === selectedLayerId);
    if (!layer) return;
    if (layer.kind === "avatar") {
      const [x, y, width, height] = layer.perFramePos[state.frameIndex] ?? [0, 0, 100, 100];
      state.updateFramePos(layer.id, state.frameIndex, [x + dx, y + dy, width, height]);
    } else {
      state.updateText(layer.id, {
        pos:
          layer.pos.length === 3
            ? [layer.pos[0] + dx, layer.pos[1] + dy, layer.pos[2]]
            : [layer.pos[0] + dx, layer.pos[1] + dy],
      });
    }
  };

  return (
    <div
      ref={viewportRef}
      data-testid="editor-canvas-viewport"
      className="canvas-stage relative flex min-h-[16rem] max-h-[44rem] items-center justify-center overflow-hidden rounded-md p-2 sm:min-h-[20rem]"
      style={stageHeight ? { height: stageHeight } : undefined}
    >
      <fieldset
        aria-describedby="editor-canvas-help"
        tabIndex={selectedLayerId ? 0 : -1}
        onKeyDown={handleKeyDown}
        className="pointer-events-none absolute left-3 top-3 z-20 h-10 rounded-md border bg-background px-3 text-xs font-semibold opacity-0 shadow-sm outline-none focus:pointer-events-auto focus:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/45"
      >
        <legend className="sr-only">画布键盘移动区域</legend>
        用键盘移动选中图层
      </fieldset>
      <p id="editor-canvas-help" className="sr-only">
        先在图层列表选择图层，然后使用方向键移动；按住 Shift 可每次移动 10
        像素。属性面板也提供位置和尺寸数字输入。
      </p>
      <div className="flex size-full items-center justify-center">
        <canvas ref={canvasElRef} aria-label="模板画布视觉预览" />
      </div>
    </div>
  );
}
