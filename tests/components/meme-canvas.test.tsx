// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemeCanvas } from "../../src/components/meme-canvas";
import { type PreparedScene, createCanvas } from "../../src/core";

describe("表情包预览逐帧时序", () => {
  const container = document.createElement("div");
  const root = createRoot(container);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
  });

  afterEach(async () => {
    await act(async () => root.render(null));
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("按当前帧自己的延迟推进，而不是使用固定 interval", async () => {
    const background = createCanvas(2, 2);
    const scene = {
      template: { type: "GIF", avatar: [], text: [] },
      width: 2,
      height: 2,
      renderWidth: 2,
      renderHeight: 2,
      frameCount: 3,
      delay: 65,
      frameDelays: [40, 120, 80],
      reverse: false,
      backgrounds: [background],
      foregrounds: [],
      bottomAvatars: [],
      topAvatars: [],
      texts: [],
      sizeMap: {},
      maxTotalPixels: 1_000,
      maxMediaMemoryBytes: 100_000,
    } as unknown as PreparedScene;

    await act(async () => {
      root.render(<MemeCanvas scene={scene} loading={false} error={null} />);
    });

    const status = () => container.querySelector(".status-pill")?.textContent?.replaceAll(" ", "");
    expect(status()).toBe("1/3");
    await act(async () => vi.advanceTimersByTime(39));
    expect(status()).toBe("1/3");
    await act(async () => vi.advanceTimersByTime(1));
    expect(status()).toBe("2/3");
    await act(async () => vi.advanceTimersByTime(119));
    expect(status()).toBe("2/3");
    await act(async () => vi.advanceTimersByTime(1));
    expect(status()).toBe("3/3");
  });
});
