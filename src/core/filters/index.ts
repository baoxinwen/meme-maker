/**
 * 滤镜模块统一出口。
 *
 * - applyFilters：主入口，按顺序应用一串滤镜
 * - 各滤镜函数：单独导出，便于测试或直接调用
 * - 类型从数据结构模块统一导出
 */

export { applyFilters } from "./apply-filters";
export { resolveFiltersForFrame } from "./resolve-frame";
export type {
  ResolvedAvatarFilter,
  ResolvedAfterimageFilter,
  ResolvedSwirlFilter,
  ResolvedBulgeFilter,
  ResolvedSwimFilter,
  ResolvedBlurFilter,
  ResolvedContrastFilter,
  ResolvedHsbFilter,
  ResolvedHalftoneFilter,
  ResolvedDotScreenFilter,
  ResolvedNoiseFilter,
  ResolvedDenoiseFilter,
  ResolvedOilFilter,
  ResolvedColorizeFilter,
  ResolvedPixelateFilter,
} from "./resolve-frame";
export { blurFilter } from "./blur";
export { afterimageFilter } from "./afterimage";
export { noiseFilter } from "./noise";
export { contrastFilter } from "./contrast";
export { colorizeFilter } from "./colorize";
export { hsbFilter } from "./hsb";
export { denoiseFilter } from "./denoise";
export { oilFilter } from "./oil";
export { pixelateFilter } from "./pixelate";
export { swirlFilter } from "./swirl";
export { bulgeFilter } from "./bulge";
export { swimFilter } from "./swim";
export { halftoneFilter } from "./halftone";
export { dotScreenFilter } from "./dot-screen";
export { renderScreen, luminance, rgbToCmyk } from "./screen";
export type { ScreenPlane } from "./screen";

// 滤镜数据类型（Zod 结构定义位于 schema/template.ts，这里仅转出类型）
export type {
  AvatarFilter,
  AvatarFilterType,
  AfterimageFilter,
  SwirlFilter,
  BulgeFilter,
  SwimFilter,
  BlurFilter,
  ContrastFilter,
  HsbFilter,
  HalftoneFilter,
  DotScreenFilter,
  NoiseFilter,
  DenoiseFilter,
  OilFilter,
  ColorizeFilter,
  PixelateFilter,
} from "../schema/template";
