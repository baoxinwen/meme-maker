import type { TemplateOption, TemplateOptionValue } from "./schema/template";

export type TemplateOptionValues = Readonly<Record<string, TemplateOptionValue>>;

/** 合并用户值与模板默认值，并在核心层执行类型、范围和长度约束。 */
export function resolveTemplateOptionValues(
  definitions: readonly TemplateOption[],
  supplied: TemplateOptionValues = {},
): Record<string, TemplateOptionValue> {
  return Object.fromEntries(
    definitions.map((definition) => [
      definition.key,
      normalizeOptionValue(definition, supplied[definition.key]),
    ]),
  );
}

function normalizeOptionValue(
  definition: TemplateOption,
  supplied: TemplateOptionValue | undefined,
): TemplateOptionValue {
  switch (definition.type) {
    case "BOOLEAN":
      return typeof supplied === "boolean" ? supplied : definition.default;
    case "SELECT": {
      const fallback = definition.choices.some((choice) => choice.value === definition.default)
        ? definition.default
        : definition.choices[0].value;
      return typeof supplied === "string" &&
        definition.choices.some((choice) => choice.value === supplied)
        ? supplied
        : fallback;
    }
    case "NUMBER": {
      const min = Math.min(definition.min, definition.max);
      const max = Math.max(definition.min, definition.max);
      const raw =
        typeof supplied === "number" && Number.isFinite(supplied) ? supplied : definition.default;
      const clamped = Math.min(max, Math.max(min, raw));
      const stepped = min + Math.round((clamped - min) / definition.step) * definition.step;
      return Number(Math.min(max, Math.max(min, stepped)).toFixed(12));
    }
    case "TEXT":
      return (typeof supplied === "string" ? supplied : definition.default).slice(
        0,
        definition.maxLength,
      );
  }
}

/** 把选项转为安全表达式变量：数字保留，布尔转 0/1，枚举转 choices 下标。 */
export function templateOptionVariables(
  definitions: readonly TemplateOption[],
  values: TemplateOptionValues,
): Record<string, number> {
  return Object.fromEntries(
    definitions.flatMap((definition) => {
      const value = values[definition.key];
      if (definition.type === "NUMBER") return [[`option_${definition.key}`, Number(value)]];
      if (definition.type === "BOOLEAN") {
        return [[`option_${definition.key}`, value === true ? 1 : 0]];
      }
      if (definition.type === "SELECT") {
        const index = definition.choices.findIndex((choice) => choice.value === value);
        return [[`option_${definition.key}`, Math.max(0, index)]];
      }
      return [];
    }),
  );
}

/** 在模板字符串中展开 `$option[key]`。 */
export function resolveOptionString(text: string, values: TemplateOptionValues): string {
  return text.replace(/\$option\[([A-Za-z][A-Za-z0-9_]*)]/g, (_, key: string) =>
    String(values[key] ?? ""),
  );
}
