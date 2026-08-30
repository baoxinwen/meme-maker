import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const CORE_DIR = join(process.cwd(), "src", "core");

const FORBIDDEN_SPECIFIERS: readonly RegExp[] = [
  /^react($|\/)/,
  /^@\/components($|\/)/,
  /^@\/stores($|\/)/,
  /^@\/pages($|\/)/,
  /^@\/hooks($|\/)/,
  /^@\/lib($|\/)/,
];

function collectSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(path);
    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) return [path];
    return [];
  });
}

function extractModuleSpecifiers(source: string): string[] {
  const sourceFile = ts.createSourceFile("core.ts", source, ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];

  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0
    ) {
      const firstArgument = node.arguments[0];
      if (ts.isStringLiteral(firstArgument)) {
        specifiers.push(firstArgument.text);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return specifiers;
}

describe("core 依赖方向门禁", () => {
  it("core 不得导入 React 或 components/stores/pages/hooks/lib 上层模块", () => {
    const files = collectSourceFiles(CORE_DIR);
    expect(files.length).toBeGreaterThan(0);

    const violations = files.flatMap((file) =>
      extractModuleSpecifiers(readFileSync(file, "utf8"))
        .filter((specifier) => FORBIDDEN_SPECIFIERS.some((pattern) => pattern.test(specifier)))
        .map((specifier) => `${file}: ${specifier}`),
    );

    expect(violations).toEqual([]);
  });
});
