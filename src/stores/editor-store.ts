/**
 * 模板编辑器状态。
 *
 * 设计：Fabric 画布是“当前帧视图”，本状态仓库是“全帧数据与元信息模型”。
 *   - 帧列表、画布尺寸、图层（含逐帧位置）和模板元信息都存放在这里
 *   - Fabric 对象修改后，把当前帧位置写回 `updateFramePos`
 *   - 切帧后，EditorCanvas 使用新帧位置重设 Fabric 对象
 *   - `compileTemplate(state)` 把状态仓库编译成 PetpetTemplate（见 lib/editor/compile.ts）
 *
 * 不做持久化：编辑器状态按会话存活，刷新即清空。
 */

import type { AvatarFit, AvatarStyle, AvatarType, TextAlign, TextStyle, TextWrap } from "@/core";
import { temporal } from "zundo";
import { create } from "zustand";

export type XYWH = [number, number, number, number];

export interface AvatarLayer {
  readonly id: string;
  readonly kind: "avatar";
  type: AvatarType;
  fit: AvatarFit;
  style: AvatarStyle[];
  round: boolean;
  rotate: boolean;
  avatarOnTop: boolean;
  angle: number;
  opacity: number;
  posType: "ZOOM"; // 最小可用版本仅支持 ZOOM；DEFORM 可视化编辑后续再实现
  /** 每帧 [x, y, w, h]，长度 === frames.length */
  perFramePos: XYWH[];
  /** 编辑器内预览图（不入模板）；null 时画占位灰块 */
  previewBlob: Blob | null;
}

export interface TextLayer {
  readonly id: string;
  readonly kind: "text";
  text: string;
  color: string;
  size: number;
  font: string;
  style: TextStyle;
  align: TextAlign;
  wrap: TextWrap;
  strokeColor: string;
  strokeSize: number;
  angle: number;
  /** [x, y] 或 [x, y, maxWidth]（换行方式不是 NONE 时第三项生效） */
  pos: [number, number] | [number, number, number];
}

export type EditorLayer = AvatarLayer | TextLayer;

export interface EditorMeta {
  key: string;
  /** 每秒帧数 → delay = round(1000 / fps)；用户友好 */
  fps: number;
  /** 别名（空格分隔，编译时 split） */
  alias: string;
  reverse: boolean;
  inRandomList: boolean;
}

export interface EditorState {
  frames: HTMLCanvasElement[];
  frameIndex: number;
  canvasSize: { width: number; height: number };
  meta: EditorMeta;
  layers: EditorLayer[];
  selectedLayerId: string | null;
  /** 导出数据相较于上一次成功导出是否有修改。 */
  isDirty: boolean;
  /** 背景文件正在解码时锁定时间线，避免异步操作目标漂移。 */
  isBackgroundOperationInProgress: boolean;

  // —— 帧与元信息
  replaceFrames: (frames: HTMLCanvasElement[]) => void;
  insertFrames: (afterIndex: number, frames: HTMLCanvasElement[]) => void;
  replaceFrame: (index: number, frame: HTMLCanvasElement) => void;
  moveFrame: (fromIndex: number, toIndex: number) => void;
  clearFrames: () => void;
  removeFrame: (index: number) => void;
  setFrameIndex: (i: number) => void;
  setMeta: (patch: Partial<EditorMeta>) => void;
  markSaved: () => void;
  setBackgroundOperationInProgress: (inProgress: boolean) => void;

  // —— 图层
  addAvatar: () => void;
  addText: () => void;
  removeLayer: (id: string) => void;
  selectLayer: (id: string | null) => void;
  moveLayer: (id: string, dir: "up" | "down") => void;
  updateAvatar: (id: string, patch: Partial<AvatarLayer>) => void;
  updateText: (id: string, patch: Partial<TextLayer>) => void;
  updateFramePos: (id: string, frameIndex: number, pos: XYWH) => void;

  reset: () => void;
}

// —— 内部：生成不重复 id ——
let _idCounter = 0;
function nextId(prefix: string): string {
  _idCounter += 1;
  return `${prefix}-${_idCounter}`;
}

const DEFAULT_AVATAR_POS: XYWH = [0, 0, 100, 100];

function makeAvatarLayer(frameCount: number): AvatarLayer {
  const perFramePos: XYWH[] = Array.from({ length: frameCount }, () => [...DEFAULT_AVATAR_POS]);
  return {
    id: nextId("avatar"),
    kind: "avatar",
    type: "TO",
    fit: "FILL",
    style: [],
    round: false,
    rotate: false,
    avatarOnTop: true,
    angle: 0,
    opacity: 1,
    posType: "ZOOM",
    perFramePos,
    previewBlob: null,
  };
}

