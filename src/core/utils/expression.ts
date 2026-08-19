/**
 * 模板数值表达式。
 *
 * 仅允许数字、变量、括号、基础算术运算和白名单数学函数，避免把模板字符串交给
 * 通用表达式执行器。当前内置模板还需要 `sqrt(avatar0Width ^ 2)` 这类尺寸表达式。
 */

export type EvalFn = (vars: Record<string, number>) => number;

type Token =
  | { readonly type: "number"; readonly value: number }
  | { readonly type: "identifier"; readonly value: string }
  | { readonly type: "operator"; readonly value: "+" | "-" | "*" | "/" | "%" | "^" }
  | { readonly type: "comma" }
  | { readonly type: "left-paren" }
  | { readonly type: "right-paren" }
  | { readonly type: "eof" };

type Node = (vars: Record<string, number>) => number;

class ArithmeticParser {
  private index = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  parse(): Node {
    const node = this.parseAddition();
    if (this.peek().type !== "eof") throw new Error("表达式末尾存在无法识别的内容");
    return node;
  }

  private parseAddition(): Node {
    let left = this.parseMultiplication();
    while (this.isOperator("+") || this.isOperator("-")) {
      const operator = this.consumeOperator().value;
      const right = this.parseMultiplication();
      const previous = left;
      left =
        operator === "+"
          ? (vars) => previous(vars) + right(vars)
          : (vars) => previous(vars) - right(vars);
    }
    return left;
  }

  private parseMultiplication(): Node {
    let left = this.parsePower();
    while (this.isOperator("*") || this.isOperator("/") || this.isOperator("%")) {
      const operator = this.consumeOperator().value;
      const right = this.parsePower();
      const previous = left;
      if (operator === "*") left = (vars) => previous(vars) * right(vars);
      else if (operator === "/") left = (vars) => previous(vars) / right(vars);
      else left = (vars) => previous(vars) % right(vars);
    }
    return left;
  }

  private parsePower(): Node {
    const left = this.parseUnary();
    if (!this.isOperator("^")) return left;
    this.consumeOperator();
    const right = this.parsePower();
    return (vars) => left(vars) ** right(vars);
  }

