/**
 * 把编辑器状态导出为本地 ZIP：`<key>/data.json` + `<key>/0.png`（可包含多帧）。
 *
 * JSZip 使用动态导入，避免进入主资源包，仅在导出时加载。
 * 下载走 `lib/download` 的原生 `<a download>` 实现（与 Toolbar 同款）。
 */

import { canvasToBlob } from "@/lib/image-blob";
import type { EditorState } from "@/stores/editor-store";
import { compileTemplate } from "./compile";

/** 把 key 清理成合法文件夹/文件名片段。 */
export function sanitizeKey(key: string): string {
  const s = key.trim().replace(/[^a-zA-Z0-9_-]/g, "-");
  return s || "my-template";
}

/** 建议的下载文件名（不含扩展名）。 */
export function templateFileName(state: EditorState): string {
  return sanitizeKey(state.meta.key);
}

/**
 * 构建导出 ZIP 的 Blob。
 */
export async function exportTemplateZip(state: EditorState): Promise<Blob> {
  if (state.frames.length === 0) {
    throw new Error("没有背景帧，无法导出");
  }
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const folderName = sanitizeKey(state.meta.key);
  const root = zip.folder(folderName);
  if (!root) throw new Error("创建 ZIP 失败");

  for (let i = 0; i < state.frames.length; i++) {
    root.file(`${i}.png`, await canvasToBlob(state.frames[i], "image/png"));
  }
  root.file("data.json", JSON.stringify(compileTemplate(state), null, 2));

  return zip.generateAsync({ type: "blob" });
}
