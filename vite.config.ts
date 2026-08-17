/// <reference types="vitest" />
import { execFileSync } from "node:child_process";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

function contentAddressedAssetsPlugin() {
  return {
    name: "generate-content-addressed-assets",
    apply: "build" as const,
    buildStart() {
      execFileSync(process.execPath, ["scripts/generate-content-addressed-assets.mjs"], {
        stdio: "inherit",
      });
    },
    closeBundle() {
      execFileSync(
        process.execPath,
        ["scripts/generate-content-addressed-assets.mjs", "--install"],
        { stdio: "inherit" },
      );
    },
  };
}

// Vite 配置：React + Tailwind 4 + PWA + 路径别名
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    contentAddressedAssetsPlugin(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/*.png", "favicon.svg"],
      manifest: {
        name: "MemeMaker",
        short_name: "MemeMaker",
        description: "浏览器端表情包生成器",
        lang: "zh-CN",
        theme_color: "#eef1f5",
        background_color: "#eef1f5",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        importScripts: ["pwa-cache-migration.js"],
        runtimeCaching: [
          {
            // 内容寻址的不可变模板资源：命中缓存后无需再回源。
            urlPattern: ({ url }) => url.pathname.startsWith("/data/template-assets/"),
            handler: "CacheFirst",
            options: {
              cacheName: "template-assets-v4",
              expiration: {
                maxEntries: 900,
                maxAgeSeconds: 365 * 24 * 60 * 60,
              },
              cacheableResponse: {
                statuses: [200],
              },
            },
          },
          {
            // 模板索引按网络优先读取，避免把索引当作不可变资源长期缓存。
            urlPattern: ({ url }) => url.pathname === "/data/templates/index.json",
            handler: "NetworkFirst",
            options: {
              cacheName: "template-index",
              networkTimeoutSeconds: 5,
              expiration: {
                maxEntries: 1,
                maxAgeSeconds: 24 * 60 * 60,
              },
            },
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/data/fonts/"),
            handler: "CacheFirst",
            options: {
              cacheName: "template-fonts",
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 365 * 24 * 60 * 60,
              },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  optimizeDeps: {
    entries: ["index.html", "src/**/*.{ts,tsx}"],
  },
  build: {
    target: "es2022",
    sourcemap: false,
  },
  // Vitest 配置（与 Vite 共用）
  test: {
    // 引擎/工具测试用 node 环境（Blob.arrayBuffer 完整支持）；
    // 后续 React 组件测试在文件顶部加 `// @vitest-environment jsdom` 即可切到 jsdom
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    globals: true,
    include: ["src/**/*.{test,spec}.{ts,tsx}", "tests/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["tests/e2e/**", "tests/scripts/**", "node_modules/**"],
  },
});
