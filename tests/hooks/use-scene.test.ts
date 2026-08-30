import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { PetpetTemplate } from "../../src/core";
import { applyTextOverrides } from "../../src/hooks/use-scene";

describe("applyTextOverrides", () => {
  it("隐藏文字时保留原始索引并允许后续索引继续覆盖", () => {
    const template: PetpetTemplate = {
      type: "IMG",
      avatar: [],
      options: [],
      text: [{ text: "第一行" }, { text: "第二行" }, { text: "第三行" }],
    };

    const merged = applyTextOverrides(template, {
      0: { hidden: true },
      2: { text: "已覆盖" },
    });

    expect(merged.text).toHaveLength(3);
    expect(merged.text[0]).toMatchObject({ text: "第一行", when: 0 });
    expect(merged.text[1].text).toBe("第二行");
    expect(merged.text[2].text).toBe("已覆盖");
  });

  it("场景准备阶段不预渲染全部导出帧", () => {
    for (const path of ["src/hooks/use-scene.ts", "src/components/editor/preview-dialog.tsx"]) {
      expect(readFileSync(resolve(path), "utf8"), path).not.toContain("renderAllFrames");
    }
  });
});
