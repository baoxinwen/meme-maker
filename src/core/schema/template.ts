/**
 * 核心数据结构 —— 用 Zod 在运行时校验 `data.json`，
 * 同时通过 z.infer 生成对应的 TypeScript 类型。
 * 模板字段在此集中声明，未声明字段会由 Zod 丢弃。
 */

import { z } from "zod";
import { MAX_MEDIA_EDGE, MAX_SCENE_FRAMES, MAX_USER_AVATAR_INPUTS } from "../limits";

// ============================================================================
// 枚举
// ============================================================================

export const PetpetTypeSchema = z.enum(["IMG", "GIF"]);
export type PetpetType = z.infer<typeof PetpetTypeSchema>;

export const AvatarTypeSchema = z.enum(["FROM", "TO", "BOT", "GROUP", "RANDOM", "USER"]);
export type AvatarType = z.infer<typeof AvatarTypeSchema>;

export const AvatarPosTypeSchema = z.enum(["ZOOM", "DEFORM"]);
export type AvatarPosType = z.infer<typeof AvatarPosTypeSchema>;

export const AvatarCropTypeSchema = z.enum(["NONE", "PIXEL", "PERCENT"]);
export type AvatarCropType = z.infer<typeof AvatarCropTypeSchema>;

export const AvatarFitSchema = z.enum(["CONTAIN", "COVER", "FILL"]);
export type AvatarFit = z.infer<typeof AvatarFitSchema>;

export const AvatarStyleSchema = z.enum(["MIRROR", "FLIP", "GRAY", "BINARIZATION", "INVERT"]);
export type AvatarStyle = z.infer<typeof AvatarStyleSchema>;

export const TextAlignSchema = z.enum(["LEFT", "RIGHT", "CENTER"]);
export type TextAlign = z.infer<typeof TextAlignSchema>;

export const TextWrapSchema = z.enum(["NONE", "BREAK", "ZOOM"]);
export type TextWrap = z.infer<typeof TextWrapSchema>;

export const TextStyleSchema = z.enum(["PLAIN", "BOLD", "ITALIC", "BOLD_ITALIC"]);
export type TextStyle = z.infer<typeof TextStyleSchema>;

/**
 * 文字坐标计算基准（`position` 字段）。
 *
 * `position: [x基准, y基准]`，默认 `[LEFT, TOP]`。基准决定 `pos[x,y]` 相对何处定位：
 * - LEFT/TOP：以 `pos` 为绝对坐标（默认）
 * - CENTER：x → 画布宽度/2 + pos[0]；y → 画布高度/2 + pos[1]
 * - RIGHT：x → 画布宽度 - 文本宽 + pos[0]（文本右边缘贴齐画布右边）
 * - BOTTOM：y → 画布高度 - 文本高 + pos[1]（文本下边缘贴齐画布底边）
 *
 * 动态长度对应 xCenterDynamicLength="50vw"、bottomDynamicLength="100vh-100ch" 等表达式。
 * 例：bible（典中典）用 `position: ["CENTER","BOTTOM"]` 让字幕水平居中、贴底。
 */
export const TextPositionSchema = z.enum(["LEFT", "RIGHT", "TOP", "BOTTOM", "CENTER"]);
export type TextPosition = z.infer<typeof TextPositionSchema>;

export const TransformOriginSchema = z.enum(["DEFAULT", "CENTER"]);
export type TransformOrigin = z.infer<typeof TransformOriginSchema>;

/** 预旋转后的画布尺寸：保持原尺寸裁切，或扩展到完整包围盒。 */
export const AvatarPreRotateModeSchema = z.enum(["CROP", "EXPAND"]);
export type AvatarPreRotateMode = z.infer<typeof AvatarPreRotateModeSchema>;

// ============================================================================
// 坐标 —— 可以是数字，也可以是表达式字符串（如 "avatar0Width / 2"）
// ============================================================================

export const NumberOrExprSchema = z.union([z.number(), z.string()]);
export type NumberOrExpr = z.infer<typeof NumberOrExprSchema>;

