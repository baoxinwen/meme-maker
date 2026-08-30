import { readFile } from "node:fs/promises";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { decompressFrames, parseGIF } from "gifuct-js";

async function mockCropTemplate(page: Page): Promise<void> {
  await page.route("**/data/templates/index.json", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        version: "test",
        templates: [
          {
            key: "crop-check",
            type: "IMG",
            length: 0,
            alias: ["取景测试"],
            description: "头像取景测试",
          },
        ],
      }),
    }),
  );
  await page.route("**/data/templates/crop-check/data.json", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        type: "IMG",
        avatar: [{ type: "TO", pos: [0, 0, 64, 64] }],
        text: [],
        background: { size: [64, 64], color: "#ffffff" },
      }),
    }),
  );
}

async function mockAnimatedCropTemplate(page: Page): Promise<void> {
  await page.route("**/data/templates/index.json", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        version: "test",
        templates: [
          {
            key: "crop-gif-check",
            type: "GIF",
            length: 0,
            alias: ["动态取景测试"],
            description: "动态头像取景测试",
          },
        ],
      }),
    }),
  );
  await page.route("**/data/templates/crop-gif-check/data.json", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        type: "GIF",
        avatar: [
          {
            type: "TO",
            pos: [
              [0, 0, 64, 64],
              [0, 0, 64, 64],
            ],
          },
        ],
        text: [],
        background: { size: [64, 64], color: "#ffffff" },
        delay: 80,
      }),
    }),
  );
}

async function mockRandomAvatarTemplate(page: Page): Promise<void> {
  await page.route("**/data/templates/index.json", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        version: "test",
        templates: [
          {
            key: "random-check",
            type: "IMG",
            length: 0,
            alias: ["随机测试"],
            description: "随机头像测试",
          },
        ],
      }),
    }),
  );
  await page.route("**/data/templates/random-check/data.json", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        type: "IMG",
        avatar: [{ type: "RANDOM", pos: [0, 0, 64, 64] }],
        text: [],
        background: { size: [64, 64], color: "#ffffff" },
      }),
    }),
  );
}

async function mockUserAvatarTemplate(page: Page): Promise<void> {
  await page.route("**/data/templates/index.json", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        version: "test",
        templates: [
          {
            key: "user-check",
            type: "IMG",
            length: 0,
            alias: ["顺序头像测试"],
            description: "顺序头像测试",
          },
        ],
      }),
    }),
  );
  await page.route("**/data/templates/user-check/data.json", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        type: "IMG",
        avatar: [
          { type: "USER", input: 0, pos: [0, 0, 32, 32] },
          { type: "USER", input: 1, optional: true, pos: [32, 0, 32, 32] },
        ],
        text: [],
        background: { size: [64, 32], color: "#ffffff" },
      }),
    }),
  );
}

