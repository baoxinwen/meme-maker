/**
 * 编辑器编译测试：验证状态仓库到 PetpetTemplate 的映射：
 *   - 单帧位置展平，多帧位置保持数组
 *   - 默认值省略（fit/round/style/font/align 等）
 *   - 非默认值保留
 *   - 帧延迟换算、别名切分、倒放和随机列表标记
 *   - 输出能被 `parseTemplate` 往返解析（与引擎数据结构一致）
 */

import { describe, expect, it } from "vitest";
import { parseTemplate } from "../../src/core";
import { createCanvas } from "../../src/core/utils/runtime";
import { compileTemplate } from "../../src/lib/editor/compile";
import { editorFontSize, editorTextFontProps } from "../../src/lib/editor/fabric-utils";
import {
  type AvatarLayer,
  type EditorState,
  type TextLayer,
  canMoveLayer,
  findFrameIndexByIdentity,
  fpsToDelay,
  normalizeEditorFps,
  normalizeLayerOrder,
  useEditorStore,
} from "../../src/stores/editor-store";

function makeState(partial: Partial<EditorState> = {}): EditorState {
  return {
    frames: [createCanvas(100, 100)],
    frameIndex: 0,
    canvasSize: { width: 100, height: 100 },
    meta: { key: "test", fps: 15, alias: "", reverse: false, inRandomList: false },
    layers: [],
    selectedLayerId: null,
    ...partial,
  } as unknown as EditorState;
}

function makeAvatar(o: Partial<AvatarLayer> = {}): AvatarLayer {
  return {
    id: "a1",
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
    perFramePos: [[10, 10, 50, 50]],
    previewBlob: null,
    ...o,
  };
}

function makeText(o: Partial<TextLayer> = {}): TextLayer {
  return {
    id: "t1",
    kind: "text",
    text: "hi",
    color: "#191919",
    size: 32,
    font: "Arial",
    style: "PLAIN",
    align: "LEFT",
    wrap: "NONE",
    strokeColor: "#ffffff",
    strokeSize: 0,
    angle: 0,
    pos: [10, 20],
    ...o,
  };
}

describe("compileTemplate: 模板类型与帧", () => {
  it("1 帧 → IMG", () => {
    const t = compileTemplate(makeState({ frames: [createCanvas(100, 100)] }));
    expect(t.type).toBe("IMG");
  });

  it("多帧 → GIF", () => {
    const t = compileTemplate(
      makeState({ frames: [createCanvas(100, 100), createCanvas(100, 100)] }),
    );
    expect(t.type).toBe("GIF");
  });

  it("无背景字段（背景是图片帧）", () => {
    const t = compileTemplate(makeState());
    expect(t.background).toBeUndefined();
  });
});

describe("编辑器图层语义", () => {
  it("固定为底层头像、顶层头像、文字，并禁止跨层级移动", () => {
    const bottom = makeAvatar({ id: "bottom", avatarOnTop: false });
    const top = makeAvatar({ id: "top", avatarOnTop: true });
    const text = makeText({ id: "text" });
    const layers = normalizeLayerOrder([text, top, bottom]);

    expect(layers.map((layer) => layer.id)).toEqual(["bottom", "top", "text"]);
    expect(canMoveLayer(layers, "bottom", "up")).toBe(false);
    expect(canMoveLayer(layers, "top", "down")).toBe(false);
    expect(canMoveLayer(layers, "text", "down")).toBe(false);
  });

  it("Fabric 预览正确表达 BOLD_ITALIC 和 ZOOM", () => {
    const styled = editorTextFontProps(makeText({ style: "BOLD_ITALIC" }));
    expect(styled).toEqual({ fontWeight: "bold", fontStyle: "italic" });

    const zoomedSize = editorFontSize(
      makeText({ text: "一段很长的文字", size: 40, wrap: "ZOOM", pos: [0, 0, 80] }),
    );
    expect(zoomedSize).toBeLessThan(40);
  });
});

