import { describe, expect, it } from "vitest";
import { parseColor } from "../../src/core/utils/color";

describe("parseColor", () => {
  it("保留以 # 开头的字符串", () => {
    expect(parseColor("#ff0000")).toBe("#ff0000");
    expect(parseColor("#ffffff00")).toBe("#ffffff00");
    expect(parseColor("#abc")).toBe("#abc");
  });

  it("给纯十六进制字符串补上 #", () => {
    expect(parseColor("ff0000")).toBe("#ff0000");
    expect(parseColor("ffffff00")).toBe("#ffffff00");
    expect(parseColor("abc")).toBe("#abc");
    expect(parseColor("abcd")).toBe("#abcd");
  });

  it("放过命名颜色与未知字符串（CSS 解释器会处理）", () => {
    // 非 hex 字符串原样透传 —— 让浏览器 CSS 引擎决定是否合法
    expect(parseColor("red")).toBe("red");
    expect(parseColor("transparent")).toBe("transparent");
    expect(parseColor("rgb(0,0,0)")).toBe("rgb(0,0,0)");
  });

  it("数组转 rgba()", () => {
    expect(parseColor([255, 0, 0])).toBe("rgba(255, 0, 0, 1)");
    expect(parseColor([255, 0, 0, 0.5])).toBe("rgba(255, 0, 0, 0.5)");
  });

  it("无效长度的 hex 返回默认透明白色", () => {
    // 五位十六进制颜色应补齐为六位，不能原样返回 `#12345`，
    // 新版判定 hex 长度必须是 3/4/6/8，否则默认透明白
    expect(parseColor("12345")).toBe("#ffffff00");
    expect(parseColor("1234567")).toBe("#ffffff00");
  });

  it("undefined 返回默认", () => {
    expect(parseColor(undefined)).toBe("#ffffff00");
    expect(parseColor(undefined, "#000000")).toBe("#000000");
  });
});
