/**
 * Canvas 图像 Blob 编码辅助。
 */

/** 把 Canvas 编码为 Blob；toBlob 返回 null（如画布尺寸为 0）时抛错。 */
export function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("toBlob 返回 null"));
    }, type);
  });
}
