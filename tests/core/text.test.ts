import { describe, expect, it } from "vitest";
import * as textRenderer from "../../src/core/renderer/text";
import { createCanvas, getRuntime, setRuntime } from "../../src/core/utils/runtime";

const { createMeasureContext, drawText, layoutText, measureTextDeformTemporaryPixels } =
  textRenderer;

const DEFORM_CORNERS: [[number, number], [number, number], [number, number], [number, number]] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

function createCodeUnitMeasureContext() {
  const measureCtx = createMeasureContext();
  Object.defineProperty(measureCtx, "measureText", {
    configurable: true,
    value: (text: string) =>
      ({
        width: text.length,
        actualBoundingBoxAscent: 10,
        actualBoundingBoxDescent: 2,
      }) as TextMetrics,
  });
  return measureCtx;
}

function layoutWrappedText(text: string, maxWidth: number, mode: "BREAK" | "AREA") {
  const measureCtx = createCodeUnitMeasureContext();
  if (mode === "AREA") {
    return layoutText(
      {
        text,
        area: [0, 0, maxWidth, 10_000],
        minSize: 1,
        maxSize: 1,
      },
      measureCtx,
    );
  }
  return layoutText(
    {
      text,
      pos: [0, 0, maxWidth],
      size: 16,
      wrap: "BREAK",
    },
    measureCtx,
  );
}

describe("文字区域自动字号", () => {
  it("在区域内自动换行并限制字号", () => {
    const prepared = layoutText(
      {
        text: "一段需要在有限区域内自动换行的测试文字",
        area: [10, 20, 150, 90],
        minSize: 12,
        maxSize: 40,
        align: "CENTER",
        color: "#112233",
        strokeColor: "#ffffff",
        strokeSize: 2,
      },
      createMeasureContext(),
    );

    const size = Number(prepared.fontString.match(/(\d+(?:\.\d+)?)px/)?.[1]);
    expect(size).toBeGreaterThanOrEqual(12);
    expect(size).toBeLessThanOrEqual(40);
    expect(prepared.lines.length).toBeGreaterThan(1);
    expect(prepared.bboxWidth).toBeLessThanOrEqual(140);
    expect(prepared.bboxHeight).toBeLessThanOrEqual(70);
    expect(prepared.textBaseline).toBe("alphabetic");
  });

  it("绘制区域文字时保持描边与可见像素", () => {
    const prepared = layoutText(
      {
        text: "测试",
        area: [0, 0, 120, 60],
        minSize: 12,
        maxSize: 32,
        color: "#ff0000",
        strokeColor: "#000000",
        strokeSize: 2,
      },
      createMeasureContext(),
    );
    const canvas = createCanvas(120, 60);
    drawText(canvas.getContext("2d")!, prepared);
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, 120, 60).data;

    expect(pixels.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
  });

  it("拒绝超出预算的区域最大字号", () => {
    expect(() =>
      layoutText(
        { text: "字号预算", area: [0, 0, 100, 1], minSize: 1, maxSize: 2_048 },
        createMeasureContext(),
      ),
    ).toThrow(/文字字号过大/);
  });

  it("区域自动换行同样限制生成行数", () => {
    // 用确定性度量桩：真实字体在部分平台的 1px 字号下每行可容纳 2 个字符，
    // 行数不会超过上限，断言会随平台漂移
    expect(() =>
      layoutText(
        { text: "a".repeat(300), area: [0, 0, 1, 10_000], minSize: 1, maxSize: 1 },
        createCodeUnitMeasureContext(),
      ),
    ).toThrow(/文字行数过多/);
  });

  it("候选字号换行超限时继续尝试更小字号", () => {
    const prepared = layoutText(
      {
        text: "a".repeat(300),
        area: [0, 0, 200, 1_000],
        minSize: 1,
        maxSize: 1_024,
      },
      createMeasureContext(),
    );

    expect(prepared.lines.length).toBeLessThanOrEqual(256);
  });

  it("拒绝超过长度预算的文字", () => {
    expect(() => layoutText({ text: "a".repeat(4_097) }, createMeasureContext())).toThrow(
      /文字长度过长/,
    );
  });

  it("拒绝原始或换行后的超多行文字", () => {
    expect(() =>
      layoutText(
        { text: Array.from({ length: 257 }, () => "a").join("\n") },
        createMeasureContext(),
      ),
    ).toThrow(/文字行数过多/);

    expect(() =>
      layoutText({ text: "a".repeat(300), pos: [0, 0, 1], wrap: "BREAK" }, createMeasureContext()),
    ).toThrow(/文字行数过多/);
  });
});

