import { describe, expect, it, vi } from "vitest";
import {
  _resetTemplateIndexCacheForTest,
  fetchTemplate,
  fetchTemplateIndex,
  normalizeTemplateIndex,
  templateThumbnailUrl,
} from "../../src/lib/template-loader";

describe("normalizeTemplateIndex", () => {
  it("过滤带隐藏标记的模板并保留可见模板", () => {
    const index = normalizeTemplateIndex({
      version: "1.0.0",
      templates: [
        {
          key: "visible",
          type: "IMG",
          length: 1,
          alias: ["可见"],
          description: "可见模板",
          thumbnail: "preview.png",
        },
        {
          key: "hidden-template",
          type: "GIF",
          length: 2,
          alias: [],
          description: "隐藏模板",
          hidden: true,
        },
      ],
    });

    expect(index.templates.map((entry) => entry.key)).toEqual(["visible"]);
    expect(index.templates[0].thumbnail).toBe("preview.png");
    expect(templateThumbnailUrl(index.templates[0])).toBe("/data/templates/visible/preview.png");
  });

  it("拒绝含路径的缩略图文件名", () => {
    expect(() =>
      normalizeTemplateIndex({
        version: "1.0.0",
        templates: [
          {
            key: "unsafe",
            type: "IMG",
            length: 1,
            alias: [],
            description: "不安全模板",
            thumbnail: "../preview.png",
          },
        ],
      }),
    ).toThrow(/thumbnail/);
  });

  it("保留合法 revision 并用于内容寻址缩略图 URL", () => {
    const revision = "a".repeat(64);
    const index = normalizeTemplateIndex({
      version: "1.0.0",
      templates: [
        {
          key: "visible",
          type: "IMG",
          length: 1,
          alias: [],
          description: "可见模板",
          thumbnail: "preview.png",
          revision,
        },
      ],
    });

    expect(index.templates[0].revision).toBe(revision);
    expect(templateThumbnailUrl(index.templates[0])).toBe(
      `/data/template-assets/visible/${revision}/preview.png`,
    );
  });

  it("拒绝非法 revision", () => {
    expect(() =>
      normalizeTemplateIndex({
        version: "1.0.0",
        templates: [
          {
            key: "unsafe",
            type: "IMG",
            length: 1,
            alias: [],
            description: "不安全模板",
            revision: "../etc/passwd",
          },
        ],
      }),
    ).toThrow(/revision/);
  });
});

describe("fetchTemplateIndex", () => {
  it("并发调用共享同一个网络请求", async () => {
    _resetTemplateIndexCacheForTest();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: "1.0.0", templates: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const [first, second] = await Promise.all([fetchTemplateIndex(), fetchTemplateIndex()]);
      expect(first).toBe(second);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("索引请求超时时给出中文提示且不缓存失败结果", async () => {
    _resetTemplateIndexCacheForTest();
    const fetchMock = vi
      .fn()
      .mockRejectedValue(
        new DOMException("The operation was aborted due to timeout", "TimeoutError"),
      );
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(fetchTemplateIndex()).rejects.toThrow(/超时/);
      // 失败结果不允许被缓存：下一次调用必须重新发起请求。
      await expect(fetchTemplateIndex()).rejects.toThrow(/超时/);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("fetchTemplate 内容寻址", () => {
  it("带 revision 时从 /data/template-assets 读取模板资源", async () => {
    const revision = "b".repeat(64);
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ type: "IMG" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      await fetchTemplate("key", 0, revision);
      expect(fetchMock).toHaveBeenCalledWith(
        `/data/template-assets/key/${revision}/data.json`,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("revision 资源缺失时明确提示刷新页面", async () => {
    const revision = "c".repeat(64);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));

    try {
      await expect(fetchTemplate("expired", 0, revision)).rejects.toThrow(/刷新页面/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("normalizeTemplateIndex 容错", () => {
  // 回归：单条无效条目曾让整个索引加载失败、全部模板不可见（评审意见 M11）。
  it("跳过单条无效条目并保留其余", () => {
    const index = normalizeTemplateIndex({
      version: "1.0.0",
      templates: [
        { broken: true },
        { key: "visible", type: "IMG", length: 1, alias: ["可见"], thumbnail: "preview.png" },
      ],
    });

    expect(index.templates.map((entry) => entry.key)).toEqual(["visible"]);
  });

  it("全部无效时抛错", () => {
    expect(() =>
      normalizeTemplateIndex({ version: "1.0.0", templates: [{ broken: true }, {}] }),
    ).toThrow(/没有任何有效条目/);
  });
});
