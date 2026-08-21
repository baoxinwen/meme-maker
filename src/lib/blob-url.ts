/**
 * Blob 对象 URL 注册表 —— 按 blob 身份缓存 URL，保证同一 blob 在多次渲染/
 * 重排/删除之间持有稳定的 URL，媒体元素不因 key 变化而整批重挂载。
 */

export class BlobUrlRegistry {
  #urls = new Map<Blob, string>();

  /** 取 blob 的 URL；不存在时创建并缓存。同一 blob 永远返回同一 URL。 */
  get(blob: Blob): string {
    let url = this.#urls.get(blob);
    if (url === undefined) {
      url = URL.createObjectURL(blob);
      this.#urls.set(blob, url);
    }
    return url;
  }

  /** 只保留给定 blob 的 URL，撤销其余（候选被删除/替换后释放内存）。 */
  retain(blobs: readonly Blob[]): void {
    const keep = new Set(blobs);
    for (const [blob, url] of this.#urls) {
      if (!keep.has(blob)) {
        URL.revokeObjectURL(url);
        this.#urls.delete(blob);
      }
    }
  }

  /** 撤销全部 URL（组件卸载时调用）。 */
  dispose(): void {
    for (const url of this.#urls.values()) {
      URL.revokeObjectURL(url);
    }
    this.#urls.clear();
  }
}
