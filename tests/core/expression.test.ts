import { describe, expect, it } from "vitest";
import { compileNumber, compileNumberArray } from "../../src/core/utils/expression";

describe("compileNumber", () => {
  it("数字常量直接返回", () => {
    const fn = compileNumber(42);
    expect(fn({})).toBe(42);
  });

  it("字符串表达式求值", () => {
    const fn = compileNumber("2 + 3");
    expect(fn({})).toBe(5);
  });

  it("引用变量", () => {
    const fn = compileNumber("avatar0Width / 2");
    expect(fn({ avatar0Width: 100 })).toBe(50);
  });

  it("复杂表达式", () => {
    const fn = compileNumber("(avatar0Width + avatar0Height) * 0.5");
    expect(fn({ avatar0Width: 100, avatar0Height: 200 })).toBe(150);
  });

  it("支持白名单数学函数", () => {
    const fn = compileNumber("floor(sqrt(avatar0Width ^ 2 + avatar0Height ^ 2))");
    expect(fn({ avatar0Width: 3, avatar0Height: 4 })).toBe(5);
  });

  it("round 按远离零方向处理 0.5", () => {
    expect(compileNumber("round(1.5)")({})).toBe(2);
    expect(compileNumber("round(-1.5)")({})).toBe(-2);
  });

  it("支持受限的 min 和 max 函数", () => {
    expect(
      compileNumber("min(avatar0Width, avatar0Height, 80)")({
        avatar0Width: 120,
        avatar0Height: 90,
      }),
    ).toBe(80);
    expect(
      compileNumber("max(avatar0Width, avatar0Height)")({
        avatar0Width: 120,
        avatar0Height: 90,
      }),
    ).toBe(120);
  });

  it("支持数值比较和条件选择", () => {
    const wide = compileNumber("if(gt(width, height), width, height)");
    const tall = compileNumber("if(gt(width, height), width, height)");

    expect(wide({ width: 160, height: 90 })).toBe(160);
    expect(tall({ width: 90, height: 160 })).toBe(160);
    expect(compileNumber("gte(width, height)")({ width: 100, height: 100 })).toBe(1);
    expect(compileNumber("lt(width, height)")({ width: 100, height: 80 })).toBe(0);
  });

  it("支持等值比较与布尔组合", () => {
    expect(compileNumber("eq(option_side, 2)")({ option_side: 2 })).toBe(1);
    expect(compileNumber("neq(option_side, 1)")({ option_side: 2 })).toBe(1);
    expect(compileNumber("and(eq(a, 1), eq(b, 2))")({ a: 1, b: 2 })).toBe(1);
    expect(compileNumber("or(eq(a, 0), eq(b, 2))")({ a: 1, b: 2 })).toBe(1);
    expect(compileNumber("not(eq(a, 1))")({ a: 1 })).toBe(0);
  });

  it("解析失败时报错可读", () => {
    expect(() => compileNumber("(((")).toThrow(/无法解析表达式/);
  });

  it("拒绝函数、成员访问和未声明变量", () => {
    expect(() => compileNumber("constructor.constructor('return 1')()")).toThrow(/无法解析表达式/);
    expect(() => compileNumber("avatar.__proto__")).toThrow(/无法解析表达式/);
    expect(() => compileNumber("missing")({})).toThrow(/变量未定义/);
    expect(() => compileNumber("abs(1)")).toThrow(/不允许调用函数/);
  });

  it("拒绝除零等非有限结果", () => {
    expect(() => compileNumber("1 / 0")({})).toThrow(/不是有限数字/);
  });
});

describe("compileNumberArray", () => {
  it("数组混合数字与表达式", () => {
    const fns = compileNumberArray([10, "w / 2", 30, "h"]);
    expect(fns.map((f) => f({ w: 200, h: 100 }))).toEqual([10, 100, 30, 100]);
  });
});
