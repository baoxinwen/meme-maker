/**
 * 颜色解析 —— 把模板里千奇百怪的颜色格式归一成 CSS 合法的字符串。
 *
 * 解析规则：
 *   - 已经以 `#` 开头 → 原样返回
 *   - 6 / 8 位十六进制字符串 → 自动加 `#`
 *   - 3 / 4 位短色 → 自动加 `#`
 *   - 数组 `[r, g, b]` 或 `[r, g, b, a]` → 转成 rgba()
 *   - 其它情况 → 返回调用方指定的回退颜色
 */

const HEX_RE = /^[0-9a-fA-F]+$/;

export function parseColor(value: string | number[] | undefined, fallback = "#ffffff00"): string {
  if (typeof value === "string") {
    if (value.startsWith("#")) return value;
    // 支持 named color（如 "red"）直通
    if (!HEX_RE.test(value)) return value;
    // 纯 hex 字符串：3 / 4 / 6 / 8 位补 #
    if ([3, 4, 6, 8].includes(value.length)) return `#${value}`;
    // 其它长度视为无效
    return fallback;
  }

  if (Array.isArray(value) && value.length >= 3 && value.length <= 4) {
    const [r, g, b, a = 1] = value;
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  return fallback;
}
