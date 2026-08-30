import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BlobUrlRegistry } from "../../src/lib/blob-url";

let nextUrl = 0;
const created: string[] = [];
const revoked: string[] = [];

beforeEach(() => {
  nextUrl = 0;
  created.length = 0;
  revoked.length = 0;
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = vi.fn(() => {
        const url = `blob:test-${nextUrl++}`;
        created.push(url);
        return url;
      });
      static revokeObjectURL = vi.fn((url: string) => {
        revoked.push(url);
      });
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BlobUrlRegistry", () => {
  // 回归：AvatarUploader 以 effect 从 value 派生 previewUrls 并整体 revoke/create，
  // 删除/重排后所有缩略图 URL 重生成、媒体元素整批重挂载（评审意见 I6）。
  it("同一 blob 返回同一 URL", () => {
    const registry = new BlobUrlRegistry();
    const blob = new Blob(["a"]);
    const first = registry.get(blob);
    expect(registry.get(blob)).toBe(first);
    expect(created).toHaveLength(1);
  });

  it("retain 只撤销不在保留集合中的 URL", () => {
    const registry = new BlobUrlRegistry();
    const blobA = new Blob(["a"]);
    const blobB = new Blob(["b"]);
    const urlA = registry.get(blobA);
    const urlB = registry.get(blobB);

    registry.retain([blobA]);

    expect(revoked).toEqual([urlB]);
    expect(registry.get(blobA)).toBe(urlA);
    expect(registry.get(blobB)).not.toBe(urlB);
  });

  it("dispose 撤销全部 URL", () => {
    const registry = new BlobUrlRegistry();
    const urlA = registry.get(new Blob(["a"]));
    const urlB = registry.get(new Blob(["b"]));

    registry.dispose();

    expect(revoked.sort()).toEqual([urlA, urlB].sort());
  });
});