export const MAX_TEXT_FONT_SIZE = 1024;
export const MAX_AVATAR_FILTERS = 32;
export const MAX_AVATAR_STYLES = 16;
export const MAX_AVATAR_CLIP_POLYGON_POINTS = 256;
export const MAX_TEMPLATE_AVATARS = 64;
export const MAX_TEMPLATE_TEXTS = 32;
export const MAX_BACKGROUND_LAYERS = 128;
export const MAX_FOREGROUND_LAYERS = 16;

const TextMaxSizeSchema = z.union([z.number().finite().max(MAX_TEXT_FONT_SIZE), z.string()]);

/** 单值或逐帧数值。数组不足场景帧数时复用最后一项。空数组无意义，解析期直接拒绝。 */
export const NumberOrFrameArraySchema = z.union([
  z.number().finite(),
  z.array(z.number().finite()).min(1).max(1024),
]);
export type NumberOrFrameArray = z.infer<typeof NumberOrFrameArraySchema>;

/** 不透明度：单值或逐帧，取值范围 [0, 1]。越界值赋给 globalAlpha 会被 Canvas 静默忽略。 */
const OpacitySchema = z.union([
  z.number().finite().min(0).max(1),
  z.array(z.number().finite().min(0).max(1)).min(1).max(1024),
]);

/** 完整场景合成后的帧级变换。 */
export const FrameTransformSchema = z.object({
  type: z.literal("ROTATE_CROP"),
  /** 顺时针旋转角度；数组按输出帧取值，越界时复用最后一项。 */
  angle: NumberOrFrameArraySchema,
  /** 最终裁切区域：[x, y, width, height]。 */
  crop: z.tuple([
    z.number().int().nonnegative(),
    z.number().int().nonnegative(),
    z.number().int().positive(),
    z.number().int().positive(),
  ]),
});
export type FrameTransform = z.infer<typeof FrameTransformSchema>;

/** 把头像平面按透视相机绕 Y 轴旋转。 */
export const AvatarProjectionSchema = z.object({
  type: z.literal("ROTATE_Y"),
  angle: NumberOrFrameArraySchema,
  /** 垂直视场角，单位为度。 */
  fov: z.number().gt(0).lt(180).default(45),
  /** 角度数组结束后是否从头循环。 */
  loop: z.boolean().default(false),
  /** 自定义四角三维模型，顺序为左上、右上、右下、左下。 */
  model: z
    .tuple([
      z.tuple([z.number(), z.number(), z.number()]),
      z.tuple([z.number(), z.number(), z.number()]),
      z.tuple([z.number(), z.number(), z.number()]),
      z.tuple([z.number(), z.number(), z.number()]),
    ])
    .optional(),
  /** 用于按 FOV 计算焦距的相机平面尺寸，默认使用头像绘制尺寸。 */
  cameraSize: z.tuple([z.number().positive(), z.number().positive()]).optional(),
  /** BOUNDS_CENTER 居中投影包围盒；MODEL_CENTER 保持三维模型中心。 */
  align: z.enum(["BOUNDS_CENTER", "MODEL_CENTER"]).default("BOUNDS_CENTER"),
});
export type AvatarProjection = z.infer<typeof AvatarProjectionSchema>;

export const AvatarInputCycleSchema = z.object({
  /** 每张 USER 输入持续的场景帧数。 */
  framesPerInput: z.number().int().positive().max(MAX_SCENE_FRAMES),
  /** 相对当前阶段选取后续输入，支持负数。 */
  offset: z.number().int().default(0),
  /** 此图层允许参与循环的最大输入数。 */
  maxInputs: z.number().int().positive().max(MAX_USER_AVATAR_INPUTS).optional(),
});
export type AvatarInputCycle = z.infer<typeof AvatarInputCycleSchema>;

const TemplateOptionKeySchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]*$/, "选项 key 只能包含英文字母、数字和下划线");

const BooleanTemplateOptionSchema = z.object({
  type: z.literal("BOOLEAN"),
  key: TemplateOptionKeySchema,
  label: z.string().min(1),
  default: z.boolean().default(false),
});

const SelectTemplateOptionSchema = z.object({
  type: z.literal("SELECT"),
  key: TemplateOptionKeySchema,
  label: z.string().min(1),
  default: z.string(),
  choices: z.array(z.object({ value: z.string(), label: z.string().min(1) })).min(1),
});