test.describe("主应用界面", () => {
  test("上传一次后可反复键盘取景且 PNG 下载与预览一致", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await mockCropTemplate(page);
    await page.goto("/");
    await page.getByLabel("选择模板").click();
    await page.getByTestId("template-card-crop-check").click();
    await page.getByTestId("avatar-input-TO").setInputFiles("tests/fixtures/avatar.jpg");

    const preview = page.getByRole("img", { name: "表情包生成预览" });
    await expect(preview).toBeVisible({ timeout: 10_000 });
    const beforeCrop = await preview.evaluate((canvas) =>
      (canvas as HTMLCanvasElement).toDataURL(),
    );
    let fileChooserCount = 0;
    page.on("filechooser", () => {
      fileChooserCount += 1;
    });

    await page.getByRole("button", { name: "调整目标头像（TO）取景" }).click();
    const dialog = page.getByRole("dialog", { name: "调整目标头像（TO）取景" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("此取景将应用于所有帧");

    const leftHandle = dialog.locator('[aria-label="调整左边缘"]');
    await expect(leftHandle).toBeVisible();
    const handleBox = await leftHandle.boundingBox();
    expect(handleBox).not.toBeNull();
    expect(handleBox!.width).toBeGreaterThanOrEqual(44);
    expect(handleBox!.height).toBeGreaterThanOrEqual(44);
    await leftHandle.focus();
    for (let index = 0; index < 12; index += 1) await page.keyboard.press("ArrowRight");
    await expect(leftHandle).toBeFocused();

    for (const name of ["恢复完整画面", "取消", "确认取景"]) {
      const box = await page.getByRole("button", { name }).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);

    await page.getByRole("button", { name: "确认取景" }).click();
    await expect
      .poll(() => preview.evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL()))
      .not.toBe(beforeCrop);
    await expect(page.getByRole("button", { name: "调整目标头像（TO）取景" })).toContainText(
      "重新取景",
    );

    await page.getByRole("button", { name: "调整目标头像（TO）取景" }).click();
    await expect(dialog).toBeVisible();
    expect(fileChooserCount).toBe(0);
    await page.getByRole("button", { name: "取消" }).click();

    const previewPixels = await preview.evaluate((canvas) => {
      const target = canvas as HTMLCanvasElement;
      return Array.from(
        target.getContext("2d")!.getImageData(0, 0, target.width, target.height).data,
      );
    });
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载 PNG" }).click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();
    const downloadedImage = await loadImage(await readFile(downloadPath!));
    const downloadedCanvas = createCanvas(downloadedImage.width, downloadedImage.height);
    const downloadedContext = downloadedCanvas.getContext("2d");
    downloadedContext.drawImage(downloadedImage, 0, 0);
    expect(
      Array.from(
        downloadedContext.getImageData(0, 0, downloadedCanvas.width, downloadedCanvas.height).data,
      ),
    ).toEqual(previewPixels);
  });

  test("确认取景后 GIF 下载首帧与预览一致", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockAnimatedCropTemplate(page);
    await page.goto("/");
    await page.getByLabel("选择模板").click();
    await page.getByTestId("template-card-crop-gif-check").click();
    await page.getByTestId("avatar-input-TO").setInputFiles("tests/fixtures/avatar.jpg");

    const preview = page.getByRole("img", { name: "表情包生成预览" });
    await expect(preview).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "调整目标头像（TO）取景" }).click();
    const leftHandle = page.getByRole("dialog").locator('[aria-label="调整左边缘"]');
    await leftHandle.focus();
    for (let index = 0; index < 10; index += 1) await page.keyboard.press("ArrowRight");
    await page.getByRole("button", { name: "确认取景" }).click();
    await expect(page.getByRole("button", { name: "调整目标头像（TO）取景" })).toContainText(
      "重新取景",
    );

    const previewFrame = await preview.evaluate((canvas) => {
      const target = canvas as HTMLCanvasElement;
      return {
        width: target.width,
        height: target.height,
        pixels: Array.from(
          target.getContext("2d")!.getImageData(0, 0, target.width, target.height).data,
        ),
      };
    });
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载 GIF" }).click();
    const downloadPath = await (await downloadPromise).path();
    expect(downloadPath).not.toBeNull();
    const bytes = await readFile(downloadPath!);
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const frames = decompressFrames(parseGIF(buffer), true);

    expect(frames).toHaveLength(2);
    expect(frames[0].dims.width).toBe(previewFrame.width);
    expect(frames[0].dims.height).toBe(previewFrame.height);
    let rgbError = 0;
    for (let offset = 0; offset < frames[0].patch.length; offset += 4) {
      rgbError += Math.abs(frames[0].patch[offset] - previewFrame.pixels[offset]);
      rgbError += Math.abs(frames[0].patch[offset + 1] - previewFrame.pixels[offset + 1]);
      rgbError += Math.abs(frames[0].patch[offset + 2] - previewFrame.pixels[offset + 2]);
    }
    expect(rgbError / (previewFrame.width * previewFrame.height * 3)).toBeLessThan(20);
  });

  test("选择 osu 模板、修改文字、下载按钮可用", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByText("MemeMaker").first()).toBeVisible();
    await expect(page.getByLabel("选择模板")).toBeVisible();

    await page.getByLabel("选择模板").click();
    await expect(page.getByTestId("template-card-osu")).toBeVisible();
    await page.getByTestId("template-card-osu").click();

    // 选模板后预览 canvas 应出现
    await expect(page.locator("canvas")).toBeVisible({ timeout: 10_000 });
    const previewFill = await page.getByTestId("preview-stage").evaluate((stage) => {
      const canvas = stage.querySelector("canvas");
      if (!canvas) return null;
      const stageRect = stage.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      return { stageWidth: stageRect.width, stageHeight: stageRect.height, canvasRect };
    });
    expect(previewFill).not.toBeNull();
    expect(Math.abs(previewFill!.canvasRect.width - previewFill!.stageWidth)).toBeLessThanOrEqual(
      3,
    );
    expect(Math.abs(previewFill!.canvasRect.height - previewFill!.stageHeight)).toBeLessThanOrEqual(
      3,
    );

    const textInput = page.locator('input[type="text"]').first();
    await expect(textInput).toBeVisible();
    await textInput.fill("Hello 你好！");

    await expect(page.getByRole("button", { name: /下载 PNG/ })).toBeEnabled();
    await expect(page.getByRole("button", { name: /^复制$/ })).toBeEnabled();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /下载 PNG/ }).click();
    expect((await downloadPromise).suggestedFilename()).toBe("osu.png");
  });

  test("选择 tightly 模板时先显示头像槽，上传头像后渲染预览", async ({ page }) => {
    await page.goto("/");

    await page.getByLabel("选择模板").click();
    await expect(page.getByTestId("template-card-tightly")).toBeVisible();
    await page.getByTestId("template-card-tightly").click();

    // 缺头像时也必须显示上传槽位（修复"先有鸡还是先有蛋"的问题）
    await expect(page.getByTestId("avatar-input-TO")).toBeAttached({ timeout: 10_000 });
    await expect(page.getByTestId("avatar-input-TO")).toHaveAttribute("accept", /video\/\*/);
    // 预览区应显示友好引导（而非红色"渲染失败"）
    await expect(page.getByText(/请上传 TO 头像/)).toBeVisible({ timeout: 10_000 });

    await page.getByTestId("avatar-input-TO").setInputFiles("tests/fixtures/avatar.jpg");

    await expect(page.locator("canvas")).toBeVisible({ timeout: 10_000 });
    // tightly 是 GIF 模板 → 按钮文案为「下载 GIF」
    await expect(page.getByRole("button", { name: /下载 GIF/ })).toBeEnabled();
    await expect(page.getByRole("button", { name: /GIF 暂不支持复制/ })).toBeDisabled();
  });

  test("模板索引只请求一次，静态动态尺寸模板不会误标为特效", async ({ page }) => {
    let indexRequests = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/data/templates/index.json") indexRequests += 1;
    });
    await page.goto("/");
    await page.getByLabel("选择模板").click();
    await expect(page.getByTestId("template-card-bible")).toContainText("IMG");
    await expect(page.getByTestId("template-card-bible")).not.toContainText("特效");
    expect(indexRequests).toBe(1);
  });

  test("程序化 GIF 模板在选择器中展示可加载的动态缩略图", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("选择模板").click();

    const thumbnail = page.getByTestId("template-card-backflip").locator("img");
    await expect(thumbnail).toBeVisible();
    await expect
      .poll(() =>
        thumbnail.evaluate((element) => {
          const image = element as HTMLImageElement;
          const source = image.currentSrc || image.src;
          if (!source) return false;
          const pathname = new URL(source).pathname;
          return (
            image.complete &&
            image.naturalWidth > 0 &&
            /^\/data\/(?:templates\/backflip|template-assets\/backflip\/[a-f0-9]{64})\/preview\.gif$/.test(
              pathname,
            )
          );
        }),
      )
      .toBe(true);
  });

  test("特效模板（swim）能渲染多帧 GIF（无背景帧，靠 background.length 生成）", async ({
    page,
  }) => {
    await page.goto("/");

    await page.getByLabel("选择模板").click();
    await page.getByTestId("template-card-swim").click();

    // swim 需要上传 TO 头像
    await expect(page.getByTestId("avatar-input-TO")).toBeAttached({ timeout: 10_000 });
    await page.getByTestId("avatar-input-TO").setInputFiles("tests/fixtures/avatar.jpg");

    // 应成功渲染出 canvas（而非渲染失败）
    await expect(page.locator("canvas")).toBeVisible({ timeout: 10_000 });
    // swim 是 GIF 模板 → 按钮文案为「下载 GIF」
    await expect(page.getByRole("button", { name: /下载 GIF/ })).toBeEnabled();
    await expect(page.getByRole("button", { name: /GIF 暂不支持复制/ })).toBeDisabled();
  });

  test("随机头像候选支持追加和单独删除", async ({ page }) => {
    await mockRandomAvatarTemplate(page);
    await page.goto("/");
    await page.getByLabel("选择模板").click();
    await page.getByTestId("template-card-random-check").click();
    const input = page.getByTestId("avatar-input-RANDOM");
    await expect(input).toBeAttached();

    await input.setInputFiles("tests/fixtures/avatar.jpg");
    await expect(page.getByTestId("random-avatar-candidates").locator("img")).toHaveCount(1);
    await input.setInputFiles("tests/fixtures/avatar.jpg");
    await expect(page.getByTestId("random-avatar-candidates").locator("img")).toHaveCount(2);
    await page.getByTestId("random-avatar-delete-0").click();
    await expect(page.getByTestId("random-avatar-candidates").locator("img")).toHaveCount(1);
  });

  test("顺序头像支持追加、删除和缺失引导", async ({ page }) => {
    await mockUserAvatarTemplate(page);
    await page.goto("/");
    await page.getByLabel("选择模板").click();
    await page.getByTestId("template-card-user-check").click();

    const input = page.getByTestId("avatar-input-USER");
    await expect(input).toBeAttached();
    await expect(input).toHaveAttribute("multiple", "");
    await expect(page.getByText(/请上传 USER #1 头像/)).toBeVisible({ timeout: 10_000 });

    await input.setInputFiles("tests/fixtures/avatar.jpg");
    await expect(page.getByTestId("user-avatar-candidates").locator("img")).toHaveCount(1);
    await expect(page.locator("canvas")).toBeVisible({ timeout: 10_000 });

    await input.setInputFiles("tests/fixtures/avatar.jpg");
    await expect(page.getByTestId("user-avatar-candidates").locator("img")).toHaveCount(2);
    await page.getByTestId("user-avatar-delete-1").click();
    await expect(page.getByTestId("user-avatar-candidates").locator("img")).toHaveCount(1);
  });

  test("数字模板选项会立即更新动态画布并保留下载能力", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("选择模板").click();
    await page.getByTestId("template-card-look_flat").click();
    await page.getByTestId("avatar-input-FROM").setInputFiles("tests/fixtures/avatar.jpg");
    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible({ timeout: 10_000 });
    const initialHeight = await canvas.evaluate((element) => (element as HTMLCanvasElement).height);

    await expect(page.getByRole("slider", { name: "压扁比例" })).toBeVisible();
    const ratio = page.getByRole("spinbutton", { name: "压扁比例" });
    await expect(ratio).toHaveValue("2");
    await ratio.fill("5");
    await expect
      .poll(() => canvas.evaluate((element) => (element as HTMLCanvasElement).height))
      .toBeLessThan(initialHeight);
    await expect(page.getByRole("button", { name: "下载 PNG" })).toBeEnabled();
  });

  test("字号滑块有字段语义且支持连续键盘调整", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("选择模板").click();
    await page.getByTestId("template-card-osu").click();

    const slider = page.getByRole("slider", { name: /字号/ });
    await expect(slider).toBeVisible({ timeout: 10_000 });
    const initialValue = Number(await slider.getAttribute("aria-valuenow"));

    await slider.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");

    await expect(slider).toHaveAttribute("aria-valuenow", String(initialValue + 2));
    await expect(slider).toBeFocused();
  });

  test("缺少头像时预览引导会通知辅助技术", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("选择模板").click();
    await page.getByTestId("template-card-tightly").click();

    await expect(page.getByRole("status").filter({ hasText: "请上传 TO 头像" })).toBeVisible({
      timeout: 10_000,
    });
  });

  test("pyramid 顺序头像遵守四张上限并生成动态预览", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("选择模板").click();
    await page.getByTestId("template-card-pyramid").click();
    const input = page.getByTestId("avatar-input-USER");
    await input.setInputFiles(Array.from({ length: 5 }, () => "tests/fixtures/avatar.jpg"));

    await expect(page.getByText("此模板最多使用 4 张头像")).toBeVisible();
    await expect(page.getByTestId("user-avatar-candidates").locator("img")).toHaveCount(4);
    await expect(page.locator("canvas")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "下载 GIF" })).toBeEnabled();
  });

  test("chanshenzi 提供多段字幕编辑并生成 GIF 预览", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("选择模板").click();
    await page.getByTestId("template-card-chanshenzi").click();

    await expect(page.getByLabel("文字 1 内容")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel("文字 2 内容")).toBeVisible();
    await expect(page.getByLabel("文字 3 内容")).toBeVisible();
    await page.getByLabel("文字 2 内容").fill("新的字幕");
    await expect(page.locator("canvas")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "下载 GIF" })).toBeEnabled();
  });

  test("已有输入时切换模板会先确认，确认后统一清空", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("选择模板").click();
    await page.getByTestId("template-card-tightly").click();
    await page.getByTestId("avatar-input-TO").setInputFiles("tests/fixtures/avatar.jpg");
    await expect(page.locator("canvas")).toBeVisible({ timeout: 10_000 });

    await page.getByLabel("选择模板").click();
    await page.getByTestId("template-card-osu").click();
    await expect(page.getByText("切换模板？")).toBeVisible();
    await page.getByRole("button", { name: "继续编辑" }).click();
    await expect(page.getByTestId("avatar-input-TO")).toBeAttached();

    await page.getByLabel("选择模板").click();
    await page.getByTestId("template-card-osu").click();
    await page.getByRole("button", { name: "清空并切换" }).click();
    await expect(page.getByTestId("avatar-input-TO")).toHaveCount(0);
    await expect(page.getByLabel("选择模板")).toContainText("osu");
  });

  test("宽幅与窄幅模板按比例预览，已选模板与操作按钮保持紧凑", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    await page.getByLabel("选择模板").click();
    await page.getByTestId("template-card-interview").click();
    await page.getByTestId("avatar-input-TO").setInputFiles("tests/fixtures/avatar.jpg");
    await expect(page.locator("canvas")).toBeVisible({ timeout: 10_000 });

    const widePreview = await page.getByTestId("preview-stage").evaluate((stage) => {
      const canvas = stage.querySelector("canvas");
      const rect = stage.getBoundingClientRect();
      return {
        stageRatio: rect.width / rect.height,
        canvasRatio: canvas ? canvas.width / canvas.height : 0,
        height: rect.height,
      };
    });
    expect(widePreview.stageRatio).toBeGreaterThan(2);
    expect(widePreview.stageRatio).toBeCloseTo(widePreview.canvasRatio, 2);
    expect(widePreview.height).toBeLessThanOrEqual(524);

    const templateTrigger = await page.getByLabel("选择模板").boundingBox();
    expect(templateTrigger).not.toBeNull();
    expect(templateTrigger!.width).toBeLessThanOrEqual(320);

    const downloadButton = await page.getByRole("button", { name: "下载 PNG" }).boundingBox();
    expect(downloadButton).not.toBeNull();
    expect(downloadButton!.width).toBeLessThan(200);
    expect(downloadButton!.height).toBeLessThanOrEqual(40);

    const copyButton = await page.getByRole("button", { name: "复制" }).boundingBox();
    expect(copyButton).not.toBeNull();
    expect(copyButton!.width).toBeLessThanOrEqual(36);
    expect(copyButton!.height).toBeLessThanOrEqual(36);

    await page.getByLabel("选择模板").click();
    await page.getByTestId("template-card-bible").click();
    await page.getByRole("button", { name: "清空并切换" }).click();
    await page.getByTestId("avatar-input-TO").setInputFiles("tests/fixtures/avatar.jpg");
    await expect
      .poll(
        () =>
          page.getByTestId("preview-stage").evaluate((stage) => {
            const canvas = stage.querySelector("canvas");
            if (!(canvas instanceof HTMLCanvasElement) || canvas.width <= 0 || canvas.height <= 0) {
              return false;
            }
            const rect = stage.getBoundingClientRect();
            const stageRatio = rect.width / rect.height;
            const canvasRatio = canvas.width / canvas.height;
            return stageRatio < 1 && Math.abs(stageRatio - canvasRatio) < 0.01;
          }),
        { timeout: 10_000 },
      )
      .toBe(true);

    const narrowPreview = await page.getByTestId("preview-stage").evaluate((stage) => {
      const canvas = stage.querySelector("canvas");
      const rect = stage.getBoundingClientRect();
      return {
        stageRatio: rect.width / rect.height,
        canvasRatio: canvas ? canvas.width / canvas.height : 0,
        height: rect.height,
      };
    });
    expect(narrowPreview.stageRatio).toBeLessThan(1);
    expect(narrowPreview.stageRatio).toBeCloseTo(narrowPreview.canvasRatio, 2);
    expect(narrowPreview.height).toBeLessThanOrEqual(524);
  });

  test("各常用视口的主页不会横向溢出", async ({ page }) => {
    for (const viewport of [
      { width: 375, height: 812 },
      { width: 768, height: 900 },
      { width: 1024, height: 900 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/");
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
      if (viewport.width === 1440) {
        const main = await page.locator("main").boundingBox();
        expect(main).not.toBeNull();
        // 工作台容器上限 1500px：宽屏下内容充分展开，不再两侧大片留白
        expect(main!.width).toBeLessThanOrEqual(1500);
        expect(main!.width).toBeGreaterThan(1200);
      }
    }
  });

  test("375px 下预览舞台位于制作分区之前", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await page.getByLabel("选择模板").click();
    await page.getByTestId("template-card-osu").click();

    const previewHeading = page.getByRole("heading", { name: "预览", exact: true });
    const finalInputHeading = page.getByRole("heading", { name: /编辑文字/ });
    await expect(finalInputHeading).toBeVisible({ timeout: 10_000 });

    const positions = await Promise.all(
      [previewHeading, finalInputHeading].map(async (locator) => {
        const box = await locator.boundingBox();
        expect(box).not.toBeNull();
        return box!.y;
      }),
    );

    // 舞台优先：预览标题必须出现在所有输入分区之前
    expect(positions[0]).toBeLessThan(positions[1]);
  });
});

