import { afterEach, describe, expect, it, vi } from "vitest";
import { TEMPLATE_FONT_FACES, loadTemplateFonts } from "../../src/lib/font-loader";
import { logger } from "../../src/lib/logger";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("font-loader", () => {
  it("覆盖模板实际使用的字体族别名", () => {
    const aliases = new Set(TEMPLATE_FONT_FACES.map((font) => font.family));

    for (const family of ["Aller", "Aller-Bold", "MiSans", "MiSans Bold", "MiSans-Bold"] as const) {
      expect(aliases.has(family)).toBe(true);
    }
  });

  it("失败的字体会在下次调用时重试", async () => {
    const attempts = new Map<string, number>();
    const add = vi.fn();
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

    class RetryableFontFace {
      constructor(readonly family: string) {}

      async load(): Promise<this> {
        const attempt = (attempts.get(this.family) ?? 0) + 1;
        attempts.set(this.family, attempt);
        if (attempt === 1) throw new Error("暂时不可用");
        return this;
      }
    }

    vi.stubGlobal("document", { fonts: { add } });
    vi.stubGlobal("FontFace", RetryableFontFace);

    await loadTemplateFonts();
    await loadTemplateFonts();

    expect([...attempts.values()]).toEqual(TEMPLATE_FONT_FACES.map(() => 2));
    expect(add).toHaveBeenCalledTimes(TEMPLATE_FONT_FACES.length);
    expect(warn).toHaveBeenCalledTimes(TEMPLATE_FONT_FACES.length);
  });
});
