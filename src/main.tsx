import { App } from "@/app";
import { loadTemplateFonts } from "@/lib/font-loader";
import { logger } from "@/lib/logger";
import { watchSystemTheme } from "@/lib/theme";
import React from "react";
import ReactDOM from "react-dom/client";
import "@/styles/globals.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing #root element in index.html");

// 全局兜底日志：任何逃逸出局部 try/catch 的异步失败都留档（界面反馈由各处自行负责）。
window.addEventListener("unhandledrejection", (event) => {
  logger.error("未处理的 Promise 拒绝：", event.reason);
});
window.addEventListener("error", (event) => {
  // 资源加载错误（img/script 等）也会冒泡到这里，一并记录。
  logger.error("未捕获的全局错误：", event.error ?? event.message);
});

// 预热模板字体；真正的 Canvas 渲染路径会等待加载完成，避免回退字体参与测量。
void loadTemplateFonts();

// 未手动选择过主题时，跟随系统深浅色切换。
watchSystemTheme();

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
