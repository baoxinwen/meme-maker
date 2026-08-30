/**
 * vitest 配置 —— 仅用于 tests/scripts/ 下的工具型测试（一次性脚本，如生成特效模板预览图）。
 * 独立于主 `vite.config.ts` 的测试配置：
 *   - 主配置 exclude 了 tests/scripts/**（不让一次性脚本污染 pnpm test）
 *   - 这里专门包含脚本测试目录，复用同一个初始化文件（注入 napi 运行时与字体）
 *
 * 运行：pnpm test:gen-previews
 */
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../../src"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    globals: true,
    include: ["tests/scripts/**/*.test.{ts,mjs}"],
    exclude: ["node_modules/**"],
    // 全量模板会逐帧渲染并回读 PNG/GIF，模板数量增长后会超过 Vitest 默认的 60 秒。
    testTimeout: 180_000,
  },
});
