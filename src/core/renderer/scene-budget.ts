const RGBA_BYTES_PER_PIXEL = 4;

export interface SceneResourceLimits {
  readonly maxPixels: number;
  readonly maxMemoryBytes: number;
}

interface CanvasSize {
  readonly width: number;
  readonly height: number;
}

export function validateSceneBudget(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`场景累计${label}预算无效：${value}`);
  }
  return value;
}

export function measureCanvasBatchPixels(
  width: number,
  height: number,
  count: number,
  label: string,
): number {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    !Number.isSafeInteger(count) ||
    width <= 0 ||
    height <= 0 ||
    count < 0
  ) {
    throw new Error(`场景累计像素预算超限：${label}尺寸或数量无效：${width}x${height}x${count}`);
  }
  return checkedScenePixelProduct([width, height, count], label);
}

export function measureUniqueCanvasPixels(canvases: readonly CanvasSize[], label: string): number {
  const seen = new Set<CanvasSize>();
  const pixels: number[] = [];
  for (const canvas of canvases) {
    if (seen.has(canvas)) continue;
    seen.add(canvas);
    pixels.push(measureCanvasPixels(canvas, label));
  }
  return checkedScenePixelSum(pixels, label);
}

export function measureCanvasPixels(canvas: CanvasSize, label: string): number {
  return measureCanvasBatchPixels(canvas.width, canvas.height, 1, label);
}

export function checkedScenePixelSum(values: readonly number[], label: string): number {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(total + value)) {
      throw new Error(`场景累计像素预算超限：${label}估算超出安全整数范围`);
    }
    total += value;
  }
  return total;
}

export function assertSceneResourceBudget(peakPixels: number, limits: SceneResourceLimits): void {
  const maxPixels = validateSceneBudget(limits.maxPixels, "像素");
  const maxMemoryBytes = validateSceneBudget(limits.maxMemoryBytes, "内存");
  if (!Number.isSafeInteger(peakPixels) || peakPixels < 0) {
    throw new Error("场景累计像素预算超限：峰值超出安全整数范围");
  }
  if (peakPixels > maxPixels) {
    throw new Error(`场景累计像素预算超限：峰值 ${peakPixels}，最多支持 ${maxPixels}`);
  }
  const peakMemoryBytes = peakPixels * RGBA_BYTES_PER_PIXEL;
  if (!Number.isSafeInteger(peakMemoryBytes) || peakMemoryBytes > maxMemoryBytes) {
    const peak = Number.isSafeInteger(peakMemoryBytes)
      ? `${peakMemoryBytes} 字节`
      : "超出安全整数范围";
    throw new Error(`场景累计内存预算超限：峰值 ${peak}，最多支持 ${maxMemoryBytes} 字节`);
  }
}

function checkedScenePixelProduct(values: readonly number[], label: string): number {
  let total = 1;
  for (const value of values) {
    if (!Number.isSafeInteger(total * value)) {
      throw new Error(`场景累计像素预算超限：${label}估算超出安全整数范围`);
    }
    total *= value;
  }
  return total;
}
