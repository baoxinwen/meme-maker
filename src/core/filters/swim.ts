/**
 * 水下滤镜（SWIM）—— 水波纹扰动。
 *
 * 使用双正弦叠加生成位移场：
 *   off = amount * ( sin(t + u) + turbulence * sin(2.1u + 1.3t) )，u = 坐标/scale
 * 横纵各算一份，再按 angle 旋转、按 stretch 拉伸后叠加到位移。
 * 视觉上呈现水波晃动效果。
 */

import { bilinearSample, readPixels, writePixels } from "../utils/pixel";
import type { RuntimeCanvas, RuntimeImage } from "../utils/runtime";
import type { ResolvedSwimFilter } from "./resolve-frame";

export function swimFilter(
  source: RuntimeImage | RuntimeCanvas,
  params: ResolvedSwimFilter,
): RuntimeCanvas {
  const { data, width: w, height: h } = readPixels(source);
  const { scale, stretch, angle, amount, turbulence, time } = params;

  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const out = new Uint8ClampedArray(data.length);

  for (let y = 0; y < h; y++) {
    const u = y / scale;
    const waveY = Math.sin(u + time) + turbulence * Math.sin(u * 2.1 + time * 1.3);
    for (let x = 0; x < w; x++) {
      const v = x / scale;
      const waveX = Math.sin(v + time) + turbulence * Math.sin(v * 2.1 + time * 1.3);

      // 横向位移按 stretch 拉伸，再整体按 angle 旋转到位移向量
      const offX = amount * waveX * stretch;
      const offY = amount * waveY;
      const rx = offX * cosA - offY * sinA;
      const ry = offX * sinA + offY * cosA;

      const o = (y * w + x) * 4;
      bilinearSample(data, w, h, x + rx, y + ry, out, o);
    }
  }

  return writePixels({ data: out, width: w, height: h });
}
