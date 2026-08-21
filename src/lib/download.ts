/**
 * 浏览器下载辅助 —— 原生 `<a download>` 实现，不引入 file-saver。
 */

/** 触发浏览器下载一个 Blob。 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  // 延迟撤销：部分浏览器（如 Safari）的下载任务读取 URL 晚于 click() 返回，
  // 同步 revoke 会导致偶发下载失败。
  setTimeout(() => URL.revokeObjectURL(url), 40_000);
}
