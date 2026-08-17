import { defineConfig, devices } from "@playwright/test";

const isCi = Boolean(process.env.CI);
const isProduction = process.env.MEME_MAKER_E2E_PRODUCTION === "1";
const configuredPort = Number.parseInt(process.env.MEME_MAKER_E2E_PORT ?? "", 10);
const serverPort =
  Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65_535
    ? configuredPort
    : isProduction
      ? 4273
      : 5173;
const baseURL = `http://127.0.0.1:${serverPort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "html",
  use: {
    baseURL,
    serviceWorkers: "block",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: {
    // CI 的质量门禁先构建 dist，再用 preview 验证真实生产产物；本地保留快速 dev 流程。
    command: isProduction
      ? `pnpm exec vite preview --host 127.0.0.1 --port ${serverPort} --strictPort`
      : `pnpm exec vite --host 127.0.0.1 --port ${serverPort} --strictPort`,
    url: baseURL,
    reuseExistingServer: !isCi && !isProduction,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      testIgnore: "pwa.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    ...(isProduction
      ? [
          {
            name: "pwa-chromium",
            testMatch: "pwa.spec.ts",
            use: {
              ...devices["Desktop Chrome"],
              serviceWorkers: "allow" as const,
            },
          },
        ]
      : []),
  ],
});