function makeTextLayer(): TextLayer {
  return {
    id: nextId("text"),
    kind: "text",
    text: "文字",
    color: "#191919",
    size: 32,
    font: "Arial",
    style: "PLAIN",
    align: "LEFT",
    wrap: "NONE",
    strokeColor: "#ffffff",
    strokeSize: 0,
    angle: 0,
    pos: [50, 50],
  };
}

const initialState = {
  frames: [] as HTMLCanvasElement[],
  frameIndex: 0,
  canvasSize: { width: 0, height: 0 },
  meta: {
    key: "my-template",
    fps: 15,
    alias: "",
    reverse: false,
    inRandomList: false,
  } satisfies EditorMeta,
  layers: [] as EditorLayer[],
  selectedLayerId: null as string | null,
  isDirty: false,
  isBackgroundOperationInProgress: false,
};

export function normalizeEditorFps(fps: number): number {
  if (!Number.isFinite(fps)) return 1;
  return Math.max(1, Math.min(60, Math.round(fps)));
}

/** 通过 Canvas 对象身份定位异步操作最初选中的背景帧。 */
export function findFrameIndexByIdentity(
  frames: readonly HTMLCanvasElement[],
  target: HTMLCanvasElement,
): number {
  return frames.indexOf(target);
}

/** 把逐帧位置数组对齐到新的帧数：不足时复制末帧，超出时截断。 */
function resizePerFramePos(pos: XYWH[], count: number): XYWH[] {
  if (pos.length === count) return pos;
  if (pos.length === 0) return Array.from({ length: count }, () => [...DEFAULT_AVATAR_POS]);
  if (pos.length > count) return pos.slice(0, count);
  const last = pos[pos.length - 1];
  const out = [...pos];
  for (let i = pos.length; i < count; i++) out.push([...last]);
  return out;
}