const NumberTemplateOptionSchema = z.object({
  type: z.literal("NUMBER"),
  key: TemplateOptionKeySchema,
  label: z.string().min(1),
  default: z.number(),
  min: z.number(),
  max: z.number(),
  step: z.number().positive().default(1),
});

const TextTemplateOptionSchema = z.object({
  type: z.literal("TEXT"),
  key: TemplateOptionKeySchema,
  label: z.string().min(1),
  default: z.string().default(""),
  placeholder: z.string().optional(),
  maxLength: z.number().int().positive().default(100),
});

export const TemplateOptionSchema = z.discriminatedUnion("type", [
  BooleanTemplateOptionSchema,
  SelectTemplateOptionSchema,
  NumberTemplateOptionSchema,
  TextTemplateOptionSchema,
]);
export type TemplateOption = z.infer<typeof TemplateOptionSchema>;
export type TemplateOptionValue = boolean | number | string;

const TemplateAssetNameSchema = z.string().regex(/^[\w.-]+\.png$/, "资源文件名必须是 PNG 文件名");

// ============================================================================
// 头像模板
// ============================================================================

const CropPairOrQuad = z.union([
  z.tuple([z.number(), z.number()]),
  z.tuple([z.number(), z.number(), z.number(), z.number()]),
]);

const AvatarCanvasDimensionSchema = z.number().finite().int().positive().max(MAX_MEDIA_EDGE);
const AvatarCanvasSizeSchema = z.tuple([AvatarCanvasDimensionSchema, AvatarCanvasDimensionSchema]);
const AvatarPreFitSizeSchema = z.union([
  AvatarCanvasSizeSchema,
  z.array(AvatarCanvasSizeSchema).max(MAX_SCENE_FRAMES),
]);

// ============================================================================
// 头像滤镜（`filter` 字段）
//
// 这里定义各类滤镜的数据结构；实现位于 src/core/filters/，使用纯 Canvas 2D。
// ============================================================================

/**
 * 滤镜的「数值参数」类型：可以是单个数字（所有帧用同一个值），
 * 也可以是数字数组（逐帧动画值，第 N 帧用数组的第 N 个，越界则取最后一个）。
 *
 * 特效模板（swirl/bulge/rgb/swim）的 filter 参数可以使用数组形式，
 * 如 `swirl.angle = [0, 0.6, 1.5, ...]` 表示每帧的旋转量。数据结构层允许该形式，
 * 实际按帧取值在 prepareAvatar 里完成（resolveFilterForFrame）。
 */
const finiteNumber = z.number().finite();
const normalizedFilterCoordinate = finiteNumber.min(0).max(1);
const boundedFilterNumber = (min: number, max: number) =>
  z.union([finiteNumber.min(min).max(max), z.array(finiteNumber.min(min).max(max)).max(1024)]);
export const FilterNumberSchema = z.union([finiteNumber, z.array(finiteNumber).max(1024)]);
/** 运行时取值后的扁平滤镜参数：所有字段都是数值。 */
export type FilterNumberValue = number;

export const SwirlFilterSchema = z.object({
  type: z.literal("SWIRL"),
  radius: boundedFilterNumber(0, 4096).default(0),
  angle: boundedFilterNumber(-1000, 1000).default(3),
  x: finiteNumber.default(0.5),
  y: finiteNumber.default(0.5),
});
export type SwirlFilter = z.infer<typeof SwirlFilterSchema>;

export const BulgeFilterSchema = z.object({
  type: z.literal("BULGE"),
  radius: boundedFilterNumber(0, 4096).default(0),
  strength: boundedFilterNumber(-1, 1).default(0.5),
  x: finiteNumber.default(0.5),
  y: finiteNumber.default(0.5),
});
export type BulgeFilter = z.infer<typeof BulgeFilterSchema>;

export const SwimFilterSchema = z.object({
  type: z.literal("SWIM"),
  scale: boundedFilterNumber(0.01, 4096).default(32),
  stretch: boundedFilterNumber(-100, 100).default(1),
  angle: boundedFilterNumber(-1000, 1000).default(0),
  amount: boundedFilterNumber(-4096, 4096).default(10),
  turbulence: boundedFilterNumber(-100, 100).default(1),
  time: boundedFilterNumber(-100000, 100000).default(0),
});
export type SwimFilter = z.infer<typeof SwimFilterSchema>;

