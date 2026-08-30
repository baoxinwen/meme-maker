// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { applyTextProps } from "../../src/lib/editor/fabric-utils";
import type { TextLayer } from "../../src/stores/editor-store";

function makeTextLayer(o: Partial<TextLayer> = {}): TextLayer {
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
    pos: [120, 80],
    ...o,
  };
}

/** 只实现 applyTextProps 用到的最小对象面（fabric.IText 在 jsdom 无法实例化）。 */
function makeStubText() {
  return {
    set: vi.fn(),
    setCoords: vi.fn(),
    dirty: false,
  };
}

describe("applyTextProps 的位置同步", () => {
  // 回归：图层 effect 对已存在的文字对象只调 applyTextProps，若它不回写 left/top，
  // 属性面板改 X/Y、方向键移动、撤销/重做都不会移动画布文字（评审意见 C3）。
  it("把图层 pos 写入 left/top 并刷新坐标", () => {
    const obj = makeStubText();
    applyTextProps(obj as unknown as Parameters<typeof applyTextProps>[0], makeTextLayer());

    expect(obj.set).toHaveBeenCalledWith(expect.objectContaining({ left: 120, top: 80 }));
    expect(obj.setCoords).toHaveBeenCalled();
  });
});
