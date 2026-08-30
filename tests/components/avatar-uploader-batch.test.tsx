// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AvatarUploader } from "../../src/components/avatar-uploader";
import { TooltipProvider } from "../../src/components/ui/tooltip";
import type { PetpetTemplate } from "../../src/core";
import { createAvatarSource } from "../../src/stores/meme-store";
import type { AvatarState, AvatarValue } from "../../src/stores/meme-store";

vi.mock("@/lib/upload-limits", () => ({
  SUPPORTED_IMAGE_ACCEPT: "image/png,image/gif",
  assertUploadCollection: vi.fn(),
  validateAvatarFile: vi.fn(async () => undefined),
}));

function pngFile(name: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });
}

let previewIndex = 0;

beforeEach(() => {
  previewIndex = 0;
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

const template = {
  type: "IMG",
  avatar: [{ type: "RANDOM", pos: [0, 0, 10, 10] }],
  text: [],
} as unknown as PetpetTemplate;

const container = document.createElement("div");
const root = createRoot(container);

async function renderWith(avatars: AvatarState, onChange?: (value: AvatarValue) => void) {
  await act(async () => {
    root.render(
      <TooltipProvider>
        <AvatarUploader
          template={template}
          avatars={avatars}
          onChange={(_type, value) => onChange?.(value)}
        />
      </TooltipProvider>,
    );
  });
}

function fileInput(): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("找不到文件输入框");
  return input;
}

async function dispatchFiles(files: File[]) {
  const input = fileInput();
  Object.defineProperty(input, "files", { value: files, configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function candidateSrcs(): string[] {
  const row = container.querySelector('[data-testid="random-avatar-candidates"]');
  if (!row) return [];
  return [...row.querySelectorAll<HTMLImageElement>("img")].map((img) => img.src);
}

describe("头像上传并发互斥", () => {
  // 回归：accept 闭包捕获渲染时的 candidates，校验进行中（秒级窗口）拖入第二批
  // 会以旧 candidates 计算并整体覆盖第一批，已通过校验的文件被静默丢弃（评审意见 I5）。
  it("校验进行中忽略并发上传的第二批文件", async () => {
    const changes: AvatarValue[] = [];
    await renderWith({}, (value) => changes.push(value));

    const fileA = pngFile("a.png");
    const fileB = pngFile("b.png");
    // 两次 change 在同一批次内同步派发：第二批必须命中互斥守卫
    await act(async () => {
      const input = fileInput();
      Object.defineProperty(input, "files", { value: [fileA], configurable: true });
      input.dispatchEvent(new Event("change", { bubbles: true }));
      Object.defineProperty(input, "files", { value: [fileB], configurable: true });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {});

    expect(changes).toHaveLength(1);
    const accepted = changes[0] as { blob: Blob }[];
    expect(accepted).toHaveLength(1);
    expect(accepted[0].blob).toBe(fileA);
  });
});

describe("候选缩略图 URL 稳定性", () => {
  // 回归：previewUrls 由 effect 从 value 重建并以 URL 作 key，删除候选后
  // 其余缩略图 URL 全部重生成、媒体元素整批重挂载（评审意见 I6）。
  it("删除候选后其余缩略图保持原 URL", async () => {
    await renderWith({}, () => undefined);

    const fileA = pngFile("a.png");
    const fileB = pngFile("b.png");
    const fileC = pngFile("c.png");
    await dispatchFiles([fileA, fileB, fileC]);
    await renderWith({
      RANDOM: [createAvatarSource(fileA), createAvatarSource(fileB), createAvatarSource(fileC)],
    });

    const before = candidateSrcs();
    expect(before).toHaveLength(3);

    // 删除第一个候选，B/C 的 URL 必须保持不变
    const deleteFirst = container.querySelector<HTMLButtonElement>(
      '[data-testid="random-avatar-delete-0"]',
    );
    expect(deleteFirst).not.toBeNull();
    await act(async () => {
      deleteFirst!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await renderWith({ RANDOM: [createAvatarSource(fileB), createAvatarSource(fileC)] });

    const after = candidateSrcs();
    expect(after).toHaveLength(2);
    expect(after[0]).toBe(before[1]);
    expect(after[1]).toBe(before[2]);
  });
});