export const BlurFilterSchema = z.object({
  type: z.literal("BLUR"),
  radius: boundedFilterNumber(0, 4096).default(10),
});
export type BlurFilter = z.infer<typeof BlurFilterSchema>;

export const ContrastFilterSchema = z.object({
  type: z.literal("CONTRAST"),
  brightness: boundedFilterNumber(-1, 1).default(0),
  contrast: boundedFilterNumber(-1, 1).default(0),
});
export type ContrastFilter = z.infer<typeof ContrastFilterSchema>;

export const HsbFilterSchema = z.object({
  type: z.literal("HSB"),
  hue: boundedFilterNumber(-1, 1).default(0),
  saturation: boundedFilterNumber(-1, 1).default(0),
  brightness: boundedFilterNumber(-1, 1).default(0),
});
export type HsbFilter = z.infer<typeof HsbFilterSchema>;

export const HalftoneFilterSchema = z.object({
  type: z.literal("HALFTONE"),
  angle: boundedFilterNumber(-1000, 1000).default(0),
  radius: boundedFilterNumber(0, 4096).default(4),
  x: normalizedFilterCoordinate.default(0.5),
  y: normalizedFilterCoordinate.default(0.5),
});
export type HalftoneFilter = z.infer<typeof HalftoneFilterSchema>;

export const DotScreenFilterSchema = z.object({
  type: z.literal("DOT_SCREEN"),
  angle: boundedFilterNumber(-1000, 1000).default(0),
  radius: boundedFilterNumber(0, 4096).default(4),
  x: normalizedFilterCoordinate.default(0.5),
  y: normalizedFilterCoordinate.default(0.5),
});
export type DotScreenFilter = z.infer<typeof DotScreenFilterSchema>;

export const NoiseFilterSchema = z.object({
  type: z.literal("NOISE"),
  amount: boundedFilterNumber(0, 1).default(0.25),
});
export type NoiseFilter = z.infer<typeof NoiseFilterSchema>;

export const DenoiseFilterSchema = z.object({
  type: z.literal("DENOISE"),
  exponent: boundedFilterNumber(0, 100).default(20),
});
export type DenoiseFilter = z.infer<typeof DenoiseFilterSchema>;

export const OilFilterSchema = z.object({
  type: z.literal("OIL"),
  skip: boundedFilterNumber(1, 64).default(4),
  levels: boundedFilterNumber(1, 64).default(8),
  range: boundedFilterNumber(0, 256).default(12),
});
export type OilFilter = z.infer<typeof OilFilterSchema>;

/** 保留原图明度，替换为指定颜色的色相与饱和度。 */
export const ColorizeFilterSchema = z.object({
  type: z.literal("COLORIZE"),
  color: z.tuple([
    z.number().int().min(0).max(255),
    z.number().int().min(0).max(255),
    z.number().int().min(0).max(255),
  ]),
});
export type ColorizeFilter = z.infer<typeof ColorizeFilterSchema>;

/** 纵向残影：在原图上叠加从 0 开始逐像素向下偏移的低透明度副本。 */
export const AfterimageFilterSchema = z.object({
  type: z.literal("AFTERIMAGE"),
  fraction: boundedFilterNumber(0, 1).default(0.1),
  opacity: boundedFilterNumber(0, 1).default(0.01),
});
export type AfterimageFilter = z.infer<typeof AfterimageFilterSchema>;

/** 先缩小再关闭平滑放大，形成规则像素块。 */
export const PixelateFilterSchema = z.object({
  type: z.literal("PIXELATE"),
  size: boundedFilterNumber(1, 4096).default(10),
});
export type PixelateFilter = z.infer<typeof PixelateFilterSchema>;

/**
 * 所有滤镜的鉴别联合。解析时自动补默认值。
 *
 * `type` 同时接受大小写写法，预处理会统一转为大写再鉴别。
 */
