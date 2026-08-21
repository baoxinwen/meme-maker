/**
 * 模板字体加载。
 *
 * 模板的 `font` 字段可能使用带空格或连字符的字体族名。Canvas 的
 * `ctx.font` 会精确匹配字体族名，因此同一字体文件需要注册多个别名。
 */

import { logger } from "@/lib/logger";

export const TEMPLATE_FONT_FACES = [
  { family: "Aller", url: "/data/fonts/Aller-Bold.ttf" },
  { family: "Aller-Bold", url: "/data/fonts/Aller-Bold.ttf" },
  { family: "MiSans", url: "/data/fonts/MiSans-Bold.ttf" },
  { family: "MiSans Bold", url: "/data/fonts/MiSans-Bold.ttf" },
  { family: "MiSans-Bold", url: "/data/fonts/MiSans-Bold.ttf" },
] as const;

const registered = new Set<string>();
let loadPromise: Promise<void> | null = null;

export function loadTemplateFonts(): Promise<void> {
  if (loadPromise) return loadPromise;

  if (
    typeof document === "undefined" ||
    typeof FontFace === "undefined" ||
    !("fonts" in document)
  ) {
    loadPromise = Promise.resolve();
    return loadPromise;
  }

  loadPromise = Promise.allSettled(TEMPLATE_FONT_FACES.map(registerFont)).then((results) => {
    let failed = false;
    for (const [index, result] of results.entries()) {
      if (result.status === "rejected") {
        failed = true;
        const family = TEMPLATE_FONT_FACES[index]?.family ?? "unknown";
        logger.warn(`字体 ${family} 加载失败，将使用回退字体：`, result.reason);
      }
    }
    if (failed) loadPromise = null;
  });

  return loadPromise;
}

async function registerFont({ family, url }: (typeof TEMPLATE_FONT_FACES)[number]): Promise<void> {
  if (registered.has(family)) return;

  const face = new FontFace(family, `url("${url}")`);
  const loaded = await face.load();
  document.fonts.add(loaded);
  registered.add(family);
}
