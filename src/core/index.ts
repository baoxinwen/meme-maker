/**
 * 公开 API。
 */

// 数据结构校验与类型
export {
  parseTemplate,
  type PetpetTemplate,
  type AvatarTemplate,
  type TextTemplate,
  type BackgroundTemplate,
  type BackgroundLayer,
  type FrameTransform,
  type PetpetType,
  type AvatarType,
  type AvatarFit,
  type AvatarPosType,
  type AvatarCropType,
  type AvatarStyle,
  type AvatarProjection,
  type AvatarInputCycle,
  type TemplateOption,
  type TemplateOptionValue,
  type TextAlign,
  type TextWrap,
  type TextStyle,
  type TextPosition,
  type TransformOrigin,
} from "./schema/template";

// 渲染主流程
export {
  prepareScene,
  renderFrame,
  renderAllFrames,
  type PreparedScene,
  type PrepareSceneOptions,
} from "./renderer/compositor";

export {
  createAvatarResourceBudget,
  normalizeAvatarCrop,
  FULL_AVATAR_CROP,
  AVATAR_CROP_EPSILON,
  type AvatarDecodeOptions,
  type AvatarCrop,
  type AvatarInput,
  type AvatarInputs,
  type AvatarResourceBudget,
  type AvatarSource,
  type PreparedAvatar,
} from "./renderer/avatar";
export { resolveTemplateText } from "./renderer/text";
export type { PreparedText } from "./renderer/text";
export type { BackgroundFrame, BackgroundLayerImages } from "./renderer/background";
export {
  resolveOptionString,
  resolveTemplateOptionValues,
  templateOptionVariables,
  type TemplateOptionValues,
} from "./options";

// GIF 编解码
export { encodeGif, type GifEncodeOptions } from "./codec/gif-encoder";
export {
  DEFAULT_MAX_GIF_FRAMES,
  DEFAULT_MAX_GIF_MEMORY_BYTES,
  DEFAULT_MAX_GIF_TOTAL_PIXELS,
  decodeGif,
  type DecodeGifOptions,
  type DecodedGif,
} from "./codec/gif-decoder";
// 视频解码
export { decodeVideo, type DecodeVideoOptions } from "./codec/video-decoder";
// 静态图片尺寸元数据预检
export {
  readImageMetadata,
  type ImageMetadata,
  type SupportedImageFormat,
} from "./codec/image-metadata";

// 图像滤镜（纯 Canvas 2D，无 WebGL）
export { applyFilters } from "./filters";
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
} from "./schema/template";

// 运行时（用于 Node 测试时注入 @napi-rs/canvas）
export {
  setRuntime,
  getRuntime,
  createCanvas,
  loadImage,
  type CoreRuntime,
  type RuntimeCanvas,
  type RuntimeImage,
  type RuntimeContext,
} from "./utils/runtime";

// 图像变换工具（公开备用）
export {
  cropImage,
  squareImage,
  flipImage,
  mirrorImage,
  grayImage,
  binarizeImage,
  invertImage,
  clipCircleImage,
  clipMaskImage,
  clipPolygonImage,
  projectRotateY,
  drawFit,
} from "./transforms";

// 颜色辅助
export { parseColor } from "./utils/color";

// 结构化错误
export { MissingAvatarInputError, isMissingAvatarInputError } from "./utils/errors";
export { MAX_MEDIA_EDGE, MAX_SCENE_FRAMES } from "./limits";