function normalizeFilterType(val: unknown): unknown {
  if (val && typeof val === "object" && "type" in val) {
    const obj = val as Record<string, unknown>;
    if (typeof obj.type === "string") {
      return { ...obj, type: obj.type.toUpperCase() };
    }
  }
  return val;
}

export const AvatarFilterSchema = z.preprocess(
  normalizeFilterType,
  z.discriminatedUnion("type", [
    SwirlFilterSchema,
    BulgeFilterSchema,
    SwimFilterSchema,
    BlurFilterSchema,
    ContrastFilterSchema,
    HsbFilterSchema,
    HalftoneFilterSchema,
    DotScreenFilterSchema,
    NoiseFilterSchema,
    DenoiseFilterSchema,
    OilFilterSchema,
    ColorizeFilterSchema,
    AfterimageFilterSchema,
    PixelateFilterSchema,
  ]),
);
export type AvatarFilter = z.infer<typeof AvatarFilterSchema>;

export type AvatarFilterType = AvatarFilter["type"];

export const AvatarTemplateSchema = z.object({
  type: AvatarTypeSchema,
  /** 数值条件，结果为 0 时跳过此头像图层。 */
  when: NumberOrExprSchema.optional(),
  /** USER 类型在顺序头像列表中的下标，从 0 开始。 */
  input: z.number().int().nonnegative().optional(),
  /** USER 输入缺失时使用的备用下标。 */
  fallbackInput: z.number().int().nonnegative().optional(),
  /** 仅当指定 USER 输入存在时才显示此图层。 */
  visibleWhenInput: z.number().int().nonnegative().optional(),
  /** 缺少该输入时跳过此图层，不阻断整个模板渲染。 */
  optional: z.boolean().optional(),
  /** USER 多头像按时间阶段循环选取。 */
  inputCycle: AvatarInputCycleSchema.optional(),
  /**
   * 头像位置。结构因 posType 而异：
   * - ZOOM 单帧:  [x, y, w, h]
   * - ZOOM 多帧:  [[x, y, w, h], [x, y, w, h], ...]
   * - DEFORM 单帧: [[x1,y1],[x2,y2],[x3,y3],[x4,y4],[xa,ya]]  (4 角 + 锚点)
   * - DEFORM 多帧: [[...], [...], ...]
   *
   * pos 内部元素可以是数字或表达式字符串。
   * 真正解析在 compileAvatarPos() 完成。
   */
  pos: z.array(z.unknown()),
  posType: AvatarPosTypeSchema.optional(),
  /** DEFORM 前先将头像适配到指定源尺寸，再映射到目标四边形。 */
  deformSize: AvatarCanvasSizeSchema.optional(),
  /** DEFORM 源尺寸适配后再裁剪，用于兼容先 COVER 再切片的模板。 */
  deformCrop: CropPairOrQuad.nullable().optional(),
  /** 绘制前先将头像适配到固定尺寸或逐帧尺寸，适用于 ZOOM 与 DEFORM。 */
  preFitSize: AvatarPreFitSizeSchema.optional(),
  /** 预适配后叠在头像下方的纯色背景，用于透明头像与蒙版组合。 */
  backgroundColor: z.string().optional(),
  /** 预适配后应用的静态 alpha 蒙版资源。 */
  mask: TemplateAssetNameSchema.optional(),

  crop: CropPairOrQuad.nullable().optional(),
  cropType: AvatarCropTypeSchema.optional(),
  /** 从中心裁出最大正方形，用于兼容上游模板的 square() 变换。 */
  square: z.boolean().optional(),
  /** 预适配后的像素坐标裁切多边形。 */
  clipPolygon: z
    .array(z.tuple([z.number(), z.number()]))
    .min(3)
    .max(MAX_AVATAR_CLIP_POLYGON_POINTS)
    .optional(),

  style: z.array(AvatarStyleSchema).max(MAX_AVATAR_STYLES).optional(),
  /** 图像滤镜（SWIRL/BULGE/OIL/...）；由 src/core/filters/ 纯 Canvas 2D 实现 */
  filter: z.array(AvatarFilterSchema).max(MAX_AVATAR_FILTERS).optional(),
  fit: AvatarFitSchema.optional(),

  round: z.boolean().optional(),
  /** 预旋转：在适配尺寸后生成新画布，兼容上游的 rotate / rotate_crop。 */
  preRotate: NumberOrFrameArraySchema.optional(),
  preRotateMode: AvatarPreRotateModeSchema.optional(),
  rotate: z.boolean().optional(),
  origin: TransformOriginSchema.optional(),
  avatarOnTop: z.boolean().optional(),
  /** Canvas 尽力兼容：映射到 imageSmoothingEnabled；未填写时保持运行时默认值 */
  antialias: z.boolean().optional(),
  /** Canvas 尽力兼容：优先级高于 antialias；未填写时保持运行时默认值 */
  resampling: z.boolean().optional(),

  angle: NumberOrFrameArraySchema.optional(),
  opacity: OpacitySchema.optional(),
  projection: AvatarProjectionSchema.optional(),
});
export type AvatarTemplate = z.infer<typeof AvatarTemplateSchema>;

