import { describe, expect, it } from "vitest";

import {
  resolveOptionString,
  resolveTemplateOptionValues,
  templateOptionVariables,
} from "../../src/core/options";
import { parseTemplate } from "../../src/core/schema/template";

const definitions = parseTemplate({
  type: "IMG",
  options: [
    { type: "BOOLEAN", key: "bold", label: "加粗", default: false },
    {
      type: "SELECT",
      key: "side",
      label: "方向",
      default: "right",
      choices: [
        { value: "left", label: "左" },
        { value: "right", label: "右" },
      ],
    },
    { type: "NUMBER", key: "ratio", label: "比例", default: 2, min: 1, max: 10, step: 0.5 },
    { type: "TEXT", key: "name", label: "称呼", default: "老婆", maxLength: 4 },
  ],
}).options;

describe("模板选项", () => {
  it("合并默认值，并规范化类型、范围、步长与文本长度", () => {
    expect(
      resolveTemplateOptionValues(definitions, {
        bold: true,
        side: "invalid",
        ratio: 99,
        name: "超长称呼文本",
      }),
    ).toEqual({ bold: true, side: "right", ratio: 10, name: "超长称呼" });

    expect(resolveTemplateOptionValues(definitions, { ratio: 2.26 }).ratio).toBe(2.5);
  });

  it("把布尔、枚举和数字映射为安全表达式变量", () => {
    const values = resolveTemplateOptionValues(definitions, {
      bold: true,
      side: "right",
      ratio: 3.5,
    });

    expect(templateOptionVariables(definitions, values)).toEqual({
      option_bold: 1,
      option_side: 1,
      option_ratio: 3.5,
    });
  });

  it("展开文字中的选项变量", () => {
    expect(resolveOptionString("这是我的$option[name]", { name: "猫" })).toBe("这是我的猫");
  });
});
