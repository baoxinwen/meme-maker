import { describe, expect, it } from "vitest";

import { buildSceneBlob } from "../../src/components/toolbar";
import { type PreparedScene, createCanvas, decodeGif } from "../../src/core";

describe("导出工具栏逐帧时序", () => {
  it("GIF 导出使用场景的逐帧延迟", async () => {
    const red = createCanvas(2, 2);
    const blue = createCanvas(2, 2);
    const redContext = red.getContext("2d")!;
    redContext.fillStyle = "#ff0000";
    redContext.fillRect(0, 0, 2, 2);
    const blueContext = blue.getContext("2d")!;
    blueContext.fillStyle = "#0000ff";
    blueContext.fillRect(0, 0, 2, 2);
    const scene = {
      template: { type: "GIF", avatar: [], text: [] },
      width: 2,
      height: 2,
      renderWidth: 2,
      renderHeight: 2,
      frameCount: 2,
      delay: 65,
      frameDelays: [40, 120],
      reverse: false,
      backgrounds: [red, blue],
      foregrounds: [],
      bottomAvatars: [],
      topAvatars: [],
      texts: [],
      sizeMap: {},
      maxTotalPixels: 1_000,
      maxMediaMemoryBytes: 100_000,
    } as unknown as PreparedScene;

    const result = await buildSceneBlob(scene);
    if (!result) throw new Error("未命中取消条件时不应返回 null");

    expect(result.ext).toBe("gif");
    expect((await decodeGif(result.blob)).delays).toEqual([40, 120]);
  });
});

function makeScene(frameCount: number): PreparedScene {
  const canvas = createCanvas(2, 2);
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#00ff00";
  context.fillRect(0, 0, 2, 2);
  return {
    template: { type: "GIF", avatar: [], text: [] },
    width: 2,
    height: 2,
    renderWidth: 2,
    renderHeight: 2,
    frameCount,
    delay: 65,
    frameDelays: Array.from({ length: frameCount }, () => 65),
    reverse: false,
    backgrounds: Array.from({ length: frameCount }, () => canvas),
    foregrounds: [],
    bottomAvatars: [],
    topAvatars: [],
    texts: [],
    sizeMap: {},
    maxTotalPixels: 1_000_000,
    maxMediaMemoryBytes: 100_000_000,
  } as unknown as PreparedScene;
}

describe("导出的模板切换取消", () => {
  // 回归：导出期间可切换模板，闭包持有旧 scene 继续跑完，
  // 完成后把旧模板文件下载/写入剪贴板（评审意见 I7）。
  it("shouldAbort 命中后中止渲染并返回 null", async () => {
    let calls = 0;
    const result = await buildSceneBlob(makeScene(3), {
      shouldAbort: () => {
        calls += 1;
        return calls >= 2;
      },
    });

    expect(result).toBeNull();
  });

  it("未命中 shouldAbort 时正常产出", async () => {
    const result = await buildSceneBlob(makeScene(2), { shouldAbort: () => false });

    expect(result?.ext).toBe("gif");
  });
});