// ============================================================================
// 文字模板
// ============================================================================

export const TextTemplateSchema = z.object({
  text: z.string(),
  /** 数值条件，结果为 0 时跳过当前帧的文字绘制。 */
  when: NumberOrExprSchema.optional(),
  color: z.string().optional(),
  /** [x, y] 或 [x, y, maxWidth] */
  pos: z
    .union([
      z.tuple([NumberOrExprSchema, NumberOrExprSchema]),
      z.tuple([NumberOrExprSchema, NumberOrExprSchema, NumberOrExprSchema]),
    ])
    .optional(),
  /** [left, top, right, bottom] 文字区域，启用区域自动字号与换行。 */
  area: z
    .tuple([NumberOrExprSchema, NumberOrExprSchema, NumberOrExprSchema, NumberOrExprSchema])
    .optional(),
  /** 区域自动字号的最小值，默认 1。 */
  minSize: NumberOrExprSchema.optional(),
  /** 区域自动字号的最大值，默认 size。 */
  maxSize: TextMaxSizeSchema.optional(),
  angle: NumberOrExprSchema.optional(),
  origin: TransformOriginSchema.optional(),
  /** 把本地文字画布透视映射到目标四边形。 */
  deformSize: z.tuple([NumberOrExprSchema, NumberOrExprSchema]).optional(),
  deform: z
    .tuple([
      z.tuple([NumberOrExprSchema, NumberOrExprSchema]),
      z.tuple([NumberOrExprSchema, NumberOrExprSchema]),
      z.tuple([NumberOrExprSchema, NumberOrExprSchema]),
      z.tuple([NumberOrExprSchema, NumberOrExprSchema]),
    ])
    .optional(),
  size: NumberOrExprSchema.optional(),
  font: z.string().optional(),
  style: TextStyleSchema.optional(),
  align: TextAlignSchema.optional(),
  wrap: TextWrapSchema.optional(),
  /** 坐标计算基准 [x基准, y基准]，默认 [LEFT, TOP]；详见 TextPositionSchema */
  position: z.tuple([TextPositionSchema, TextPositionSchema]).optional(),
  /**
   * 是否贪婪匹配多余的关键词变量（`$txt` 多参数场景）。
   * 该字段用于多参数文字解析；当前产品用整段文字编辑，没有对应入口。
   * 因此字段仅作数据保真保留，不影响渲染。
   */
  greedy: z.boolean().optional(),
  strokeColor: z.string().optional(),
  strokeSize: NumberOrExprSchema.optional(),
});
export type TextTemplate = z.infer<typeof TextTemplateSchema>;

// ============================================================================
// 背景模板
// ============================================================================

export const BackgroundLayerSchema = z.object({
  /** 模板目录内的静态 PNG 资源文件名。 */
  asset: TemplateAssetNameSchema,
  /** 数值条件，结果为 0 时跳过此图层。 */
  when: NumberOrExprSchema.optional(),
  /** 图层左上角，缺省为 [0, 0]。 */
  pos: z.tuple([NumberOrExprSchema, NumberOrExprSchema]).optional(),
  /** 图层目标尺寸；缺省时按资源原始尺寸绘制。 */
  size: z.tuple([NumberOrExprSchema, NumberOrExprSchema]).optional(),
  /** 指定 size 后的适配方式。 */
  fit: AvatarFitSchema.optional(),
});
export type BackgroundLayer = z.infer<typeof BackgroundLayerSchema>;

