import { beforeEach, describe, expect, it } from "vitest";

import { performRedo, performUndo } from "@/hooks/use-editor-history";
import { _resetIdCounter, useEditorStore } from "@/stores/editor-store";

function historyLength(): { past: number; future: number } {
  const temporal = useEditorStore.temporal.getState();
  return { past: temporal.pastStates.length, future: temporal.futureStates.length };
}

describe("editor-store 撤销/重做历史", () => {
  beforeEach(() => {
    _resetIdCounter();
    useEditorStore.getState().reset();
    useEditorStore.temporal.getState().clear();
  });

  it("meta 修改可撤销并可重做", () => {
    useEditorStore.getState().setMeta({ key: "renamed" });
    expect(useEditorStore.getState().meta.key).toBe("renamed");
    expect(historyLength().past).toBe(1);

    useEditorStore.temporal.getState().undo();
    expect(useEditorStore.getState().meta.key).toBe("my-template");

    useEditorStore.temporal.getState().redo();
    expect(useEditorStore.getState().meta.key).toBe("renamed");
  });

  it("图层的增删进入历史，撤销可回滚", () => {
    const { addText } = useEditorStore.getState();
    addText();
    expect(useEditorStore.getState().layers).toHaveLength(1);
    expect(historyLength().past).toBe(1);

    useEditorStore.temporal.getState().undo();
    expect(useEditorStore.getState().layers).toHaveLength(0);

    useEditorStore.temporal.getState().redo();
    expect(useEditorStore.getState().layers).toHaveLength(1);
  });

  it("文字位置修改可撤销", () => {
    useEditorStore.getState().addText();
    const layer = useEditorStore.getState().layers[0];
    if (layer.kind !== "text") throw new Error("addText 应生成文字图层");
    useEditorStore.getState().updateText(layer.id, { pos: [120, 80] });

    const after = useEditorStore.getState().layers[0];
    if (after.kind !== "text") throw new Error("图层类型不应变化");
    expect(after.pos).toEqual([120, 80]);

    useEditorStore.temporal.getState().undo();
    const restored = useEditorStore.getState().layers[0];
    if (restored.kind !== "text") throw new Error("图层类型不应变化");
    expect(restored.pos).toEqual([50, 50]);
  });

  it("瞬态状态（选中/帧序号）不进入历史", () => {
    useEditorStore.getState().addText();
    const layer = useEditorStore.getState().layers[0];
    useEditorStore.getState().setFrameIndex(0);
    useEditorStore.getState().selectLayer(layer.id);
    expect(historyLength().past).toBe(1);

    // 撤销的是 addText，而不是选中状态
    useEditorStore.temporal.getState().undo();
    expect(useEditorStore.getState().layers).toHaveLength(0);
    expect(useEditorStore.getState().selectedLayerId).toBe(layer.id);
  });

  it("历史长度受上限约束", () => {
    for (let i = 0; i < 60; i += 1) {
      useEditorStore.getState().setMeta({ alias: `alias-${i}` });
    }
    expect(historyLength().past).toBeLessThanOrEqual(50);
  });

  it("背景操作期间的变更被暂停跟踪，聚合为一条历史", () => {
    useEditorStore.temporal.getState().pause();
    useEditorStore.getState().setMeta({ alias: "解码中" });
    useEditorStore.getState().setMeta({ alias: "解码完成" });
    useEditorStore.temporal.getState().resume();

    useEditorStore.getState().setMeta({ alias: "后续修改" });
    // 只有 resume 之后的一次 set 入栈
    expect(historyLength().past).toBe(1);

    useEditorStore.temporal.getState().undo();
    expect(useEditorStore.getState().meta.alias).toBe("解码完成");
  });

  it("reset 会清空历史", () => {
    useEditorStore.getState().setMeta({ key: "again" });
    expect(historyLength().past).toBe(1);
    useEditorStore.getState().reset();
    expect(historyLength()).toEqual({ past: 0, future: 0 });
  });
});

describe("撤销/重做的 busy 守卫", () => {
  // 回归：zundo 的 undo/redo 不受 pause() 影响，键盘快捷键若不检查
  // isBackgroundOperationInProgress，后台导入期间会弹历史并被导入覆盖（评审意见 I1）。
  beforeEach(() => {
    _resetIdCounter();
    useEditorStore.getState().reset();
    useEditorStore.temporal.getState().clear();
  });

  it("后台操作进行中时 performUndo 不弹历史", () => {
    useEditorStore.getState().setMeta({ key: "renamed" });
    expect(historyLength().past).toBe(1);

    useEditorStore.setState({ isBackgroundOperationInProgress: true });
    try {
      performUndo();
      expect(useEditorStore.getState().meta.key).toBe("renamed");
      expect(historyLength().past).toBe(1);
    } finally {
      useEditorStore.setState({ isBackgroundOperationInProgress: false });
    }
  });

  it("后台操作进行中时 performRedo 不弹历史", () => {
    useEditorStore.getState().setMeta({ key: "renamed" });
    useEditorStore.temporal.getState().undo();
    expect(historyLength().future).toBe(1);

    useEditorStore.setState({ isBackgroundOperationInProgress: true });
    try {
      performRedo();
      expect(useEditorStore.getState().meta.key).toBe("my-template");
      expect(historyLength().future).toBe(1);
    } finally {
      useEditorStore.setState({ isBackgroundOperationInProgress: false });
    }
  });
});
