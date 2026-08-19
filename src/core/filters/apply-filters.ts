/**
 * 滤镜分发器 —— 按顺序应用一串 filter 到图像上。
 *
 * 滤镜依次执行，前一个的输出是后一个的输入。
 * 空数组返回原图副本（不报错），保证「无 filter」与「有 filter」走同一入口。
 */

import { MAX_AVATAR_FILTERS } from "../schema/template";
import { copyAsCanvas } from "../utils/canvas";
import type { RuntimeCanvas, RuntimeImage } from "../utils/runtime";
import { afterimageFilter, afterimageSteps } from "./afterimage";
import { blurFilter, normalizedBlurRadius } from "./blur";
import { bulgeFilter } from "./bulge";
import { colorizeFilter } from "./colorize";
import { contrastFilter } from "./contrast";
import { DENOISE_RADIUS, denoiseFilter } from "./denoise";
import { dotScreenFilter } from "./dot-screen";
import { halftoneFilter } from "./halftone";
import { hsbFilter } from "./hsb";
import { noiseFilter } from "./noise";
import { oilFilter, oilSamplingParams } from "./oil";
import { pixelateFilter } from "./pixelate";
import type { ResolvedAvatarFilter } from "./resolve-frame";
import { MAX_SCREEN_GRID_OPERATIONS, estimateScreenGridOperations, screenCellSize } from "./screen";
import { swimFilter } from "./swim";
import { swirlFilter } from "./swirl";

const MAX_FILTER_OPERATIONS = MAX_SCREEN_GRID_OPERATIONS;

function estimateFilterOperations(
  filter: ResolvedAvatarFilter,
  width: number,
  height: number,
): number {
  const numericValues = Object.entries(filter)
    .filter(([key]) => key !== "type")
    .flatMap(([, value]) => (typeof value === "number" ? [value] : []));
  if (numericValues.some((value) => !Number.isFinite(value))) {
    throw new Error("滤镜参数必须是有限数值");
  }

  const pixels = width * height;
  let operations = pixels;
  switch (filter.type) {
    // 各滤镜的参数归一化一律取自滤镜模块自身的导出，避免两处公式漂移。
    case "BLUR":
      operations = pixels * (2 * normalizedBlurRadius(filter.radius) + 1) * 2;
      break;
    case "OIL": {
      const { skip, range } = oilSamplingParams(filter.skip, filter.range);
      const samplesPerAxis = Math.ceil((2 * range) / skip);
      operations = pixels * samplesPerAxis * samplesPerAxis;
      break;
    }
    case "DENOISE":
      operations = pixels * (2 * DENOISE_RADIUS + 1) ** 2;
      break;
    case "AFTERIMAGE":
      operations = pixels * afterimageSteps(filter.fraction, height);
      break;
    case "HALFTONE":
    case "DOT_SCREEN": {
      if (filter.x < 0 || filter.x > 1 || filter.y < 0 || filter.y > 1) {
        throw new Error("网屏中心坐标必须在 0 到 1 之间");
      }
      const cellSize = screenCellSize(filter.radius);
      const planeCount = filter.type === "HALFTONE" ? 4 : 1;
      operations += estimateScreenGridOperations(
        width,
        height,
        cellSize,
        filter.x * width,
        filter.y * height,
        planeCount,
      );
      break;
    }
    default:
      break;
  }
  if (!Number.isFinite(operations) || operations > MAX_FILTER_OPERATIONS) {
    throw new Error("滤镜计算量过大，请降低参数或图片尺寸");
  }
  return operations;
}

export function applyFilters(
  source: RuntimeImage | RuntimeCanvas,
  filters: readonly ResolvedAvatarFilter[],
): RuntimeCanvas {
  if (filters.length === 0) {
    return copyAsCanvas(source);
  }
  if (filters.length > MAX_AVATAR_FILTERS) {
    throw new Error(`滤镜数量过多，最多支持 ${MAX_AVATAR_FILTERS} 个`);
  }
  let totalOperations = 0;
  for (const filter of filters) {
    totalOperations += estimateFilterOperations(filter, source.width, source.height);
    if (!Number.isFinite(totalOperations) || totalOperations > MAX_FILTER_OPERATIONS) {
      throw new Error("滤镜计算总量过大，请减少滤镜或降低参数");
    }
  }
  // 第一个滤镜接受 image/canvas，之后每一步都产出 RuntimeCanvas
  let current: RuntimeCanvas = applyOne(filters[0], source);
  for (let i = 1; i < filters.length; i++) {
    current = applyOne(filters[i], current);
  }
  return current;
}

function applyOne(
  filter: ResolvedAvatarFilter,
  image: RuntimeImage | RuntimeCanvas,
): RuntimeCanvas {
  switch (filter.type) {
    case "AFTERIMAGE":
      return afterimageFilter(image, filter);
    case "BLUR":
      return blurFilter(image, filter);
    case "NOISE":
      return noiseFilter(image, filter);
    case "CONTRAST":
      return contrastFilter(image, filter);
    case "COLORIZE":
      return colorizeFilter(image, filter);
    case "HSB":
      return hsbFilter(image, filter);
    case "DENOISE":
      return denoiseFilter(image, filter);
    case "OIL":
      return oilFilter(image, filter);
    case "PIXELATE":
      return pixelateFilter(image, filter);
    case "SWIRL":
      return swirlFilter(image, filter);
    case "BULGE":
      return bulgeFilter(image, filter);
    case "SWIM":
      return swimFilter(image, filter);
    case "HALFTONE":
      return halftoneFilter(image, filter);
    case "DOT_SCREEN":
      return dotScreenFilter(image, filter);
    default: {
      // 穷尽性检查：新增滤镜类型时这里会编译报错，提醒补 case
      const _exhaustive: never = filter;
      void _exhaustive;
      throw new Error(`未知滤镜类型: ${String((filter as { type?: string }).type)}`);
    }
  }
}