/** [r, g, b] 每通道 0-255 整数；越界值拼出非法 rgba 串会被 Canvas 静默忽略、按黑色渲染。 */
const RgbChannelSchema = z.number().int().min(0).max(255);

export const BackgroundTemplateSchema = z.object({
  /** [width, height]，可以是数字或表达式字符串 */
  size: z.tuple([NumberOrExprSchema, NumberOrExprSchema]),
  color: z
    .union([
      z.string(),
      z.tuple([RgbChannelSchema, RgbChannelSchema, RgbChannelSchema]),
      z.tuple([
        RgbChannelSchema,
        RgbChannelSchema,
        RgbChannelSchema,
        z.number().finite().min(0).max(1),
      ]),
    ])
    .optional(),
  /**
   * 外部背景图在画布中的绘制区域。未填写时保持原有语义：按资源原始尺寸从左上角绘制。
   * 表达式可使用 width、height、imageWidth、imageHeight 与头像/文字尺寸变量。
   */
  imagePos: z.tuple([NumberOrExprSchema, NumberOrExprSchema]).optional(),
  imageSize: z.tuple([NumberOrExprSchema, NumberOrExprSchema]).optional(),
  /** 外部背景图在 imageSize 区域内的适配方式；需要 imageSize 才生效。 */
  imageFit: AvatarFitSchema.optional(),
  /** 合成完成后裁切圆角，适用于头像卡片类模板。 */
  round: z.number().positive().optional(),
  /** 在背景主图之后叠加的静态资源层。 */
  layers: z.array(BackgroundLayerSchema).max(MAX_BACKGROUND_LAYERS).optional(),
  /** 在头像与文字之后叠加的静态前景层。 */
  foregroundLayers: z.array(BackgroundLayerSchema).max(MAX_FOREGROUND_LAYERS).optional(),
  /**
   * 帧数 —— 特效模板（如 swirl）没有外部背景图，靠纯色画布 + 头像滤镜产生动画。
   * 这个 length 决定该模板有多少帧（配合逐帧滤镜参数数组）。
   * 普通模板不填，帧数由外部背景图数量决定。
   */
  length: z.number().finite().int().positive().max(1024).optional(),
});
export type BackgroundTemplate = z.infer<typeof BackgroundTemplateSchema>;

// ============================================================================
// 顶级模板
// ============================================================================

export const PetpetTemplateSchema = z.object({
  type: PetpetTypeSchema,
  avatar: z.array(AvatarTemplateSchema).max(MAX_TEMPLATE_AVATARS).default([]),
  text: z.array(TextTemplateSchema).max(MAX_TEMPLATE_TEXTS).default([]),
  background: BackgroundTemplateSchema.optional(),
  /** 所有图层合成完成后执行的帧级变换。 */
  frameTransform: FrameTransformSchema.optional(),
  /** 预览生成工具优先使用的代表帧下标。 */
  previewFrame: z.number().int().nonnegative().optional(),
  /** 主应用可编辑的声明式模板选项。 */
  options: z.array(TemplateOptionSchema).default([]),

  /** GIF 默认每帧延迟（毫秒），默认 65 */
  delay: z.number().finite().optional(),
  alias: z.array(z.string()).optional(),
  /**
   * 随机模板池标记。当前浏览器产品没有随机模板入口，
   * 字段仅作数据保真保留，不影响模板选择器。
   */
  inRandomList: z.boolean().optional(),
  reverse: z.boolean().optional(),
  hidden: z.boolean().optional(),

  /** 仓库索引用 —— 运行时由加载器写入 */
  key: z.string().optional(),
  url: z.string().optional(),
});
export type PetpetTemplate = z.infer<typeof PetpetTemplateSchema>;

// ============================================================================
// 解析函数
// ============================================================================

/**
 * 校验并解析模板 JSON。失败时抛出可读的错误信息。
 */
export function parseTemplate(input: unknown): PetpetTemplate {
  const result = PetpetTemplateSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  · ${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("\n");
    throw new Error(`模板格式不正确:\n${issues}`);
  }
  return result.data;
}
