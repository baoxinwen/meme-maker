/**
 * 模板编辑器端到端测试。
 *
 * 验证 /editor 能加载、上传背景帧、增删图层、导出按钮可用。
 * 不深入 Fabric 交互（拖拽/缩放），只验证「能加载、能操作、不崩溃」。
 */

import { createCanvas } from "@napi-rs/canvas";
import { devices, expect, test } from "@playwright/test";

const TWO_FRAME_GIF =
  "R0lGODlhCAAIAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACAAAACwAAAAACAAIAAAIDwABCBxIsKDBgwgTKkwYEAAh+QQACAAAACwAAAAACAAIAIAAAP8AAAAIDwABCBxIsKDBgwgTKkwYEAA7";

function png(width: number, height: number, color: string): Buffer {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = color;
  context.fillRect(0, 0, width, height);
  return canvas.toBuffer("image/png");
}

function quadrantPng(size: number): Buffer {
  const canvas = createCanvas(size, size);
  const context = canvas.getContext("2d");
  const half = size / 2;
  context.fillStyle = "#ff0000";
  context.fillRect(0, 0, half, half);
  context.fillStyle = "#00ff00";
  context.fillRect(half, 0, half, half);
  context.fillStyle = "#0000ff";
  context.fillRect(0, half, half, half);
  context.fillStyle = "#ffff00";
  context.fillRect(half, half, half, half);
  return canvas.toBuffer("image/png");
}

function animatedGif(): Buffer {
  return Buffer.from(TWO_FRAME_GIF, "base64");
}

