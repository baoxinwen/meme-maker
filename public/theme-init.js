/**
 * 首帧主题恢复 —— 必须以同步外链脚本在 <head> 中执行：
 * 等待模块化 JS 会产生暗色用户白屏闪烁；写成外链文件而非内联，
 * 是为了让 nginx 的 CSP（script-src 'self'）直接放行，无需维护 hash。
 */
(function () {
  try {
    var stored = localStorage.getItem("mememaker-theme");
    var dark =
      stored === "dark" ||
      (stored !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (dark) document.documentElement.classList.add("dark");
  } catch (e) {
    /* localStorage 不可用时按系统偏好已在上行处理 */
  }
})();
