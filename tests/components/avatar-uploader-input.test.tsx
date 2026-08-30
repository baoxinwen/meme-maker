// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AvatarUploader } from "../../src/components/avatar-uploader";
import { TooltipProvider } from "../../src/components/ui/tooltip";
import { type AvatarSource, FULL_AVATAR_CROP, parseTemplate } from "../../src/core";

function animatedGif(): Blob {
  const base64 =
    "R0lGODlhAQABAPAAAP8AAAAA/yH/C05FVFNDQVBFMi4wAwEAAAAh+QQACAAAACwAAAAAAQABAAAIBAABBAQAIfkEAAwAAAAsAAAAAAEAAQCA/wAAAAD/CAQAAwQEADs=";
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  const blob = new Blob([bytes], { type: "image/gif" });
  // jsdom 的 Blob 没有浏览器标准的 arrayBuffer()，为解码路径补齐同等行为。
  Object.defineProperty(blob, "arrayBuffer", {
    value: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  });
  return blob;
}

describe("头像上传格式声明", () => {
  const container = document.createElement("div");
  const root = createRoot(container);

  beforeEach(() => {
    let previewIndex = 0;
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = vi.fn(() => `blob:avatar-preview-${previewIndex++}`);
        static revokeObjectURL = vi.fn();
      },
    );
  });

  afterEach(async () => {
    await act(async () => root.render(null));
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("图片只声明受支持格式，同时保留视频头像", async () => {
    const template = parseTemplate({
      type: "IMG",
      avatar: [{ type: "TO", pos: [0, 0, 1, 1] }],
    });

    await act(async () => {
      root.render(
        <TooltipProvider>
          <AvatarUploader template={template} avatars={{}} onChange={() => undefined} />
        </TooltipProvider>,
      );
    });

    expect(container.querySelector<HTMLInputElement>('input[type="file"]')?.accept).toBe(
      "image/png,image/jpeg,image/jpg,image/webp,image/gif,video/*",
    );
  });

  it("视频素材缩略图使用 video 元素而不是 img", async () => {
    const template = parseTemplate({
      type: "IMG",
      avatar: [{ type: "TO", pos: [0, 0, 1, 1] }],
    });

    await act(async () => {
      root.render(
        <TooltipProvider>
          <AvatarUploader
            template={template}
            avatars={{
              TO: {
                blob: new Blob(["video"], { type: "video/mp4" }),
                crop: { x: 25, y: 30, width: 50, height: 40 },
              },
            }}
            onChange={() => undefined}
          />
        </TooltipProvider>,
      );
    });

    const video = container.querySelector<HTMLVideoElement>("video");
    expect(video).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(video?.muted).toBe(true);
    expect(video?.playsInline).toBe(true);
    expect(video?.preload).toBe("auto");
  });

  it("缩略图按完整 crop 矩形缩放并偏移，而不是只定位中心", async () => {
    const template = parseTemplate({
      type: "IMG",
      avatar: [{ type: "TO", pos: [0, 0, 1, 1] }],
    });

    await act(async () => {
      root.render(
        <TooltipProvider>
          <AvatarUploader
            template={template}
            avatars={{
              TO: {
                blob: new Blob(["avatar"], { type: "image/png" }),
                crop: { x: 25, y: 30, width: 50, height: 40 },
              },
            }}
            onChange={() => undefined}
          />
        </TooltipProvider>,
      );
    });

    const image = container.querySelector<HTMLImageElement>("img");
    expect(image?.style.width).toBe("200%");
    expect(image?.style.height).toBe("250%");
    expect(image?.style.left).toBe("-50%");
    expect(image?.style.top).toBe("-75%");
  });

  it("已有素材可打开取景弹窗且不会重新触发文件选择", async () => {
    const template = parseTemplate({
      type: "IMG",
      avatar: [{ type: "TO", pos: [0, 0, 1, 1] }],
    });
    const blob = new Blob(["avatar"], { type: "image/png" });
    const picker = vi.spyOn(HTMLInputElement.prototype, "click");

    await act(async () => {
      root.render(
        <TooltipProvider>
          <AvatarUploader
            template={template}
            avatars={{ TO: { blob, crop: FULL_AVATAR_CROP } }}
            onChange={() => undefined}
          />
        </TooltipProvider>,
      );
    });

    const adjust = Array.from(container.querySelectorAll("button")).find(
      (button) => button.getAttribute("aria-label") === "调整目标头像（TO）取景",
    );
    expect(adjust).toBeDefined();

    await act(async () => adjust?.click());
    expect(document.body.textContent).toContain("调整目标头像（TO）取景");
    expect(picker).not.toHaveBeenCalled();
  });

  it("浮点误差范围内的贴边 crop 在弹窗中仍可确认", async () => {
    const template = parseTemplate({
      type: "IMG",
      avatar: [{ type: "TO", pos: [0, 0, 1, 1] }],
    });
    const source: AvatarSource = {
      blob: new Blob(["avatar"], { type: "image/png" }),
      crop: { x: 89, y: 10, width: 11.00000000000001, height: 90.00000000000001 },
    };

    await act(async () => {
      root.render(
        <TooltipProvider>
          <AvatarUploader template={template} avatars={{ TO: source }} onChange={() => undefined} />
        </TooltipProvider>,
      );
    });
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="调整目标头像（TO）取景"]')
        ?.click(),
    );

    const confirm = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "确认取景",
    );
    expect(confirm?.disabled).toBe(false);
  });

  it("减少动态效果时取景视频默认暂停并提供可访问播放控制", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const template = parseTemplate({
      type: "IMG",
      avatar: [{ type: "TO", pos: [0, 0, 1, 1] }],
    });
    const source: AvatarSource = {
      blob: new Blob(["video"], { type: "video/mp4" }),
      crop: FULL_AVATAR_CROP,
    };

    await act(async () => {
      root.render(
        <TooltipProvider>
          <AvatarUploader template={template} avatars={{ TO: source }} onChange={() => undefined} />
        </TooltipProvider>,
      );
    });
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="调整目标头像（TO）取景"]')
        ?.click(),
    );

    const video = document.body.querySelector<HTMLVideoElement>("video");
    expect(video?.autoplay).toBe(false);
    expect(
      document.body.querySelector<HTMLButtonElement>('button[aria-label="播放取景预览"]'),
    ).not.toBeNull();
  });

  it("GIF 取景使用可暂停的逐帧画布并允许用户恢复播放", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const template = parseTemplate({
      type: "IMG",
      avatar: [{ type: "TO", pos: [0, 0, 1, 1] }],
    });
    const source: AvatarSource = { blob: animatedGif(), crop: FULL_AVATAR_CROP };

    await act(async () => {
      root.render(
        <TooltipProvider>
          <AvatarUploader template={template} avatars={{ TO: source }} onChange={() => undefined} />
        </TooltipProvider>,
      );
    });
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="调整目标头像（TO）取景"]')
        ?.click(),
    );

    await vi.waitFor(() => {
      const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
      expect(dialog?.querySelector('canvas[aria-label="目标头像（TO）取景预览"]')).not.toBeNull();
      expect(dialog?.querySelector("img")).toBeNull();
      expect(dialog?.querySelector('button[aria-label="播放取景预览"]')).not.toBeNull();
    });

    const play = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="播放取景预览"]',
    );
    await act(async () => play?.click());
    expect(document.body.querySelector('button[aria-label="暂停取景预览"]')).not.toBeNull();
  });

  it("确认重新取景时复用原文件且只更新百分比矩形", async () => {
    const template = parseTemplate({
      type: "IMG",
      avatar: [{ type: "TO", pos: [0, 0, 1, 1] }],
    });
    const blob = new Blob(["avatar"], { type: "image/png" });
    const source: AvatarSource = {
      blob,
      crop: { x: 10, y: 15, width: 60, height: 70 },
    };
    const onChange = vi.fn();

    await act(async () => {
      root.render(
        <TooltipProvider>
          <AvatarUploader template={template} avatars={{ TO: source }} onChange={onChange} />
        </TooltipProvider>,
      );
    });

    const adjust = container.querySelector<HTMLButtonElement>(
      'button[aria-label="调整目标头像（TO）取景"]',
    );
    await act(async () => adjust?.click());

    const reset = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent === "恢复完整画面",
    );
    await act(async () => reset?.click());
    const confirm = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent === "确认取景",
    );
    expect(confirm).toBeDefined();
    expect(confirm).not.toHaveProperty("disabled", true);
    await act(async () => confirm?.click());

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith("TO", {
      blob,
      crop: FULL_AVATAR_CROP,
    });
  });

  it("集合候选分别保存自己的取景参数", async () => {
    const template = parseTemplate({
      type: "IMG",
      avatar: [{ type: "RANDOM", pos: [0, 0, 1, 1] }],
    });
    const first: AvatarSource = {
      blob: new Blob(["first"], { type: "image/png" }),
      crop: { x: 5, y: 5, width: 40, height: 40 },
    };
    const second: AvatarSource = {
      blob: new Blob(["second"], { type: "image/png" }),
      crop: { x: 25, y: 30, width: 50, height: 60 },
    };
    const onChange = vi.fn();

    await act(async () => {
      root.render(
        <TooltipProvider>
          <AvatarUploader
            template={template}
            avatars={{ RANDOM: [first, second] }}
            onChange={onChange}
          />
        </TooltipProvider>,
      );
    });

    const adjustSecond = container.querySelector<HTMLButtonElement>(
      'button[aria-label="调整随机头像候选 2 取景"]',
    );
    await act(async () => adjustSecond?.click());
    const reset = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent === "恢复完整画面",
    );
    await act(async () => reset?.click());
    const confirm = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent === "确认取景",
    );
    await act(async () => confirm?.click());

    expect(onChange).toHaveBeenCalledWith("RANDOM", [
      first,
      { blob: second.blob, crop: FULL_AVATAR_CROP },
    ]);
  });

  it("移动和删除集合候选时取景参数跟随原文件", async () => {
    const template = parseTemplate({
      type: "IMG",
      avatar: [{ type: "USER", pos: [0, 0, 1, 1] }],
    });
    const first: AvatarSource = {
      blob: new Blob(["first"], { type: "image/png" }),
      crop: { x: 5, y: 5, width: 40, height: 40 },
    };
    const second: AvatarSource = {
      blob: new Blob(["second"], { type: "image/png" }),
      crop: { x: 25, y: 30, width: 50, height: 60 },
    };
    const onChange = vi.fn();

    await act(async () => {
      root.render(
        <TooltipProvider>
          <AvatarUploader
            template={template}
            avatars={{ USER: [first, second] }}
            onChange={onChange}
          />
        </TooltipProvider>,
      );
    });

    const moveSecond = container.querySelector<HTMLButtonElement>(
      'button[aria-label="向前移动顺序头像 2"]',
    );
    await act(async () => moveSecond?.click());
    expect(onChange).toHaveBeenLastCalledWith("USER", [second, first]);

    const deleteFirst = container.querySelector<HTMLButtonElement>(
      'button[aria-label="删除顺序头像 1"]',
    );
    await act(async () => deleteFirst?.click());
    expect(onChange).toHaveBeenLastCalledWith("USER", [second]);
  });
});