test.describe("主应用触控目标", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });

  test("主流程控件至少 44px 且滑块拇指保持圆形", async ({ page }) => {
    await page.goto("/");
    const templateTrigger = page.locator('button[aria-label="选择模板"]');
    await templateTrigger.click();
    await page.getByTestId("template-card-osu").click();

    const contentInput = page.getByLabel("文字 1 内容");
    const colorInput = page.getByLabel("文字 1 颜色", { exact: true });
    const contentLabel = page.locator('label[for="template-text-0-content"]');
    const slider = page.locator('[data-slot="slider"]').first();
    await expect(slider).toBeVisible({ timeout: 10_000 });

    for (const [name, locator] of [
      ["文字输入", contentInput],
      ["颜色输入", colorInput],
      ["文字输入标签", contentLabel],
      ["滑块轨道", slider],
    ] as const) {
      const box = await locator.boundingBox();
      expect(box, `${name}应存在`).not.toBeNull();
      expect.soft(box!.height, `${name}触控高度`).toBeGreaterThanOrEqual(44);
    }

    const thumbShape = await page
      .locator('[data-slot="slider-thumb"]')
      .first()
      .evaluate((thumb) => {
        const style = getComputedStyle(thumb);
        const rect = thumb.getBoundingClientRect();
        return {
          width: rect.width,
          height: rect.height,
          radius: Number.parseFloat(style.borderRadius),
        };
      });
    expect
      .soft(thumbShape.radius)
      .toBeGreaterThanOrEqual(Math.min(thumbShape.width, thumbShape.height) / 2);

    await templateTrigger.click();
    await page.getByTestId("template-card-anan_say").click();
    const selectTrigger = page.getByTestId("template-option-expression");
    await expect(selectTrigger).toBeVisible({ timeout: 10_000 });
    const selectBox = await selectTrigger.boundingBox();
    expect(selectBox).not.toBeNull();
    expect.soft(selectBox!.height, "下拉选择触控高度").toBeGreaterThanOrEqual(44);

    await templateTrigger.click();
    await page.getByTestId("template-card-clown").click();
    const checkbox = page.getByTestId("template-option-person");
    await expect(checkbox).toBeVisible({ timeout: 10_000 });
    const checkboxLabel = checkbox.locator("xpath=ancestor::label");
    const checkboxTarget = await checkboxLabel.boundingBox();
    expect(checkboxTarget).not.toBeNull();
    expect.soft(checkboxTarget!.height, "复选框标签触控高度").toBeGreaterThanOrEqual(44);

    const wrappedCheckboxLabel = await checkboxLabel.evaluate((label) => {
      const text = label.querySelector("span");
      label.style.width = "10rem";
      label.style.fontSize = "1.25rem";
      if (text) text.textContent = "使用人物头部轮廓并保留完整的边缘细节";
      return {
        clientHeight: label.clientHeight,
        scrollHeight: label.scrollHeight,
      };
    });
    expect
      .soft(wrappedCheckboxLabel.scrollHeight, "长标签内容不应溢出")
      .toBeLessThanOrEqual(wrappedCheckboxLabel.clientHeight);
    expect
      .soft(wrappedCheckboxLabel.clientHeight, "长标签应能高于最小触控高度")
      .toBeGreaterThan(44);
  });
});