describe("编辑器背景管理", () => {
  it("通过对象身份定位异步操作开始时选中的帧", () => {
    const first = createCanvas(100, 100);
    const second = createCanvas(100, 100);
    const third = createCanvas(100, 100);

    expect(findFrameIndexByIdentity([first, third, second], second)).toBe(2);
    expect(findFrameIndexByIdentity([first, third], second)).toBe(-1);
  });

  it("编辑导出数据后标记为未保存，保存基线后仅切帧不会重新变脏", () => {
    const store = useEditorStore.getState();
    store.reset();
    expect(useEditorStore.getState().isDirty).toBe(false);

    store.replaceFrames([createCanvas(100, 100)]);
    expect(useEditorStore.getState().isDirty).toBe(true);
    store.markSaved();
    store.setFrameIndex(0);
    expect(useEditorStore.getState().isDirty).toBe(false);

    store.addText();
    expect(useEditorStore.getState().isDirty).toBe(true);
    store.markSaved();
    store.setMeta({ fps: 999 });
    expect(useEditorStore.getState().meta.fps).toBe(60);
    expect(useEditorStore.getState().isDirty).toBe(true);

    useEditorStore.getState().reset();
  });

  it("帧率在状态与导出换算时都限制在 1 到 60", () => {
    const store = useEditorStore.getState();
    store.reset();
    store.setMeta({ fps: -2 });
    expect(useEditorStore.getState().meta.fps).toBe(1);
    expect(normalizeEditorFps(Number.NaN)).toBe(1);
    expect(normalizeEditorFps(60.6)).toBe(60);
    expect(fpsToDelay(999)).toBe(Math.round(1000 / 60));
    store.reset();
  });

  it("清空背景会移除帧和图层，但保留模板元信息", () => {
    const store = useEditorStore.getState();
    store.reset();
    store.setMeta({ key: "保留名称", fps: 20, alias: "测试 模板", reverse: true });
    store.replaceFrames([createCanvas(100, 100), createCanvas(100, 100)]);
    store.addAvatar();
    store.addText();
    store.setFrameIndex(1);

    useEditorStore.getState().clearFrames();
    const state = useEditorStore.getState();
    expect(state.frames).toEqual([]);
    expect(state.frameIndex).toBe(0);
    expect(state.canvasSize).toEqual({ width: 0, height: 0 });
    expect(state.layers).toEqual([]);
    expect(state.selectedLayerId).toBeNull();
    expect(state.meta).toEqual({
      key: "保留名称",
      fps: 20,
      alias: "测试 模板",
      reverse: true,
      inRandomList: false,
    });

    state.reset();
  });

  it("删除中间帧会同步当前帧和头像的逐帧位置", () => {
    const store = useEditorStore.getState();
    store.reset();
    const frames = [createCanvas(100, 100), createCanvas(100, 100), createCanvas(100, 100)];
    store.replaceFrames(frames);
    store.addAvatar();
    const avatarId = useEditorStore.getState().selectedLayerId!;
    store.updateFramePos(avatarId, 0, [1, 2, 3, 4]);
    store.updateFramePos(avatarId, 1, [5, 6, 7, 8]);
    store.updateFramePos(avatarId, 2, [9, 10, 11, 12]);
    store.setFrameIndex(2);

    store.removeFrame(1);
    const state = useEditorStore.getState();
    const avatar = state.layers.find((layer) => layer.id === avatarId) as AvatarLayer;
    expect(state.frames).toEqual([frames[0], frames[2]]);
    expect(state.frameIndex).toBe(1);
    expect(avatar.perFramePos).toEqual([
      [1, 2, 3, 4],
      [9, 10, 11, 12],
    ]);

    state.reset();
  });

  it("删除最后一帧会回到空白模板并保留元信息", () => {
    const store = useEditorStore.getState();
    store.reset();
    store.setMeta({ key: "保留名称", alias: "测试", reverse: true });
    store.replaceFrames([createCanvas(100, 100)]);
    store.addText();

    store.removeFrame(0);
    const state = useEditorStore.getState();
    expect(state.frames).toEqual([]);
    expect(state.canvasSize).toEqual({ width: 0, height: 0 });
    expect(state.layers).toEqual([]);
    expect(state.meta).toMatchObject({ key: "保留名称", alias: "测试", reverse: true });

    state.reset();
  });

  it("在当前帧后插入背景时会复制头像当前位置并选中新帧", () => {
    const store = useEditorStore.getState();
    store.reset();
    const frames = [createCanvas(100, 100), createCanvas(100, 100), createCanvas(100, 100)];
    const inserted = [createCanvas(100, 100), createCanvas(100, 100)];
    store.replaceFrames(frames);
    store.addAvatar();
    const avatarId = useEditorStore.getState().selectedLayerId!;
    store.updateFramePos(avatarId, 0, [1, 2, 3, 4]);
    store.updateFramePos(avatarId, 1, [5, 6, 7, 8]);
    store.updateFramePos(avatarId, 2, [9, 10, 11, 12]);
    store.setFrameIndex(1);

    store.insertFrames(1, inserted);
    const state = useEditorStore.getState();
    const avatar = state.layers.find((layer) => layer.id === avatarId) as AvatarLayer;
    expect(state.frames).toEqual([frames[0], frames[1], inserted[0], inserted[1], frames[2]]);
    expect(state.frameIndex).toBe(2);
    expect(avatar.perFramePos).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
      [5, 6, 7, 8],
      [5, 6, 7, 8],
      [9, 10, 11, 12],
    ]);

    state.reset();
  });

  it("替换当前帧只更新目标背景，保留图层和模板信息", () => {
    const store = useEditorStore.getState();
    store.reset();
    const frames = [createCanvas(100, 100), createCanvas(100, 100), createCanvas(100, 100)];
    const replacement = createCanvas(100, 100);
    store.setMeta({ key: "保留名称", fps: 20, alias: "测试", reverse: true });
    store.replaceFrames(frames);
    store.addAvatar();
    const layersBefore = useEditorStore.getState().layers;

    store.replaceFrame(1, replacement);
    const state = useEditorStore.getState();
    expect(state.frames).toEqual([frames[0], replacement, frames[2]]);
    expect(state.layers).toBe(layersBefore);
    expect(state.meta).toEqual({
      key: "保留名称",
      fps: 20,
      alias: "测试",
      reverse: true,
      inRandomList: false,
    });

    state.reset();
  });

  it("移动背景帧会同步头像位置并让当前预览跟随同一帧", () => {
    const store = useEditorStore.getState();
    store.reset();
    const frames = [createCanvas(100, 100), createCanvas(100, 100), createCanvas(100, 100)];
    store.setMeta({ key: "保留名称", fps: 20, alias: "测试", reverse: true });
    store.replaceFrames(frames);
    store.addAvatar();
    const avatarId = useEditorStore.getState().selectedLayerId!;
    store.updateFramePos(avatarId, 0, [1, 2, 3, 4]);
    store.updateFramePos(avatarId, 1, [5, 6, 7, 8]);
    store.updateFramePos(avatarId, 2, [9, 10, 11, 12]);
    store.setFrameIndex(1);

    store.moveFrame(0, 2);
    let state = useEditorStore.getState();
    let avatar = state.layers.find((layer) => layer.id === avatarId) as AvatarLayer;
    expect(state.frames).toEqual([frames[1], frames[2], frames[0]]);
    expect(state.frameIndex).toBe(0);
    expect(avatar.perFramePos).toEqual([
      [5, 6, 7, 8],
      [9, 10, 11, 12],
      [1, 2, 3, 4],
    ]);
    expect(state.canvasSize).toEqual({ width: 100, height: 100 });
    expect(state.meta).toMatchObject({ key: "保留名称", fps: 20, alias: "测试", reverse: true });

    state.moveFrame(0, 2);
    state = useEditorStore.getState();
    avatar = state.layers.find((layer) => layer.id === avatarId) as AvatarLayer;
    expect(state.frames).toEqual([frames[2], frames[0], frames[1]]);
    expect(state.frameIndex).toBe(2);
    expect(avatar.perFramePos).toEqual([
      [9, 10, 11, 12],
      [1, 2, 3, 4],
      [5, 6, 7, 8],
    ]);

    state.reset();
  });
});