describe("文字变形画布预算", () => {
  it.each([
    ["NaN", "0 / 0"],
    ["Infinity", "1 / 0"],
    ["非安全整数", "9007199254740992"],
    ["小数", 1.5],
    ["零", 0],
    ["负数", -1],
  ])("布局时拒绝%s尺寸", (_name, width) => {
    expect(() =>
      layoutText(
        {
          text: "变形文字",
          deform: DEFORM_CORNERS,
          deformSize: [width, 1],
        },
        createMeasureContext(),
      ),
    ).toThrow(/文字变形画布尺寸无效/);
  });

  it("布局时拒绝超过媒体单边上限的尺寸", () => {
    expect(() =>
      layoutText(
        {
          text: "变形文字",
          deform: DEFORM_CORNERS,
          deformSize: ["4096 + 1", 1],
        },
        createMeasureContext(),
      ),
    ).toThrow(/文字变形画布尺寸过大/);
  });

  it("绘制被篡改文字时在分配本地画布前拒绝非法尺寸", () => {
    const target = createCanvas(8, 8);
    const prepared = layoutText({ text: "变形文字" }, createMeasureContext());
    const runtime = getRuntime();
    let allocationCount = 0;
    setRuntime({
      ...runtime,
      createCanvas(width, height) {
        allocationCount++;
        return runtime.createCanvas(width, height);
      },
    });

    let caught: unknown;
    try {
      drawText(target.getContext("2d")!, {
        ...prepared,
        deform: {
          width: 4_097,
          height: 1,
          corners: DEFORM_CORNERS,
        },
      });
    } catch (error) {
      caught = error;
    } finally {
      setRuntime(runtime);
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/文字变形画布尺寸过大/);
    expect(allocationCount).toBe(0);
  });

  it("按逐个绘制时序取最大变形画布像素而不是求和", () => {
    const first = layoutText(
      { text: "一", deform: DEFORM_CORNERS, deformSize: [4, 3] },
      createMeasureContext(),
    );
    const second = layoutText(
      { text: "二", deform: DEFORM_CORNERS, deformSize: [5, 2] },
      createMeasureContext(),
    );

    expect(measureTextDeformTemporaryPixels([first, second])).toBe(12);
  });
});

describe("文字 grapheme 换行", () => {
  it.each([
    ["家庭 ZWJ emoji", "👨‍👩‍👧‍👦"],
    ["旗帜", "🇨🇳"],
    ["组合字符", "e\u0301"],
  ])("窄宽度下不拆分%s", (_name, grapheme) => {
    const measureCtx = createCodeUnitMeasureContext();
    const prepared = layoutText(
      {
        text: grapheme.repeat(2),
        pos: [0, 0, 1],
        size: 16,
        wrap: "BREAK",
      },
      measureCtx,
    );

    expect(prepared.lines.map((line) => line.text)).toEqual([grapheme, grapheme]);
    expect(prepared.lines.map((line) => line.text).join("")).toBe(grapheme.repeat(2));
  });

  it("优先在英文单词之间的空格回退并去掉下一行前导空格", () => {
    const measureCtx = createMeasureContext();
    measureCtx.font = "normal 16px Arial";
    const prepared = layoutText(
      {
        text: "hello world",
        pos: [0, 0, measureCtx.measureText("hello w").width],
        size: 16,
        wrap: "BREAK",
      },
      measureCtx,
    );

    expect(prepared.lines.map((line) => line.text)).toEqual(["hello", "world"]);
  });
});

describe.each(["BREAK", "AREA"] as const)("%s 换行的边界空格", (mode) => {
  it("消费超宽 grapheme 前导空格且不丢失非空内容", () => {
    const family = "👨‍👩‍👧‍👦";
    const prepared = layoutWrappedText(`  ${family} X`, 1, mode);

    expect(prepared.lines.map((line) => line.text)).toEqual([family, "X"]);
    expect(
      prepared.lines
        .map((line) => line.text)
        .join("")
        .replaceAll(" ", ""),
    ).toBe(`${family}X`);
  });

  it("消费超宽单词前导空格且不生成纯空白分片", () => {
    const prepared = layoutWrappedText("  abc", 2, mode);

    expect(prepared.lines.map((line) => line.text)).toEqual(["ab", "c"]);
  });

  it("消费连续空格且不把空格留在上一行结尾", () => {
    const prepared = layoutWrappedText("ab   cd", 3, mode);

    expect(prepared.lines.map((line) => line.text)).toEqual(["ab", "cd"]);
  });

  it("消费结尾空格且不生成纯空白末行", () => {
    const prepared = layoutWrappedText("ab   ", 3, mode);

    expect(prepared.lines.map((line) => line.text)).toEqual(["ab"]);
  });

  it("把超宽纯空格输入保留为一个逻辑空行", () => {
    const prepared = layoutWrappedText("   ", 1, mode);

    expect(prepared.lines.map((line) => line.text)).toEqual([""]);
  });
});

describe("换行空格的行数预算", () => {
  it("前导空格不额外消耗最多 256 行的预算", () => {
    const prepared = layoutWrappedText(`${" ".repeat(300)}${"a".repeat(256)}`, 1, "BREAK");

    expect(prepared.lines).toHaveLength(256);
    expect(prepared.lines.every((line) => line.text === "a")).toBe(true);
  });

  it("整行已适配时保持原始空格快速路径", () => {
    const prepared = layoutWrappedText("  a  ", 5, "BREAK");

    expect(prepared.lines.map((line) => line.text)).toEqual(["  a  "]);
  });
});

describe("area 文字布局的字号一致性", () => {
  // 回归：二分搜索以失败探测收尾时，measureCtx.font 残留过期字号，
  // CENTER/RIGHT 的行 x 按错误行宽计算（评审意见 C1）。
  it("CENTER/RIGHT 行坐标与返回字号测得的行宽一致", () => {
    const measureCtx = createMeasureContext();
    for (let length = 1; length <= 150; length += 1) {
      const text = "字".repeat(length);
      for (const align of ["CENTER", "RIGHT"] as const) {
        const prepared = layoutText(
          { text, area: [0, 0, 300, 200], minSize: 8, maxSize: 40, align },
          measureCtx,
        );

        // 用返回的 fontString 重新测宽，行 x 必须与之自洽
        measureCtx.font = prepared.fontString;
        const expected =
          align === "CENTER"
            ? 150 - measureCtx.measureText(prepared.lines[0].text).width / 2
            : 300 - measureCtx.measureText(prepared.lines[0].text).width;
        expect(prepared.lines[0].x).toBeCloseTo(expected, 6);
      }
    }
  });
});