  private parseUnary(): Node {
    if (this.isOperator("+")) {
      this.consumeOperator();
      return this.parseUnary();
    }
    if (this.isOperator("-")) {
      this.consumeOperator();
      const operand = this.parseUnary();
      return (vars) => -operand(vars);
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Node {
    const token = this.peek();
    if (token.type === "number") {
      this.index += 1;
      return () => token.value;
    }
    if (token.type === "identifier") {
      this.index += 1;
      if (this.peek().type === "left-paren") {
        if (
          token.value !== "sqrt" &&
          token.value !== "floor" &&
          token.value !== "round" &&
          token.value !== "min" &&
          token.value !== "max" &&
          token.value !== "gt" &&
          token.value !== "gte" &&
          token.value !== "lt" &&
          token.value !== "lte" &&
          token.value !== "eq" &&
          token.value !== "neq" &&
          token.value !== "and" &&
          token.value !== "or" &&
          token.value !== "not" &&
          token.value !== "if"
        ) {
          throw new Error(`不允许调用函数: ${token.value}`);
        }
        this.index += 1;
        const argumentsList = [this.parseAddition()];
        while (this.peek().type === "comma") {
          this.index += 1;
          argumentsList.push(this.parseAddition());
        }
        if (this.peek().type !== "right-paren") throw new Error("函数调用缺少右括号");
        this.index += 1;
        if (
          (token.value === "sqrt" || token.value === "floor" || token.value === "round") &&
          argumentsList.length !== 1
        ) {
          throw new Error(`${token.value} 只接受一个参数`);
        }
        if (
          (token.value === "gt" ||
            token.value === "gte" ||
            token.value === "lt" ||
            token.value === "lte" ||
            token.value === "eq" ||
            token.value === "neq" ||
            token.value === "and" ||
            token.value === "or") &&
          argumentsList.length !== 2
        ) {
          throw new Error(`${token.value} 只接受两个参数`);
        }
        if (token.value === "if" && argumentsList.length !== 3) {
          throw new Error("if 只接受三个参数");
        }
        if (token.value === "not" && argumentsList.length !== 1) {
          throw new Error("not 只接受一个参数");
        }
        if (token.value === "sqrt") return (vars) => Math.sqrt(argumentsList[0](vars));
        if (token.value === "floor") return (vars) => Math.floor(argumentsList[0](vars));
        if (token.value === "round") return (vars) => roundHalfAwayFromZero(argumentsList[0](vars));
        if (token.value === "min")
          return (vars) => Math.min(...argumentsList.map((arg) => arg(vars)));
        if (token.value === "max")
          return (vars) => Math.max(...argumentsList.map((arg) => arg(vars)));
        if (token.value === "gt")
          return (vars) => Number(argumentsList[0](vars) > argumentsList[1](vars));
        if (token.value === "gte")
          return (vars) => Number(argumentsList[0](vars) >= argumentsList[1](vars));
        if (token.value === "lt")
          return (vars) => Number(argumentsList[0](vars) < argumentsList[1](vars));
        if (token.value === "lte")
          return (vars) => Number(argumentsList[0](vars) <= argumentsList[1](vars));
        if (token.value === "eq")
          return (vars) => Number(argumentsList[0](vars) === argumentsList[1](vars));
        if (token.value === "neq")
          return (vars) => Number(argumentsList[0](vars) !== argumentsList[1](vars));
        if (token.value === "and")
          return (vars) => Number(argumentsList[0](vars) !== 0 && argumentsList[1](vars) !== 0);
        if (token.value === "or")
          return (vars) => Number(argumentsList[0](vars) !== 0 || argumentsList[1](vars) !== 0);
        if (token.value === "not") return (vars) => Number(argumentsList[0](vars) === 0);
        if (token.value === "if") {
          return (vars) =>
            argumentsList[0](vars) !== 0 ? argumentsList[1](vars) : argumentsList[2](vars);
        }
        throw new Error(`不允许调用函数: ${token.value}`);
      }
      return (vars) => {
        if (!Object.hasOwn(vars, token.value)) {
          throw new Error(`表达式变量未定义: ${token.value}`);
        }
        return vars[token.value];
      };
    }
    if (token.type === "left-paren") {
      this.index += 1;
      const node = this.parseAddition();
      if (this.peek().type !== "right-paren") throw new Error("表达式缺少右括号");
      this.index += 1;
      return node;
    }
    throw new Error("表达式缺少数字、变量或括号");
  }

  private peek(): Token {
    return this.tokens[this.index] ?? { type: "eof" };
  }

  private isOperator(value: string): boolean {
    const token = this.peek();
    return token.type === "operator" && token.value === value;
  }

  private consumeOperator(): Token & { type: "operator" } {
    const token = this.peek();
    if (token.type !== "operator") throw new Error("表达式缺少运算符");
    this.index += 1;
    return token;
  }
}

function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? Math.ceil(value - 0.5) : Math.floor(value + 0.5);
}

/** 表达式长度上限：合法模板表达式远小于此，超长输入只会是滥用。 */
export const MAX_EXPRESSION_LENGTH = 4096;

const WHITESPACE_RE = /\s+/y;
const NUMBER_RE = /(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/iy;
const IDENTIFIER_RE = /[A-Za-z_][A-Za-z0-9_]*/y;

function matchAt(re: RegExp, source: string, index: number): string | null {
  re.lastIndex = index;
  const match = re.exec(source);
  return match ? match[0] : null;
}

function tokenize(source: string): Token[] {
  if (source.length > MAX_EXPRESSION_LENGTH) {
    throw new Error(`表达式过长：最多支持 ${MAX_EXPRESSION_LENGTH} 字符`);
  }
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const whitespace = matchAt(WHITESPACE_RE, source, index);
    if (whitespace) {
      index += whitespace.length;
      continue;
    }
    const number = matchAt(NUMBER_RE, source, index);
    if (number) {
      tokens.push({ type: "number", value: Number(number) });
      index += number.length;
      continue;
    }
    const identifier = matchAt(IDENTIFIER_RE, source, index);
    if (identifier) {
      tokens.push({ type: "identifier", value: identifier });
      index += identifier.length;
      continue;
    }
    const char = source[index];
    if (char === "(" || char === ")") {
      tokens.push({ type: char === "(" ? "left-paren" : "right-paren" });
      index += 1;
      continue;
    }
    if (char === ",") {
      tokens.push({ type: "comma" });
      index += 1;
      continue;
    }
    if (
      char === "+" ||
      char === "-" ||
      char === "*" ||
      char === "/" ||
      char === "%" ||
      char === "^"
    ) {
      tokens.push({ type: "operator", value: char });
      index += 1;
      continue;
    }
    throw new Error(`不允许的字符: ${char}`);
  }
  tokens.push({ type: "eof" });
  return tokens;
}

const COMPILE_CACHE_LIMIT = 1000;
const compileCache = new Map<string, EvalFn>();

export function compileNumber(value: number | string): EvalFn {
  if (typeof value === "number") return () => value;

  const cached = compileCache.get(value);
  if (cached) return cached;

  let node: Node;
  try {
    node = new ArithmeticParser(tokenize(value)).parse();
  } catch (error) {
    throw new Error(
      `无法解析表达式 "${value}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const evalFn: EvalFn = (vars) => {
    const result = node(vars);
    if (!Number.isFinite(result)) {
      throw new Error(`表达式结果不是有限数字: ${value}`);
    }
    return result;
  };

  if (compileCache.size >= COMPILE_CACHE_LIMIT) compileCache.clear();
  compileCache.set(value, evalFn);
  return evalFn;
}

export function compileNumberArray(arr: readonly (number | string)[]): EvalFn[] {
  return arr.map(compileNumber);
}
