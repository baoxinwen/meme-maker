// @vitest-environment jsdom

import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  decodeGif: vi.fn(),
  loadValidatedImage: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/core", async () => {
  const actual = await vi.importActual<typeof import("@/core")>("@/core");
  return { ...actual, decodeGif: mocks.decodeGif };
});

vi.mock("@/lib/upload-limits", async () => {
  const actual = await vi.importActual<typeof import("@/lib/upload-limits")>("@/lib/upload-limits");
  return { ...actual, loadValidatedImage: mocks.loadValidatedImage };
});

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}));

import { FrameUploader } from "../../src/components/editor/frame-uploader";
import { TooltipProvider } from "../../src/components/ui/tooltip";
import { createCanvas } from "../../src/core";
import { UPLOAD_LIMITS } from "../../src/lib/upload-limits";
import { useEditorStore } from "../../src/stores/editor-store";

function frame(width = 1, height = 1): HTMLCanvasElement {
  return { width, height } as HTMLCanvasElement;
}

function setInputFiles(input: HTMLInputElement, files: readonly File[]): void {
  Object.defineProperty(input, "files", { configurable: true, value: files });
}

describe("背景上传解码预算", () => {
  let root: Root;

  beforeAll(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    useEditorStore.getState().reset();
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.querySelector("#root")!);
    await act(async () => {
      root.render(
        <TooltipProvider>
          <FrameUploader compact />
        </TooltipProvider>,
      );
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
  });

  async function upload(testId: string, files: readonly File[]): Promise<void> {
    const input = document.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`)!;
    setInputFiles(input, files);
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await vi.waitFor(() => expect(mocks.decodeGif).toHaveBeenCalled());
    await vi.waitFor(() =>
      expect(useEditorStore.getState().isBackgroundOperationInProgress).toBe(false),
    );
  }

  it("添加背景时先扣除 store 中已有帧", async () => {
    useEditorStore.setState({ frames: Array.from({ length: 119 }, () => frame()), frameIndex: 0 });
    mocks.decodeGif.mockResolvedValue({ frames: [frame(), frame()], delays: [100, 100] });
    const gif = new File(["gif"], "next.gif", { type: "image/gif" });

    await upload("background-add-input", [gif]);

    expect(mocks.decodeGif).toHaveBeenCalledWith(gif, {
      maxFrames: 1,
      maxEdge: UPLOAD_LIMITS.imageMaxEdge,
      maxTotalPixels: UPLOAD_LIMITS.backgroundMaxTotalPixels - 119,
      maxMemoryBytes: UPLOAD_LIMITS.backgroundMaxMemoryBytes - 119 * 4,
    });
  });

  it("静态图片会扣减后续 GIF 可用的帧、像素和内存", async () => {
    useEditorStore.setState({ frames: [frame(2, 3)], frameIndex: 0 });
    mocks.loadValidatedImage.mockResolvedValue(createCanvas(2, 3));
    mocks.decodeGif.mockResolvedValue({ frames: [frame(2, 3)], delays: [100] });
    const image = new File(["png"], "1.png", { type: "image/png" });
    const gif = new File(["gif"], "2.gif", { type: "image/gif" });

    await upload("background-add-input", [gif, image]);

    expect(mocks.decodeGif).toHaveBeenCalledWith(gif, {
      maxFrames: UPLOAD_LIMITS.backgroundMaxFiles - 2,
      maxEdge: UPLOAD_LIMITS.imageMaxEdge,
      maxTotalPixels: UPLOAD_LIMITS.backgroundMaxTotalPixels - 12,
      maxMemoryBytes: UPLOAD_LIMITS.backgroundMaxMemoryBytes - 48,
    });
  });

  it("替换当前帧时释放旧帧预算并限制 GIF 为单帧", async () => {
    const target = frame(10, 10);
    useEditorStore.setState({
      frames: [target, ...Array.from({ length: 119 }, () => frame())],
      frameIndex: 0,
    });
    mocks.decodeGif.mockResolvedValue({ frames: [frame(10, 10)], delays: [100] });
    const gif = new File(["gif"], "replacement.gif", { type: "image/gif" });

    await upload("background-replace-input", [gif]);

    expect(mocks.decodeGif).toHaveBeenCalledWith(gif, {
      maxFrames: 1,
      maxEdge: UPLOAD_LIMITS.imageMaxEdge,
      maxTotalPixels: UPLOAD_LIMITS.backgroundMaxTotalPixels - 119,
      maxMemoryBytes: UPLOAD_LIMITS.backgroundMaxMemoryBytes - 119 * 4,
    });
  });

  it("多文件解码中途失败时不修改 store", async () => {
    const existing = frame();
    useEditorStore.setState({ frames: [existing], frameIndex: 0 });
    mocks.decodeGif
      .mockResolvedValueOnce({ frames: [frame()], delays: [100] })
      .mockRejectedValueOnce(new Error("第二个 GIF 损坏"));
    const first = new File(["gif"], "1.gif", { type: "image/gif" });
    const second = new File(["gif"], "2.gif", { type: "image/gif" });

    await upload("background-add-input", [first, second]);

    expect(useEditorStore.getState().frames).toEqual([existing]);
    expect(mocks.toastError).toHaveBeenCalledWith(expect.stringMatching(/第二个 GIF 损坏/));
  });

  it("允许添加到恰好 120 帧", async () => {
    useEditorStore.setState({ frames: Array.from({ length: 119 }, () => frame()), frameIndex: 0 });
    mocks.decodeGif.mockResolvedValue({ frames: [frame()], delays: [100] });
    const gif = new File(["gif"], "last.gif", { type: "image/gif" });

    await upload("background-add-input", [gif]);

    expect(useEditorStore.getState().frames).toHaveLength(120);
    expect(mocks.toastSuccess).toHaveBeenCalledWith("已在当前帧后添加 1 帧背景");
  });

  it("所有背景文件入口只声明受支持的图片格式", () => {
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'));

    expect(inputs).toHaveLength(2);
    expect(inputs.map((input) => input.accept)).toEqual(
      Array.from({ length: 2 }, () => "image/png,image/jpeg,image/jpg,image/webp,image/gif"),
    );
  });
});