function moveItem<T>(items: readonly T[], fromIndex: number, toIndex: number): T[] {
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

function moveFrameIndex(index: number, fromIndex: number, toIndex: number): number {
  if (index === fromIndex) return toIndex;
  if (fromIndex < toIndex && index > fromIndex && index <= toIndex) return index - 1;
  if (toIndex < fromIndex && index >= toIndex && index < fromIndex) return index + 1;
  return index;
}

export type EditorLayerGroup = "bottom-avatar" | "top-avatar" | "text";

export function editorLayerGroup(layer: EditorLayer): EditorLayerGroup {
  if (layer.kind === "text") return "text";
  return layer.avatarOnTop ? "top-avatar" : "bottom-avatar";
}

const GROUP_ORDER: Record<EditorLayerGroup, number> = {
  "bottom-avatar": 0,
  "top-avatar": 1,
  text: 2,
};

export function normalizeLayerOrder(layers: readonly EditorLayer[]): EditorLayer[] {
  return [...layers].sort(
    (left, right) => GROUP_ORDER[editorLayerGroup(left)] - GROUP_ORDER[editorLayerGroup(right)],
  );
}

export function canMoveLayer(
  layers: readonly EditorLayer[],
  id: string,
  dir: "up" | "down",
): boolean {
  const layer = layers.find((item) => item.id === id);
  if (!layer) return false;
  const peers = layers.filter((item) => editorLayerGroup(item) === editorLayerGroup(layer));
  const index = peers.findIndex((item) => item.id === id);
  return dir === "up" ? index >= 0 && index < peers.length - 1 : index > 0;
}

/**
 * 可撤销状态快照：只跟踪影响导出结果的数据（帧/画布尺寸/元信息/图层），
 * 瞬态 UI 状态（选中、播放位置、dirty 标记等）不进入历史。
 */
export type EditorHistoryState = Pick<EditorState, "frames" | "canvasSize" | "meta" | "layers">;

/** 撤销历史长度上限，防止长会话内存膨胀。 */
const HISTORY_LIMIT = 50;

function pickHistory(state: EditorState): EditorHistoryState {
  return {
    frames: state.frames,
    canvasSize: state.canvasSize,
    meta: state.meta,
    layers: state.layers,
  };
}

export const useEditorStore = create<EditorState>()(
  temporal(
    (set) => ({
      ...initialState,

      replaceFrames: (frames) => {
        const first = frames[0];
        const size = first ? { width: first.width, height: first.height } : { width: 0, height: 0 };
        set((state) => ({
          frames,
          frameIndex: 0,
          canvasSize: size,
          // 已有图层的逐帧位置按新帧数对齐。
          layers: state.layers.map((l) =>
            l.kind === "avatar"
              ? { ...l, perFramePos: resizePerFramePos(l.perFramePos, frames.length) }
              : l,
          ),
          isDirty: true,
        }));
      },

      insertFrames: (afterIndex, framesToInsert) =>
        set((state) => {
          if (framesToInsert.length === 0) return {};

          if (state.frames.length === 0) {
            const first = framesToInsert[0];
            return {
              frames: [...framesToInsert],
              frameIndex: 0,
              canvasSize: { width: first.width, height: first.height },
              layers: state.layers.map((layer) =>
                layer.kind === "avatar"
                  ? {
                      ...layer,
                      perFramePos: resizePerFramePos(layer.perFramePos, framesToInsert.length),
                    }
                  : layer,
              ),
              isDirty: true,
            };
          }

          const boundedAfterIndex = Math.max(-1, Math.min(afterIndex, state.frames.length - 1));
          const insertAt = boundedAfterIndex + 1;
          const frames = [
            ...state.frames.slice(0, insertAt),
            ...framesToInsert,
            ...state.frames.slice(insertAt),
          ];

          return {
            frames,
            frameIndex: insertAt,
            layers: state.layers.map((layer) => {
              if (layer.kind !== "avatar") return layer;
              const positions = resizePerFramePos(layer.perFramePos, state.frames.length);
              const sourcePosition =
                positions[boundedAfterIndex] ?? positions[0] ?? DEFAULT_AVATAR_POS;
              const insertedPositions = Array.from({ length: framesToInsert.length }, () => [
                ...sourcePosition,
              ]) as XYWH[];
              return {
                ...layer,
                perFramePos: [
                  ...positions.slice(0, insertAt),
                  ...insertedPositions,
                  ...positions.slice(insertAt),
                ],
              };
            }),
            isDirty: true,
          };
        }),

      replaceFrame: (index, frame) =>
        set((state) => {
          if (index < 0 || index >= state.frames.length) return {};
          const frames = [...state.frames];
          frames[index] = frame;
          return { frames, isDirty: true };
        }),

      moveFrame: (fromIndex, toIndex) =>
        set((state) => {
          const lastIndex = state.frames.length - 1;
          if (
            !Number.isInteger(fromIndex) ||
            !Number.isInteger(toIndex) ||
            fromIndex < 0 ||
            fromIndex > lastIndex ||
            toIndex < 0 ||
            toIndex > lastIndex ||
            fromIndex === toIndex
          ) {
            return {};
          }

          return {
            frames: moveItem(state.frames, fromIndex, toIndex),
            frameIndex: moveFrameIndex(state.frameIndex, fromIndex, toIndex),
            layers: state.layers.map((layer) =>
              layer.kind === "avatar"
                ? {
                    ...layer,
                    perFramePos: moveItem(
                      resizePerFramePos(layer.perFramePos, state.frames.length),
                      fromIndex,
                      toIndex,
                    ),
                  }
                : layer,
            ),
            isDirty: true,
          };
        }),

      clearFrames: () =>
        set({
          frames: [],
          frameIndex: 0,
          canvasSize: { width: 0, height: 0 },
          layers: [],
          selectedLayerId: null,
          isDirty: true,
        }),

      removeFrame: (index) =>
        set((state) => {
          if (index < 0 || index >= state.frames.length) return {};
          const frames = state.frames.filter((_, frameIndex) => frameIndex !== index);
          if (frames.length === 0) {
            return {
              frames: [],
              frameIndex: 0,
              canvasSize: { width: 0, height: 0 },
              layers: [],
              selectedLayerId: null,
              isDirty: true,
            };
          }

          const frameIndex = Math.min(
            frames.length - 1,
            Math.max(0, state.frameIndex - (index < state.frameIndex ? 1 : 0)),
          );
          return {
            frames,
            frameIndex,
            canvasSize: { width: frames[0].width, height: frames[0].height },
            layers: state.layers.map((layer) =>
              layer.kind === "avatar"
                ? {
                    ...layer,
                    perFramePos: layer.perFramePos.filter((_, posIndex) => posIndex !== index),
                  }
                : layer,
            ),
            isDirty: true,
          };
        }),

      setFrameIndex: (i) =>
        set((state) => ({
          frameIndex: Math.max(0, Math.min(i, state.frames.length - 1)),
        })),

      setMeta: (patch) =>
        set((state) => {
          const meta = {
            ...state.meta,
            ...patch,
            fps: normalizeEditorFps(patch.fps ?? state.meta.fps),
          };
          if (
            meta.key === state.meta.key &&
            meta.fps === state.meta.fps &&
            meta.alias === state.meta.alias &&
            meta.reverse === state.meta.reverse &&
            meta.inRandomList === state.meta.inRandomList
          ) {
            return {};
          }
          return { meta, isDirty: true };
        }),

      markSaved: () => set({ isDirty: false }),

      setBackgroundOperationInProgress: (inProgress) =>
        set({ isBackgroundOperationInProgress: inProgress }),

      addAvatar: () =>
        set((state) => {
          const layer = makeAvatarLayer(Math.max(1, state.frames.length));
          return {
            layers: normalizeLayerOrder([...state.layers, layer]),
            selectedLayerId: layer.id,
            isDirty: true,
          };
        }),

      addText: () =>
        set((state) => {
          const layer = makeTextLayer();
          return { layers: [...state.layers, layer], selectedLayerId: layer.id, isDirty: true };
        }),

      removeLayer: (id) =>
        set((state) => {
          if (!state.layers.some((layer) => layer.id === id)) return {};
          return {
            layers: state.layers.filter((layer) => layer.id !== id),
            selectedLayerId: state.selectedLayerId === id ? null : state.selectedLayerId,
            isDirty: true,
          };
        }),

      selectLayer: (id) => set({ selectedLayerId: id }),

      moveLayer: (id, dir) =>
        set((state) => {
          const idx = state.layers.findIndex((l) => l.id === id);
          if (idx < 0) return {};
          const group = editorLayerGroup(state.layers[idx]);
          const peerIndexes = state.layers
            .map((layer, index) => ({ layer, index }))
            .filter(({ layer }) => editorLayerGroup(layer) === group)
            .map(({ index }) => index);
          const peerIndex = peerIndexes.indexOf(idx);
          const targetPeerIndex = dir === "up" ? peerIndex + 1 : peerIndex - 1;
          const swap = peerIndexes[targetPeerIndex];
          if (swap === undefined) return {};
          const layers = [...state.layers];
          [layers[idx], layers[swap]] = [layers[swap], layers[idx]];
          return { layers, isDirty: true };
        }),

      updateAvatar: (id, patch) =>
        set((state) => {
          const exists = state.layers.some((layer) => layer.id === id && layer.kind === "avatar");
          if (!exists) return {};
          return {
            layers: normalizeLayerOrder(
              state.layers.map((layer) =>
                layer.id === id && layer.kind === "avatar" ? { ...layer, ...patch } : layer,
              ),
            ),
            isDirty: true,
          };
        }),

      updateText: (id, patch) =>
        set((state) => {
          const exists = state.layers.some((layer) => layer.id === id && layer.kind === "text");
          if (!exists) return {};
          return {
            layers: state.layers.map((layer) =>
              layer.id === id && layer.kind === "text" ? { ...layer, ...patch } : layer,
            ),
            isDirty: true,
          };
        }),

      updateFramePos: (id, frameIndex, pos) =>
        set((state) => {
          const exists = state.layers.some((layer) => layer.id === id && layer.kind === "avatar");
          if (!exists) return {};
          return {
            layers: state.layers.map((layer) => {
              if (layer.id !== id || layer.kind !== "avatar") return layer;
              const perFramePos = [...layer.perFramePos];
              perFramePos[frameIndex] = pos;
              return { ...layer, perFramePos };
            }),
            isDirty: true,
          };
        }),

      reset: () => {
        set({ ...initialState, meta: { ...initialState.meta } });
        useEditorStore.temporal.getState().clear();
      },
    }),
    {
      limit: HISTORY_LIMIT,
      partialize: (state) => pickHistory(state as EditorState),
      equality: (past, current) =>
        past.frames === current.frames &&
        past.canvasSize === current.canvasSize &&
        past.meta === current.meta &&
        past.layers === current.layers,
    },
  ),
);

// 供编译逻辑和测试使用：把帧率换算为毫秒延迟。
export function fpsToDelay(fps: number): number {
  return Math.round(1000 / normalizeEditorFps(fps));
}

// 取当前选中的图层（便捷选择器）
export function selectSelectedLayer(state: EditorState): EditorLayer | null {
  return state.layers.find((l) => l.id === state.selectedLayerId) ?? null;
}

// 让外部能重置 id 计数（测试隔离）
export function _resetIdCounter(): void {
  _idCounter = 0;
}