describe("compileTemplate: 头像图层", () => {
  it("单帧 pos 展平为 [x,y,w,h]", () => {
    const t = compileTemplate(
      makeState({ layers: [makeAvatar({ perFramePos: [[10, 20, 30, 40]] })] }),
    );
    expect(t.avatar[0].pos).toEqual([10, 20, 30, 40]);
  });

  it("多帧 pos 保持数组", () => {
    const t = compileTemplate(
      makeState({
        frames: [createCanvas(100, 100), createCanvas(100, 100)],
        layers: [
          makeAvatar({
            perFramePos: [
              [10, 20, 30, 40],
              [50, 60, 70, 80],
            ],
          }),
        ],
      }),
    );
    expect(t.avatar[0].pos).toEqual([
      [10, 20, 30, 40],
      [50, 60, 70, 80],
    ]);
  });

  it("默认值被省略", () => {
    const t = compileTemplate(makeState({ layers: [makeAvatar()] }));
    const a = t.avatar[0];
    expect(a.fit).toBeUndefined(); // FILL
    expect(a.round).toBeUndefined(); // false
    expect(a.style).toBeUndefined(); // []
    expect(a.avatarOnTop).toBeUndefined(); // true
    expect(a.angle).toBeUndefined(); // 0
    expect(a.opacity).toBeUndefined(); // 1
    expect(a.posType).toBe("ZOOM"); // 始终写出 posType
  });

  it("非默认值保留", () => {
    const t = compileTemplate(
      makeState({
        layers: [
          makeAvatar({
            fit: "CONTAIN",
            round: true,
            avatarOnTop: false,
            angle: 45,
            opacity: 0.5,
            style: ["MIRROR", "GRAY"],
          }),
        ],
      }),
    );
    const a = t.avatar[0];
    expect(a.fit).toBe("CONTAIN");
    expect(a.round).toBe(true);
    expect(a.avatarOnTop).toBe(false);
    expect(a.angle).toBe(45);
    expect(a.opacity).toBe(0.5);
    expect(a.style).toEqual(["MIRROR", "GRAY"]);
  });
});

