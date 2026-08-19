import type { RuntimeCanvas, RuntimeContext, RuntimeImage } from "../utils/runtime";
import { createCanvas } from "../utils/runtime";
import type { ResolvedPixelateFilter } from "./resolve-frame";

/** 按固定块大小降低分辨率，再用最近邻采样恢复原尺寸。 */
export function pixelateFilter(
  source: RuntimeImage | RuntimeCanvas,
  options: ResolvedPixelateFilter,
): RuntimeCanvas {
  const size = Math.max(1, Math.round(options.size));
  const reduced = createCanvas(
    Math.max(1, Math.floor(source.width / size)),
    Math.max(1, Math.floor(source.height / size)),
  );
  const reducedContext = reduced.getContext("2d") as RuntimeContext;
  reducedContext.imageSmoothingEnabled = false;
  reducedContext.drawImage(source, 0, 0, reduced.width, reduced.height);

  const output = createCanvas(source.width, source.height);
  const outputContext = output.getContext("2d") as RuntimeContext;
  outputContext.imageSmoothingEnabled = false;
  outputContext.drawImage(reduced, 0, 0, output.width, output.height);
  return output;
}
