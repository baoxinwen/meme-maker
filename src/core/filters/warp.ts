/**
 * 几何扭曲共享骨架 —— SWIRL / BULGE 共用的逆向映射循环。
 *
 * 逆向映射：对输出像素 (x, y)，算出到中心距离 dist；落在半径内时由
 * `mapFn` 给出「相对中心的采样偏移」，加回中心后双线性采样；
 * 半径外或正中心直拷原像素。两种滤镜仅偏移算法不同。
 */

import { bilinearSample, pixelIndex, readPixels, writePixels } from "../utils/pixel";
import type { RuntimeCanvas, RuntimeImage } from "../utils/runtime";

export interface WarpCenter {
  /** 归一化中心坐标（0-1，相对宽度/高度） */
  x: number;
  y: number;
  /** 扭曲半径（像素）；<=0 时取画布短边的一半 */
  radius: number;
}

export function warpFilter(
  source: RuntimeImage | RuntimeCanvas,
  center: WarpCenter,
  mapFn: (dx: number, dy: number, dist: number, radius: number) => readonly [number, number],
): RuntimeCanvas {
  const { data, width: w, height: h } = readPixels(source);
  const cx = center.x * w;
  const cy = center.y * h;
  const radius = center.radius > 0 ? center.radius : Math.min(w, h) / 2;

  const out = new Uint8ClampedArray(data.length);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const o = pixelIndex(w, x, y);

      if (dist >= radius || dist === 0) {
        // 半径外或正中心：直接取原像素
        out[o] = data[o];
        out[o + 1] = data[o + 1];
        out[o + 2] = data[o + 2];
        out[o + 3] = data[o + 3];
        continue;
      }

      const [offsetX, offsetY] = mapFn(dx, dy, dist, radius);
      bilinearSample(data, w, h, cx + offsetX, cy + offsetY, out, o);
    }
  }

  return writePixels({ data: out, width: w, height: h });
}
