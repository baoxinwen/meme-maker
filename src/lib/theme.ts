/**
 * 主题切换 —— 浅色/暗色/跟随系统。
 * 初始类名由 index.html 内联脚本在首帧前设置；这里只负责读写与切换。
 */

const STORAGE_KEY = "meme-maker-theme";

export type ThemePreference = "light" | "dark" | "system";

function readStored(): ThemePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "light" || value === "dark" || value === "system") return value;
  } catch {
    // 隐私模式等 localStorage 不可用时静默回退到 system
  }
  return "system";
}

function applyDark(dark: boolean): void {
  document.documentElement.classList.toggle("dark", dark);
}

function resolveDark(preference: ThemePreference): boolean {
  if (preference === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  return preference === "dark";
}

export function getTheme(): ThemePreference {
  return readStored();
}

export function setTheme(preference: ThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // 同上：写入失败不影响本次会话的即时生效
  }
  applyDark(resolveDark(preference));
}

/** 跟随系统时监听系统切换，保证未手动选择过的用户始终同步。 */
export function watchSystemTheme(): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const listener = () => {
    if (readStored() === "system") applyDark(media.matches);
  };
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}
