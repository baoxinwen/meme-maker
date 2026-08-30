// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Toolbar } from "../../src/components/toolbar";
import { TooltipProvider } from "../../src/components/ui/tooltip";
import type { PreparedScene } from "../../src/core";

const preparedScene = { frameCount: 1 } as PreparedScene;

describe("导出工具栏", () => {
  it("新场景加载期间不会导出仍在内存中的旧帧", () => {
    document.body.innerHTML = renderToStaticMarkup(
      <TooltipProvider>
        <Toolbar scene={preparedScene} templateKey="old-template" loading />
      </TooltipProvider>,
    );

    const download = document.querySelector<HTMLButtonElement>('button[aria-label="下载 PNG"]');
    expect(download?.disabled).toBe(true);
  });

  it("场景准备完成后无需预渲染帧即可下载", () => {
    document.body.innerHTML = renderToStaticMarkup(
      <TooltipProvider>
        <Toolbar scene={preparedScene} templateKey="current-template" loading={false} />
      </TooltipProvider>,
    );

    const download = document.querySelector<HTMLButtonElement>('button[aria-label="下载 PNG"]');
    expect(download?.disabled).toBe(false);
  });
});