describe("compileTemplate: 文字图层", () => {
  it("默认值被省略", () => {
    const t = compileTemplate(makeState({ layers: [makeText()] }));
    const tx = t.text[0];
    expect(tx.text).toBe("hi");
    expect(tx.pos).toEqual([10, 20]);
    expect(tx.font).toBeUndefined(); // Arial
    expect(tx.style).toBeUndefined(); // PLAIN
    expect(tx.align).toBeUndefined(); // LEFT
    expect(tx.wrap).toBeUndefined(); // NONE
    expect(tx.strokeSize).toBeUndefined(); // 0
  });

  it("非默认值保留 + 描边", () => {
    const t = compileTemplate(
      makeState({
        layers: [
          makeText({
            text: "hello",
            color: "#ff0000",
            size: 48,
            font: "Microsoft YaHei",
            style: "BOLD",
            align: "CENTER",
            wrap: "BREAK",
            strokeColor: "#000000",
            strokeSize: 3,
            angle: 10,
            pos: [50, 50, 200],
          }),
        ],
      }),
    );
    const tx = t.text[0];
    expect(tx).toMatchObject({
      text: "hello",
      color: "#ff0000",
      size: 48,
      font: "Microsoft YaHei",
      style: "BOLD",
      align: "CENTER",
      wrap: "BREAK",
      strokeColor: "#000000",
      strokeSize: 3,
      angle: 10,
      pos: [50, 50, 200],
    });
  });
});

describe("compileTemplate: 元信息", () => {
  it("delay = 1000/fps，alias 切分", () => {
    const t = compileTemplate(
      makeState({
        meta: { key: "my", fps: 20, alias: "打 拍 摸", reverse: false, inRandomList: false },
      }),
    );
    expect(t.delay).toBe(50);
    expect(t.alias).toEqual(["打", "拍", "摸"]);
    expect(t.reverse).toBeUndefined();
    expect(t.inRandomList).toBeUndefined();
  });

  it("reverse/inRandomList 为 true 时写出", () => {
    const t = compileTemplate(
      makeState({
        meta: { key: "my", fps: 15, alias: "", reverse: true, inRandomList: true },
      }),
    );
    expect(t.reverse).toBe(true);
    expect(t.inRandomList).toBe(true);
    expect(t.alias).toBeUndefined(); // 空别名
  });

  it("key 不写入模板 JSON", () => {
    const t = compileTemplate(
      makeState({
        meta: { key: "my-key", fps: 15, alias: "", reverse: false, inRandomList: false },
      }),
    );
    expect(t.key).toBeUndefined();
  });
});

describe("compileTemplate：与引擎数据结构往返一致", () => {
  it("复杂模板能被 parseTemplate 解析回来", () => {
    const state = makeState({
      frames: [createCanvas(100, 100), createCanvas(100, 100)],
      layers: [
        makeAvatar({
          type: "FROM",
          fit: "COVER",
          round: true,
          style: ["MIRROR"],
          perFramePos: [
            [10, 10, 50, 50],
            [20, 20, 60, 60],
          ],
        }),
        makeText({ text: "测试", wrap: "BREAK", pos: [30, 40, 150], size: 24 }),
      ],
      meta: { key: "demo", fps: 10, alias: "测试 demo", reverse: true, inRandomList: false },
    });
    const compiled = compileTemplate(state);
    // 不抛错即通过（数据结构校验 + 默认值回填）
    const parsed = parseTemplate(compiled);
    expect(parsed.type).toBe("GIF");
    expect(parsed.avatar).toHaveLength(1);
    expect(parsed.text).toHaveLength(1);
  });
});

describe("compileTemplate: 旋转原点语义", () => {
  // 回归：Fabric 预览围绕对象中心旋转，引擎 origin 缺省（DEFAULT）围绕 pos 左上角旋转；
  // 导出非 0 角度图层时必须显式写 origin: "CENTER"，否则主应用渲染与编辑器预览不一致（评审意见 C2）。
  it("非 0 角度图层导出时写入 origin CENTER", () => {
    const avatarOut = compileTemplate(makeState({ layers: [makeAvatar({ angle: 30 })] })).avatar[0];
    expect(avatarOut.angle).toBe(30);
    expect(avatarOut.origin).toBe("CENTER");

    const textOut = compileTemplate(makeState({ layers: [makeText({ angle: 15 })] })).text[0];
    expect(textOut.angle).toBe(15);
    expect(textOut.origin).toBe("CENTER");
  });

  it("角度为 0 时保持默认值省略约定", () => {
    const t = compileTemplate(makeState({ layers: [makeAvatar({}), makeText({})] }));
    expect(t.avatar[0].origin).toBeUndefined();
    expect(t.text[0].origin).toBeUndefined();
  });
});