test.describe("模板编辑器", () => {
  test("上传背景、加头像/文字图层、导出按钮可用", async ({ page }) => {
    await page.goto("/editor");

    // 页面加载
    await expect(page.getByText("模板编辑器").first()).toBeVisible();
    await expect(page.getByText(/点击或拖拽上传背景图/)).toBeVisible();
    const previewButton = page.getByTestId("editor-preview-button");
    await expect(previewButton).toBeVisible();
    await expect(previewButton).toBeDisabled();

    // 上传背景帧（复用 avatar.jpg 作占位）
    await page.getByTestId("background-initial-input").setInputFiles("tests/fixtures/avatar.jpg");

    // 上传后画布出现（Fabric 渲染 lower + upper 两个 canvas，取第一个）
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 10_000 });
    const nonBlankPixels = await page.locator("canvas.lower-canvas").evaluate((canvas) => {
      const element = canvas as HTMLCanvasElement;
      const data = element.getContext("2d")!.getImageData(0, 0, element.width, element.height).data;
      let count = 0;
      for (let i = 0; i < data.length; i += 16) {
        if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) count += 1;
      }
      return count;
    });
    expect(nonBlankPixels).toBeGreaterThan(0);
    await expect(page.getByTestId("background-toolbar")).toBeVisible();
    await expect(page.getByTestId("background-add-button")).toBeVisible();
    await expect(page.getByTestId("background-replace-button")).toBeVisible();
    await expect(page.getByTestId("background-clear-button")).toBeVisible();
    await expect(previewButton).toBeEnabled();
    await previewButton.click();
    await expect(page.getByText("实时预览（占位头像）")).toBeVisible();
    await expect(page.getByTestId("preview-stage")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByText("实时预览（占位头像）")).toHaveCount(0);

    // 加头像图层
    await page.getByRole("button", { name: /加头像/ }).click();
    await expect(page.getByText(/头像 · 目标/)).toBeVisible();

    // 加文字图层
    await page.getByRole("button", { name: /加文字/ }).click();
    await expect(page.getByText(/文字 · 文字/)).toBeVisible();

    // 选中头像图层 → 属性面板显示
    await page.getByText(/头像 · 目标/).click();
    await expect(page.getByText("头像属性")).toBeVisible();

    // 导出按钮可用
    await expect(page.getByRole("button", { name: /导出 ZIP/ })).toBeEnabled();
  });

  test("背景图片从左上完整绘制到 Fabric 画布", async ({ page }) => {
    await page.goto("/editor");
    await page.getByTestId("background-initial-input").setInputFiles({
      name: "quadrants.png",
      mimeType: "image/png",
      buffer: quadrantPng(80),
    });

    await expect
      .poll(() =>
        page.locator("canvas.lower-canvas").evaluate((canvas) => {
          const element = canvas as HTMLCanvasElement;
          const context = element.getContext("2d")!;
          const read = (x: number, y: number) =>
            Array.from(context.getImageData(x, y, 1, 1).data).slice(0, 3);
          return [read(20, 20), read(60, 20), read(20, 60), read(60, 60)];
        }),
      )
      .toEqual([
        [255, 0, 0],
        [0, 255, 0],
        [0, 0, 255],
        [255, 255, 0],
      ]);
  });

  test("画布键盘移动区域使用正确语义并移动选中图层", async ({ page }) => {
    await page.goto("/editor");
    await page.getByTestId("background-initial-input").setInputFiles("tests/fixtures/avatar.jpg");
    await page.getByRole("button", { name: /加文字/ }).click();

    const keyboardArea = page.getByRole("group", { name: "画布键盘移动区域" });
    const xInput = page.getByRole("spinbutton", { name: "X", exact: true });
    await expect(keyboardArea).toBeAttached();
    await expect(xInput).toHaveValue("50");

    await keyboardArea.focus();
    await expect(keyboardArea).toBeVisible();
    await page.keyboard.press("ArrowRight");

    await expect(xInput).toHaveValue("51");
    await expect(keyboardArea).toBeFocused();
  });

  test("背景帧可通过键盘调整顺序", async ({ page }) => {
    await page.goto("/editor");
    await page.getByTestId("background-initial-input").setInputFiles([
      { name: "0-red.png", mimeType: "image/png", buffer: png(32, 32, "#ff0000") },
      { name: "1-green.png", mimeType: "image/png", buffer: png(32, 32, "#00ff00") },
      { name: "2-blue.png", mimeType: "image/png", buffer: png(32, 32, "#0000ff") },
    ]);

    const secondFrame = page.getByTestId("background-frame-1");
    await secondFrame.click();
    await secondFrame.focus();
    await page.keyboard.press("Alt+ArrowLeft");

    await expect(page.getByTestId("background-frame-0")).toHaveAttribute("aria-current", "true");
    await expect(page.getByTestId("background-frame-0")).toBeFocused();
  });

  test("只为时间线可见区域生成帧缩略图", async ({ page }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.toDataURL;
      const state = window as Window & { __thumbnailEncodeCount?: number };
      state.__thumbnailEncodeCount = 0;
      HTMLCanvasElement.prototype.toDataURL = function (...args) {
        state.__thumbnailEncodeCount = (state.__thumbnailEncodeCount ?? 0) + 1;
        return original.apply(this, args);
      };
    });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/editor");
    await page.getByTestId("background-initial-input").setInputFiles(
      Array.from({ length: 20 }, (_, index) => ({
        name: `${index}.png`,
        mimeType: "image/png",
        buffer: png(24, 24, "#0d9488"),
      })),
    );

    const encodeCount = () =>
      page.evaluate(
        () => (window as Window & { __thumbnailEncodeCount?: number }).__thumbnailEncodeCount ?? 0,
      );
    await expect.poll(encodeCount).toBeGreaterThan(0);
    const initialCount = await encodeCount();
    expect(initialCount).toBeLessThan(20);

    await page
      .getByTestId("background-timeline")
      .evaluate((timeline) => timeline.scrollTo({ left: timeline.scrollWidth }));
    await expect.poll(encodeCount).toBeGreaterThan(initialCount);
  });

  test("触屏帧排序与删除按钮满足触控尺寸且互不重叠", async ({ browser, baseURL }) => {
    if (!baseURL) throw new Error("Playwright baseURL 未配置");
    const context = await browser.newContext({
      ...devices["Pixel 5"],
      viewport: { width: 375, height: 812 },
    });
    const touchPage = await context.newPage();
    try {
      await touchPage.goto(`${baseURL}/editor`);
      expect(await touchPage.evaluate(() => window.matchMedia("(pointer: coarse)").matches)).toBe(
        true,
      );
      await touchPage.getByTestId("background-initial-input").setInputFiles([
        { name: "0.png", mimeType: "image/png", buffer: png(32, 32, "#ff0000") },
        { name: "1.png", mimeType: "image/png", buffer: png(32, 32, "#00ff00") },
      ]);

      const dragBox = await touchPage.getByTestId("background-frame-drag-0").boundingBox();
      const deleteBox = await touchPage.getByTestId("background-frame-delete-0").boundingBox();
      expect(dragBox).not.toBeNull();
      expect(deleteBox).not.toBeNull();
      expect(dragBox!.width).toBeGreaterThanOrEqual(44);
      expect(dragBox!.height).toBeGreaterThanOrEqual(44);
      expect(deleteBox!.width).toBeGreaterThanOrEqual(44);
      expect(deleteBox!.height).toBeGreaterThanOrEqual(44);

      const overlapWidth = Math.max(
        0,
        Math.min(dragBox!.x + dragBox!.width, deleteBox!.x + deleteBox!.width) -
          Math.max(dragBox!.x, deleteBox!.x),
      );
      const overlapHeight = Math.max(
        0,
        Math.min(dragBox!.y + dragBox!.height, deleteBox!.y + deleteBox!.height) -
          Math.max(dragBox!.y, deleteBox!.y),
      );
      expect(overlapWidth * overlapHeight).toBe(0);
    } finally {
      await context.close();
    }
  });

  test("离开编辑器会结束临时会话，导出后也不会保留内存草稿", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /模板编辑器/ }).click();
    await page.getByTestId("background-initial-input").setInputFiles("tests/fixtures/avatar.jpg");
    await expect(page.getByRole("button", { name: /导出 ZIP/ })).toBeEnabled();

    await page.getByRole("link", { name: "返回主页" }).click();
    await expect(page.getByText("放弃未导出的修改？")).toBeVisible();
    await page.getByRole("button", { name: "继续编辑" }).click();
    await expect(page).toHaveURL(/\/editor$/);

    await page.evaluate(() => window.history.back());
    await expect(page.getByText("放弃未导出的修改？")).toBeVisible();
    await page.getByRole("button", { name: "放弃修改并离开" }).click();
    await expect(page).toHaveURL(/\/$/);

    await page.getByRole("link", { name: /模板编辑器/ }).click();
    await expect(page.getByText(/点击或拖拽上传背景图/)).toBeVisible();
    await page.getByTestId("background-initial-input").setInputFiles("tests/fixtures/avatar.jpg");

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /导出 ZIP/ }).click();
    await download;
    await page.getByRole("link", { name: "返回主页" }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.getByRole("link", { name: /模板编辑器/ }).click();
    await expect(page.getByText(/点击或拖拽上传背景图/)).toBeVisible();
  });

  test("刷新未导出的编辑器会触发浏览器离开提示", async ({ page }) => {
    await page.goto("/editor");
    await page.getByTestId("background-initial-input").setInputFiles("tests/fixtures/avatar.jpg");
    await expect(page.getByTestId("background-frame-count")).toHaveText("1 帧");

    let dialogType = "";
    page.once("dialog", (dialog) => {
      dialogType = dialog.type();
      void dialog.dismiss();
    });
    const reload = page.reload({ timeout: 1_000 }).catch(() => undefined);
    await expect.poll(() => dialogType).toBe("beforeunload");
    await reload;
  });

  test("背景导入期间锁定时间线与背景命令", async ({ page }) => {
    await page.addInitScript(() => {
      const originalArrayBuffer = Blob.prototype.arrayBuffer;
      Blob.prototype.arrayBuffer = function (this: Blob): Promise<ArrayBuffer> {
        return new Promise<ArrayBuffer>((resolve, reject) => {
          window.setTimeout(() => {
            void originalArrayBuffer.call(this).then(resolve, reject);
          }, 600);
        });
      };
    });
    await page.goto("/editor");
    await page.getByTestId("background-initial-input").setInputFiles({
      name: "0-red.png",
      mimeType: "image/png",
      buffer: png(8, 8, "#ff0000"),
    });
    await expect(page.getByTestId("background-frame-count")).toHaveText("1 帧");

    const upload = page.getByTestId("background-add-input").setInputFiles({
      name: "1-delayed.gif",
      mimeType: "image/gif",
      buffer: animatedGif(),
    });
    await expect(page.getByTestId("background-toolbar")).toHaveAttribute("aria-busy", "true");
    await expect(page.getByTestId("background-frame-0")).toBeDisabled();
    await expect(page.getByTestId("background-replace-button")).toBeDisabled();
    await upload;
    await expect(page.getByTestId("background-toolbar")).toHaveAttribute("aria-busy", "false");
    await expect(page.getByTestId("background-frame-count")).toHaveText("3 帧");
  });

  test("清空背景确认后回到空白模板", async ({ page }) => {
    await page.goto("/editor");
    await page.getByTestId("background-initial-input").setInputFiles("tests/fixtures/avatar.jpg");
    await expect(page.getByTestId("background-clear-button")).toBeVisible();
    await page.getByRole("button", { name: /加头像/ }).click();
    await expect(page.getByText(/头像 · 目标/)).toBeVisible();

    await page.getByTestId("background-clear-button").click();
    await expect(page.getByText("清空当前模板？")).toBeVisible();
    await page.getByTestId("background-clear-confirm").click();

    await expect(page.getByText(/点击或拖拽上传背景图/)).toBeVisible();
    await expect(page.getByText(/头像 · 目标/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /加头像/ })).toBeDisabled();
    await expect(page.getByRole("button", { name: /导出 ZIP/ })).toBeDisabled();
  });

  test("单个 GIF 展开为多帧，混合尺寸背景会被拒绝", async ({ page }) => {
    await page.goto("/editor");
    const input = page.getByTestId("background-initial-input");
    await input.setInputFiles({
      name: "animated.gif",
      mimeType: "image/gif",
      buffer: animatedGif(),
    });
    await expect(page.getByTestId("background-frame-count")).toHaveText("2 帧");
    await expect(page.getByText("2 帧", { exact: true })).toHaveCount(1);

    await page.reload();
    await page.getByTestId("background-initial-input").setInputFiles([
      { name: "0.png", mimeType: "image/png", buffer: png(20, 20, "#ff0000") },
      { name: "1.png", mimeType: "image/png", buffer: png(24, 20, "#0000ff") },
    ]);
    await expect(page.getByText(/背景帧尺寸不一致/)).toBeVisible();
    await expect(page.getByText(/点击或拖拽上传背景图/)).toBeVisible();
  });

  test("添加背景会插入当前帧之后，替换只更新当前帧", async ({ page }) => {
    await page.goto("/editor");
    await page.getByTestId("background-initial-input").setInputFiles([
      { name: "0-red.png", mimeType: "image/png", buffer: png(64, 64, "#ff0000") },
      { name: "2-blue.png", mimeType: "image/png", buffer: png(64, 64, "#0000ff") },
    ]);
    await expect(page.getByTestId("background-frame-count")).toHaveText("2 帧");

    await page.getByTestId("background-add-input").setInputFiles({
      name: "1-green.png",
      mimeType: "image/png",
      buffer: png(64, 64, "#00ff00"),
    });
    await expect(page.getByTestId("background-frame-count")).toHaveText("3 帧");
    await expect(page.getByTestId("background-frame-1")).toHaveAttribute("aria-current", "true");
    await expect
      .poll(() =>
        page.locator("canvas.lower-canvas").evaluate((canvas) => {
          const data = (canvas as HTMLCanvasElement)
            .getContext("2d")!
            .getImageData(0, 0, 1, 1).data;
          return [data[0], data[1], data[2]];
        }),
      )
      .toEqual([0, 255, 0]);

    await page.getByTestId("background-replace-input").setInputFiles({
      name: "1-yellow.png",
      mimeType: "image/png",
      buffer: png(64, 64, "#ffff00"),
    });
    await expect(page.getByTestId("background-frame-count")).toHaveText("3 帧");
    await expect
      .poll(() =>
        page.locator("canvas.lower-canvas").evaluate((canvas) => {
          const data = (canvas as HTMLCanvasElement)
            .getContext("2d")!
            .getImageData(0, 0, 1, 1).data;
          return [data[0], data[1], data[2]];
        }),
      )
      .toEqual([255, 255, 0]);

    await page.getByTestId("background-frame-0").click();
    await expect
      .poll(() =>
        page.locator("canvas.lower-canvas").evaluate((canvas) => {
          const data = (canvas as HTMLCanvasElement)
            .getContext("2d")!
            .getImageData(0, 0, 1, 1).data;
          return [data[0], data[1], data[2]];
        }),
      )
      .toEqual([255, 0, 0]);
    await page.getByTestId("background-frame-2").click();
    await expect
      .poll(() =>
        page.locator("canvas.lower-canvas").evaluate((canvas) => {
          const data = (canvas as HTMLCanvasElement)
            .getContext("2d")!
            .getImageData(0, 0, 1, 1).data;
          return [data[0], data[1], data[2]];
        }),
      )
      .toEqual([0, 0, 255]);
  });

  test("拖到缩略图左半区会在目标帧前插入，并让当前预览跟随原背景", async ({ page }) => {
    await page.goto("/editor");
    await page.getByTestId("background-initial-input").setInputFiles([
      { name: "0-red.png", mimeType: "image/png", buffer: png(64, 64, "#ff0000") },
      { name: "1-green.png", mimeType: "image/png", buffer: png(64, 64, "#00ff00") },
      { name: "2-blue.png", mimeType: "image/png", buffer: png(64, 64, "#0000ff") },
    ]);

    const source = page.getByTestId("background-frame-drag-0");
    const target = page.getByTestId("background-frame-drag-2");
    await expect(source).toBeVisible();
    await source.dragTo(target);

    await expect(page.getByTestId("background-frame-1")).toHaveAttribute("aria-current", "true");
    await expect
      .poll(() =>
        page.locator("canvas.lower-canvas").evaluate((canvas) => {
          const data = (canvas as HTMLCanvasElement)
            .getContext("2d")!
            .getImageData(0, 0, 1, 1).data;
          return [data[0], data[1], data[2]];
        }),
      )
      .toEqual([255, 0, 0]);

    await page.getByTestId("background-frame-0").click();
    await expect
      .poll(() =>
        page.locator("canvas.lower-canvas").evaluate((canvas) => {
          const data = (canvas as HTMLCanvasElement)
            .getContext("2d")!
            .getImageData(0, 0, 1, 1).data;
          return [data[0], data[1], data[2]];
        }),
      )
      .toEqual([0, 255, 0]);
  });

  test("添加和替换会拒绝尺寸不一致的背景", async ({ page }) => {
    await page.goto("/editor");
    await page.getByTestId("background-initial-input").setInputFiles({
      name: "red.png",
      mimeType: "image/png",
      buffer: png(20, 20, "#ff0000"),
    });

    await page.getByTestId("background-add-input").setInputFiles({
      name: "large-blue.png",
      mimeType: "image/png",
      buffer: png(24, 20, "#0000ff"),
    });
    await expect(page.getByText(/背景帧尺寸不一致/).last()).toBeVisible();
    await expect(page.getByTestId("background-frame-count")).toHaveText("1 帧");

    await page.getByTestId("background-replace-input").setInputFiles({
      name: "large-green.png",
      mimeType: "image/png",
      buffer: png(20, 24, "#00ff00"),
    });
    await expect(page.getByText(/背景帧尺寸不一致/).last()).toBeVisible();
    await expect(page.getByTestId("background-frame-count")).toHaveText("1 帧");
  });

  test("动画 GIF 只能添加，不能替换当前帧", async ({ page }) => {
    await page.goto("/editor");
    await page.getByTestId("background-initial-input").setInputFiles({
      name: "static.png",
      mimeType: "image/png",
      buffer: png(8, 8, "#ff0000"),
    });

    await page.getByTestId("background-replace-input").setInputFiles({
      name: "animated.gif",
      mimeType: "image/gif",
      buffer: animatedGif(),
    });
    await expect(page.getByText(/替换当前帧仅支持静态图片或单帧 GIF/)).toBeVisible();
    await expect(page.getByTestId("background-frame-count")).toHaveText("1 帧");

    await page.getByTestId("background-add-input").setInputFiles({
      name: "animated.gif",
      mimeType: "image/gif",
      buffer: animatedGif(),
    });
    await expect(page.getByTestId("background-frame-count")).toHaveText("3 帧");
  });

  test("多帧背景支持单帧删除", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/editor");
    await page.getByTestId("background-initial-input").setInputFiles([
      { name: "0.png", mimeType: "image/png", buffer: png(80, 80, "#ff0000") },
      { name: "1.png", mimeType: "image/png", buffer: png(80, 80, "#00ff00") },
      { name: "2.png", mimeType: "image/png", buffer: png(80, 80, "#0000ff") },
    ]);

    await expect(page.getByTestId("background-frame-count")).toHaveText("3 帧");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await page.getByTestId("background-frame-delete-1").click();
    await expect(page.getByTestId("background-frame-count")).toHaveText("2 帧");
    await expect(page.getByTestId("background-frame-1")).toBeVisible();
  });

  test("背景工具栏在各视口保持分组且只横向滚动时间线", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/editor");
    await page.getByTestId("background-initial-input").setInputFiles(
      Array.from({ length: 8 }, (_, index) => ({
        name: `${index}.png`,
        mimeType: "image/png",
        buffer: png(80, 80, "#0d9488"),
      })),
    );

    const mobileLayout = await page.getByTestId("background-toolbar").evaluate((toolbar) => {
      const status = toolbar.querySelector("[data-testid='background-status']")!;
      const timeline = toolbar.querySelector("[data-testid='background-timeline']")!;
      const actions = toolbar.querySelector("[data-testid='background-actions']")!;
      const style = getComputedStyle(timeline);
      return {
        toolbarClientWidth: toolbar.clientWidth,
        toolbarScrollWidth: toolbar.scrollWidth,
        statusTop: status.getBoundingClientRect().top,
        timelineTop: timeline.getBoundingClientRect().top,
        statusCenter:
          status.getBoundingClientRect().top + status.getBoundingClientRect().height / 2,
        actionsCenter:
          actions.getBoundingClientRect().top + actions.getBoundingClientRect().height / 2,
        timelineClientWidth: timeline.clientWidth,
        timelineScrollWidth: timeline.scrollWidth,
        timelineClientHeight: timeline.clientHeight,
        timelineScrollHeight: timeline.scrollHeight,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
      };
    });
    expect(Math.abs(mobileLayout.statusCenter - mobileLayout.actionsCenter)).toBeLessThanOrEqual(1);
    expect(mobileLayout.timelineTop).toBeGreaterThan(mobileLayout.statusTop);
    expect(mobileLayout.toolbarScrollWidth).toBeLessThanOrEqual(
      mobileLayout.toolbarClientWidth + 1,
    );
    expect(mobileLayout.timelineScrollWidth).toBeGreaterThan(mobileLayout.timelineClientWidth);
    expect(mobileLayout.timelineScrollHeight).toBeLessThanOrEqual(
      mobileLayout.timelineClientHeight + 1,
    );
    expect(mobileLayout.overflowX).toBe("auto");
    expect(mobileLayout.overflowY).toBe("hidden");

    for (const viewport of [
      { width: 768, height: 900 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await expect
        .poll(() =>
          page.getByTestId("background-toolbar").evaluate((toolbar) => {
            const status = toolbar.querySelector("[data-testid='background-status']")!;
            const timeline = toolbar.querySelector("[data-testid='background-timeline']")!;
            const actions = toolbar.querySelector("[data-testid='background-actions']")!;
            const centers = [status, timeline, actions].map((element) => {
              const rect = element.getBoundingClientRect();
              return rect.top + rect.height / 2;
            });
            return {
              scrollFits: toolbar.scrollWidth <= toolbar.clientWidth + 1,
              sameRow: Math.max(...centers) - Math.min(...centers) <= 1,
            };
          }),
        )
        .toEqual({ scrollFits: true, sameRow: true });
    }
    await expect(page.getByTestId("background-add-button").getByText("添加")).toBeVisible();
    await expect(page.getByTestId("background-replace-button").getByText("替换")).toBeVisible();
  });

  test("大尺寸方形背景完整且更充分地缩放到编辑视口", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/editor");
    await page.getByTestId("background-initial-input").setInputFiles({
      name: "square-1080.png",
      mimeType: "image/png",
      buffer: png(1080, 1080, "#0d9488"),
    });
    await expect(page.locator("canvas.lower-canvas")).toBeVisible();

    await expect
      .poll(() =>
        page.locator("canvas.lower-canvas").evaluate((canvas) => {
          const element = canvas as HTMLCanvasElement;
          const viewport = document.querySelector("[data-testid='editor-canvas-viewport']");
          const frame = element.closest("[data-fabric='wrapper']")?.getBoundingClientRect();
          if (!frame || !viewport) return false;
          const viewportRect = viewport.getBoundingClientRect();
          return (
            element.width === 1080 &&
            element.height === 1080 &&
            frame.width >= 540 &&
            frame.height >= 540 &&
            frame.width <= viewportRect.width - 16 + 1 &&
            frame.height <= viewportRect.height - 16 + 1 &&
            viewport.scrollHeight <= viewport.clientHeight + 1
          );
        }),
      )
      .toBe(true);
  });

  test("横图和竖图完整落入画布视口且保留原始像素", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });

    for (const image of [
      { name: "wide.png", width: 1200, height: 600, color: "#0d9488" },
      { name: "tall.png", width: 600, height: 1200, color: "#a84416" },
    ]) {
      await page.goto("/editor");
      await page.getByTestId("background-initial-input").setInputFiles({
        name: image.name,
        mimeType: "image/png",
        buffer: png(image.width, image.height, image.color),
      });

      await expect
        .poll(() =>
          page.locator("canvas.lower-canvas").evaluate((canvas) => {
            const element = canvas as HTMLCanvasElement;
            const viewport = document.querySelector<HTMLDivElement>(
              "[data-testid='editor-canvas-viewport']",
            );
            const frame = element.closest("[data-fabric='wrapper']")?.getBoundingClientRect();
            if (!viewport || !frame) return false;
            return {
              fits:
                frame.width <= viewport.clientWidth - 16 + 1 &&
                frame.height <= viewport.clientHeight - 16 + 1 &&
                viewport.scrollHeight <= viewport.clientHeight + 1,
              rawWidth: element.width,
              rawHeight: element.height,
            };
          }),
        )
        .toEqual({ fits: true, rawWidth: image.width, rawHeight: image.height });
    }
  });

  test("主页有编辑器入口链接", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: /模板编辑器/ })).toBeVisible();
    await page.getByRole("link", { name: /模板编辑器/ }).click();
    await expect(page).toHaveURL(/\/editor/);
  });

  test("手机端顶部操作保持同一行且页面不横向溢出", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/editor");

    const actions = page.locator("header button, header a");
    // 撤销 + 重做 + 导出 ZIP + 返回主页 + 主题切换
    await expect(actions).toHaveCount(5);
    const actionPositions = await actions.evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { top: rect.top, width: rect.width };
      }),
    );
    expect(
      Math.max(...actionPositions.map((item) => item.top)) -
        Math.min(...actionPositions.map((item) => item.top)),
    ).toBeLessThanOrEqual(1);
    expect(actionPositions.every((item) => item.width > 0)).toBe(true);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/editor");
    const main = await page.locator("main").boundingBox();
    expect(main).not.toBeNull();
    // 工作台容器上限 1500px（与主应用一致）
    expect(main!.width).toBeLessThanOrEqual(1500);
    expect(main!.width).toBeGreaterThan(1200);
  });
});
