/**
 * 应用日志入口 —— 基于 loglevel（第三方、约 1KB gzip，无传递依赖）。
 *
 * 级别约定：
 *   error  操作失败（用户已看到错误提示，此处留档诊断）
 *   warn   降级运行（如字体加载失败回退到系统字体）
 *   info   关键成功路径（如导出完成）
 *   debug 开发诊断细节（上传校验拒绝、场景耗时等），生产默认不输出
 *
 * 默认级别 warn；调试时可用 URL 参数 ?log=debug 或
 * localStorage["meme-maker:logLevel"] 覆盖（URL 优先）。
 */

import log from "loglevel";

const STORAGE_KEY = "meme-maker:logLevel";
const KNOWN_LEVELS = ["trace", "debug", "info", "warn", "error", "silent"] as const;
type KnownLevel = (typeof KNOWN_LEVELS)[number];

function isKnownLevel(value: string | null | undefined): value is KnownLevel {
  return typeof value === "string" && (KNOWN_LEVELS as readonly string[]).includes(value);
}

function resolveInitialLevel(): KnownLevel {
  try {
    const query = new URLSearchParams(window.location.search).get("log");
    if (isKnownLevel(query)) return query;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isKnownLevel(stored)) return stored;
  } catch {
    // 非浏览器环境（单元测试）或存储被禁用：使用默认级别
  }
  return "warn";
}

export const logger = log.getLogger("meme-maker");
logger.setLevel(resolveInitialLevel());

/** 运行时调整日志级别并持久化到 localStorage（调试用）。 */
export function setLogLevel(level: KnownLevel): void {
  logger.setLevel(level);
  try {
    window.localStorage.setItem(STORAGE_KEY, level);
  } catch {
    // 存储不可用时仅当前会话生效
  }
}
