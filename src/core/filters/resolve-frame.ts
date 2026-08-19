/**
 * 逐帧滤镜解析 —— 把数据结构层的 `number | number[]` 滤镜参数，
 * 按 `frameIndex` 取值并拍平成全数值滤镜参数，再交给具体滤镜函数应用。
 *
 * 特效模板（swirl/bulge/rgb/swim）使用数组参数生成逐帧动画：
 *   angle: [0, 0.6, 1.5, ...]  → 第 0 帧用 0、第 1 帧用 0.6、...
 * 越界时取数组最后一个值（clamp），避免短数组配长动画时读到 undefined。
 *
 * 单个数值参数对所有帧都使用同一个值，无需变换。
 *
 * 解析后的扁平滤镜使用 `ResolvedXxxFilter` 类型（字段全是数值），
 * 具体滤镜函数（swirlFilter 等）接收这种类型，类型上保证不会再有数组。
 */

import type {
  AfterimageFilter,
  AvatarFilter,
  BlurFilter,
  BulgeFilter,
  ColorizeFilter,
  ContrastFilter,
  DenoiseFilter,
  DotScreenFilter,
  HalftoneFilter,
  HsbFilter,
  NoiseFilter,
  OilFilter,
  PixelateFilter,
  SwimFilter,
  SwirlFilter,
} from "../schema/template";

/** 把一个滤镜类型里的所有 `number | number[]` 字段拍平成数值的工具类型。 */
type FlattenFilter<T extends AvatarFilter> = {
  [K in keyof T as K extends "type"
    ? K
    : T[K] extends number | number[] | undefined
      ? K
      : never]: K extends "type" ? T[K] : number;
};

export type ResolvedSwirlFilter = FlattenFilter<SwirlFilter>;
export type ResolvedBulgeFilter = FlattenFilter<BulgeFilter>;
export type ResolvedSwimFilter = FlattenFilter<SwimFilter>;
export type ResolvedBlurFilter = FlattenFilter<BlurFilter>;
export type ResolvedContrastFilter = FlattenFilter<ContrastFilter>;
export type ResolvedHsbFilter = FlattenFilter<HsbFilter>;
export type ResolvedHalftoneFilter = FlattenFilter<HalftoneFilter>;
export type ResolvedDotScreenFilter = FlattenFilter<DotScreenFilter>;
export type ResolvedNoiseFilter = FlattenFilter<NoiseFilter>;
export type ResolvedDenoiseFilter = FlattenFilter<DenoiseFilter>;
export type ResolvedOilFilter = FlattenFilter<OilFilter>;
export type ResolvedColorizeFilter = ColorizeFilter;
export type ResolvedAfterimageFilter = FlattenFilter<AfterimageFilter>;
export type ResolvedPixelateFilter = FlattenFilter<PixelateFilter>;

export type ResolvedAvatarFilter =
  | ResolvedSwirlFilter
  | ResolvedBulgeFilter
  | ResolvedSwimFilter
  | ResolvedBlurFilter
  | ResolvedContrastFilter
  | ResolvedHsbFilter
  | ResolvedHalftoneFilter
  | ResolvedDotScreenFilter
  | ResolvedNoiseFilter
  | ResolvedDenoiseFilter
  | ResolvedOilFilter
  | ResolvedColorizeFilter
  | ResolvedAfterimageFilter
  | ResolvedPixelateFilter;

/** 数组按 frameIndex 取值，越界取最后一个 */
function pick(value: number | number[], frameIndex: number): number {
  if (typeof value === "number") return value;
  if (value.length === 0) return 0;
  return value[Math.min(frameIndex, value.length - 1)];
}

/** 把单个滤镜的所有 `number | number[]` 字段按 `frameIndex` 解析成数值。 */
function resolveOne(filter: AvatarFilter, frameIndex: number): ResolvedAvatarFilter {
  if (filter.type === "COLORIZE") return filter;
  const out: Record<string, unknown> = { type: filter.type };
  for (const [k, v] of Object.entries(filter)) {
    if (k === "type") continue;
    out[k] = Array.isArray(v) ? pick(v, frameIndex) : v;
  }
  return out as unknown as ResolvedAvatarFilter;
}

/**
 * 解析一串滤镜到指定帧的「扁平」参数。
 * 用于 prepareAvatar 在准备阶段为每一帧预渲染滤镜效果。
 */
export function resolveFiltersForFrame(
  filters: readonly AvatarFilter[],
  frameIndex: number,
): ResolvedAvatarFilter[] {
  return filters.map((f) => resolveOne(f, frameIndex));
}
