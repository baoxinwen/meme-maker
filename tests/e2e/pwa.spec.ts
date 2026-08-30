import { expect, test } from "@playwright/test";

test.describe("PWA 生产构建", () => {
  test("模板发布使用不可变 revision 路径且 manifest 与页面主题一致", async ({ request }) => {
    const manifestResponse = await request.get("/manifest.webmanifest");
    expect(manifestResponse.ok()).toBe(true);
    const manifest = await manifestResponse.json();
    expect(manifest.theme_color).toBe("#eef1f5");
    expect(manifest.background_color).toBe("#eef1f5");

    const indexResponse = await request.get("/data/templates/index.json");
    expect(indexResponse.ok()).toBe(true);
    const index = await indexResponse.json();
    const entry = index.templates.find((item: { key: string }) => item.key === "abstinence");
    expect(entry?.revision).toMatch(/^[a-f0-9]{64}$/);

    const immutableResponse = await request.get(
      `/data/template-assets/abstinence/${entry.revision}/0.png`,
    );
    expect(immutableResponse.ok()).toBe(true);
    const legacyResponse = await request.get("/data/templates/abstinence/0.png");
    expect(legacyResponse.headers()["content-type"]).not.toContain("image/png");
  });

  test("服务工作线程接管页面并支持离线打开应用外壳", async ({ page, context }) => {
    await page.goto("/pwa-cache-migration.js");
    await page.evaluate(async () => {
      await Promise.all([caches.open("template-data-v2"), caches.open("template-images-v2")]);
    });

    await page.goto("/");
    await expect(page.getByText("MemeMaker").first()).toBeVisible();

    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const registrations = await navigator.serviceWorker.getRegistrations();
            return registrations.some((registration) => registration.active?.state === "activated");
          }),
        { timeout: 15_000 },
      )
      .toBe(true);

    await expect
      .poll(() =>
        page.evaluate(async () => {
          const names = await caches.keys();
          return names.filter((name) => ["template-data-v2", "template-images-v2"].includes(name));
        }),
      )
      .toEqual([]);

    await page.reload();
    await expect
      .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
      .toBe(true);

    await context.setOffline(true);
    try {
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByText("MemeMaker").first()).toBeVisible();
    } finally {
      await context.setOffline(false);
    }
  });
});
