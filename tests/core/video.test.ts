import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAvatarResourceBudget,
  decodeVideo,
  getRuntime,
  parseTemplate,
  setRuntime,
} from "../../src/core";
import { prepareAvatar, reserveAvatarSceneResources } from "../../src/core/renderer/avatar";

describe("decodeVideo 资源预算", () => {
  const video = new Blob(["video"], { type: "video/mp4" });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function installVideoElement(
    width = 2,
    height = 2,
  ): {
    readonly listenedEvents: string[];
    readonly currentTimeWrites: number;
    readonly preload: string;
    readonly isFakeVideo: (value: unknown) => boolean;
    readonly currentTimeOf: (value: unknown) => number;
  } {
    const listenedEvents: string[] = [];
    let currentTimeWrites = 0;
    let createdElement: FakeVideoElement | null = null;

    class FakeVideoElement extends EventTarget {
      #currentTime = 0;
      duration = 1;
      videoWidth = width;
      videoHeight = height;
      muted = false;
      playsInline = false;
      preload = "";

      override addEventListener(
        type: string,
        callback: EventListenerOrEventListenerObject | null,
        options?: boolean | AddEventListenerOptions,
      ): void {
        listenedEvents.push(type);
        super.addEventListener(type, callback, options);
      }

      set src(_value: string) {
        queueMicrotask(() => {
          this.dispatchEvent(new Event("loadedmetadata"));
          this.dispatchEvent(new Event("loadeddata"));
        });
      }

      get currentTime() {
        return this.#currentTime;
      }

      set currentTime(value: number) {
        this.#currentTime = value;
        currentTimeWrites += 1;
        queueMicrotask(() => this.dispatchEvent(new Event("seeked")));
      }
    }

    vi.stubGlobal("document", {
      createElement: () => {
        createdElement = new FakeVideoElement();
        return createdElement;
      },
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:video-test");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    return {
      listenedEvents,
      get currentTimeWrites() {
        return currentTimeWrites;
      },
      get preload() {
        return createdElement?.preload ?? "";
      },
      isFakeVideo: (value) => value instanceof FakeVideoElement,
      currentTimeOf: (value) =>
        value instanceof FakeVideoElement ? value.currentTime : Number.NaN,
    };
  }

  it.each([Number.NaN, 0, 1.5])("在访问 DOM 前拒绝无效帧数 %s", async (frameCount) => {
    await expect(decodeVideo(video, frameCount)).rejects.toThrow(/视频帧数无效/);
  });

  it("在访问 DOM 前拒绝超过场景上限的帧数", async () => {
    await expect(decodeVideo(video, 513)).rejects.toThrow(/视频帧数过多/);
  });

  it("在抽帧画布分配前拒绝超过边长预算的视频", async () => {
    const state = installVideoElement();
    const runtime = getRuntime();
    let createCanvasCalls = 0;
    setRuntime({
      ...runtime,
      createCanvas: (width, height) => {
        createCanvasCalls += 1;
        return runtime.createCanvas(width, height);
      },
    });
    try {
      await expect(decodeVideo(video, 1, { maxEdge: 1 })).rejects.toThrow(/视频尺寸过大/);
      expect(createCanvasCalls).toBe(0);
      expect(state.preload).toBe("metadata");
      expect(state.listenedEvents[0]).toBe("loadedmetadata");
      expect(state.currentTimeWrites).toBe(0);
    } finally {
      setRuntime(runtime);
    }
  });

  it("在抽帧画布分配前拒绝超过总像素预算的视频", async () => {
    installVideoElement();

    await expect(decodeVideo(video, 2, { maxTotalPixels: 7 })).rejects.toThrow(
      /视频解码像素总量过大/,
    );
  });

  it("在抽帧画布分配前拒绝超过内存预算的视频", async () => {
    installVideoElement();

    await expect(decodeVideo(video, 2, { maxMemoryBytes: 31 })).rejects.toThrow(
      /视频解码内存预算超限/,
    );
  });

  it("把当前视频解码表面计入峰值并在 seek 与 Canvas 分配前拒绝", async () => {
    const state = installVideoElement();
    const runtime = getRuntime();
    let createCanvasCalls = 0;
    setRuntime({
      ...runtime,
      createCanvas(width, height) {
        createCanvasCalls += 1;
        return {
          width,
          height,
          getContext: () => ({ drawImage: () => undefined }),
        } as unknown as HTMLCanvasElement;
      },
    });

    try {
      await expect(decodeVideo(video, 2, { maxMemoryBytes: 32 })).rejects.toThrow(
        /视频解码内存预算超限：48/,
      );
      expect(state.currentTimeWrites).toBe(0);
      expect(createCanvasCalls).toBe(0);
    } finally {
      setRuntime(runtime);
    }
  });

  it("视频解码表面超限时保留场景外部占用上下文", async () => {
    const state = installVideoElement();
    const runtime = getRuntime();
    setRuntime({
      ...runtime,
      createCanvas: (width, height) =>
        ({
          width,
          height,
          getContext: () => ({ drawImage: () => undefined }),
        }) as unknown as HTMLCanvasElement,
    });
    const budget = createAvatarResourceBudget({
      maxFrames: 10,
      maxEdge: 4096,
      maxTotalPixels: 100,
      maxMemoryBytes: 51,
    });
    reserveAvatarSceneResources(budget, 1);
    const template = parseTemplate({
      type: "IMG",
      avatar: [
        {
          type: "TO",
          pos: [
            [0, 0, 1, 1],
            [0, 0, 1, 1],
          ],
        },
      ],
    }).avatar[0];

    try {
      await expect(
        prepareAvatar(template, { to: video }, 2, undefined, { resourceBudget: budget }),
      ).rejects.toThrow(/场景累计内存预算超限：外部资源已占 4 字节；视频解码内存预算超限：48/);
      expect(state.currentTimeWrites).toBe(0);
    } finally {
      setRuntime(runtime);
    }
  });

  it.each([Number.NaN, 0])("在访问 DOM 前拒绝无效内存预算 %s", async (maxMemoryBytes) => {
    await expect(decodeVideo(video, 1, { maxMemoryBytes })).rejects.toThrow(/视频内存预算无效/);
  });

  it("使用调用方给出的更小帧数预算", async () => {
    installVideoElement();

    await expect(decodeVideo(video, 2, { maxFrames: 1 })).rejects.toThrow(/视频帧数过多/);
  });

  it("视频抽出的每一帧使用同一百分比取景区域", async () => {
    const state = installVideoElement(8, 4);
    const runtime = getRuntime();
    setRuntime({
      ...runtime,
      createCanvas(width, height) {
        const canvas = runtime.createCanvas(width, height);
        const ctx = canvas.getContext("2d")!;
        const drawImage = ctx.drawImage.bind(ctx) as (...args: unknown[]) => void;
        ctx.drawImage = ((source: CanvasImageSource, ...args: number[]) => {
          if (state.isFakeVideo(source)) {
            ctx.fillStyle = "#ff0000";
            ctx.fillRect(0, 0, width / 2, height);
            ctx.fillStyle = state.currentTimeOf(source) < 0.5 ? "#00ff00" : "#0000ff";
            ctx.fillRect(width / 2, 0, width / 2, height);
            return;
          }
          drawImage(source, ...args);
        }) as typeof ctx.drawImage;
        return canvas;
      },
    });
    const template = parseTemplate({
      type: "GIF",
      avatar: [
        {
          type: "TO",
          pos: [
            [0, 0, 4, 4],
            [0, 0, 4, 4],
          ],
        },
      ],
      background: { size: [4, 4] },
    }).avatar[0];

    try {
      const prepared = await prepareAvatar(template, {
        to: {
          blob: video,
          crop: { x: 50, y: 0, width: 50, height: 100 },
        },
      });

      expect(prepared.frames).toHaveLength(2);
      expect(prepared.frames[0]).toMatchObject({ width: 4, height: 4 });
      expect(prepared.frames[1]).toMatchObject({ width: 4, height: 4 });
      const firstPixel = prepared.frames[0].getContext("2d")!.getImageData(0, 0, 1, 1).data;
      const secondPixel = prepared.frames[1].getContext("2d")!.getImageData(0, 0, 1, 1).data;
      expect(Array.from(firstPixel)).toEqual([0, 255, 0, 255]);
      expect(Array.from(secondPixel)).toEqual([0, 0, 255, 255]);
    } finally {
      setRuntime(runtime);
    }
  });
});
