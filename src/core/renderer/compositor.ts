/**
 * 顶层合成器 —— 把模板 + 输入数据 → 准备好的场景 → 一组成品帧。
 *
 * 流程：
 *   1. parseTemplate()       校验模板
 *   2. prepareScene()        异步：加载/解码所有头像、准备背景、布局文字
 *   3. renderFrame()         同步：把指定帧画到 canvas
 *
 * 设计要点：
 *   - "准备阶段"做完所有 IO 和昂贵的预计算；"渲染阶段"是纯同步像素操作
 *   - 准备阶段统一收敛异步任务，渲染阶段保持同步
 *   - 动画播放和定时器逻辑不在引擎里，由界面层（React 组件）控制
 */

import {
  DEFAULT_MAX_MEDIA_MEMORY_BYTES,
  DEFAULT_MAX_SCENE_TOTAL_PIXELS,
  MAX_CANVAS_EDGE,
  MAX_MEDIA_EDGE,
  MAX_SCENE_FRAMES,
} from "../limits";
import {
  type TemplateOptionValues,
  resolveOptionString,
  resolveTemplateOptionValues,
  templateOptionVariables,
} from "../options";
import { type PetpetTemplate, parseTemplate } from "../schema/template";
import { rotateImage } from "../transforms";
import { createCanvas } from "../utils/runtime";
import type { RuntimeCanvas, RuntimeContext } from "../utils/runtime";
import {
  type AvatarInputs,
  type PreparedAvatar,
  assertAvatarRenderBudget,
  createAvatarResourceBudget,
  drawAvatar,
  getAvatarDeclaredFrameCount,
  getAvatarFrameDelay,
  getAvatarMaxLength,
  getAvatarSize,
  hasAvatarInput,
  isAvatarHiddenByVisibleWhen,
  prepareAvatar,
  reserveAvatarSceneResources,
} from "./avatar";
import type { BackgroundFrame, BackgroundLayerImages } from "./background";
import { buildBackgrounds, buildForegrounds, resolveBackgroundSize } from "./background";
import {
  assertSceneResourceBudget,
  checkedScenePixelSum,
  measureCanvasBatchPixels,
  measureCanvasPixels,
  measureUniqueCanvasPixels,
  validateSceneBudget,
} from "./scene-budget";
import {
  type PreparedText,
  applyTextPositions,
  createMeasureContext,
  drawText,
  layoutTexts,
  measureTextDeformTemporaryPixels,
} from "./text";

export interface PreparedScene {
  readonly template: PetpetTemplate;
  readonly width: number;
  readonly height: number;
  /** 图层合成所用的工作画布尺寸；帧变换可能令最终输出尺寸更小。 */
  readonly renderWidth: number;
  readonly renderHeight: number;
  readonly frameCount: number;
  /** 默认每帧延迟（毫秒），仅 GIF 类型有意义 */
  readonly delay: number;
  /** 与最终输出帧一一对应的逐帧延迟（毫秒）。 */
  readonly frameDelays: readonly number[];
  /** 是否按反向帧序展示和导出（`reverse` 字段） */
  readonly reverse: boolean;
  readonly backgrounds: readonly RuntimeCanvas[];
  /** 在头像与文字之后绘制的透明前景帧。 */
  readonly foregrounds: readonly RuntimeCanvas[];
  readonly bottomAvatars: readonly PreparedAvatar[];
  readonly topAvatars: readonly PreparedAvatar[];
  readonly texts: readonly PreparedText[];
  /** 头像尺寸表达式变量，按 avatar0Width / avatar0Height 形式 */
  readonly sizeMap: Record<string, number>;
  /** 创建该场景时采用的同时驻留 Canvas 累计像素预算。 */
  readonly maxTotalPixels: number;
  /** 创建该场景时采用的同时驻留 Canvas 估算 RGBA 内存预算。 */
  readonly maxMediaMemoryBytes: number;
}

export interface PrepareSceneOptions {
  /** 用户上传的头像 */
  readonly inputs?: AvatarInputs;
  /** 外部背景图片列表（如从 0.png / 1.png ... 加载）；GIF 模板必填 */
  readonly backgroundImages?: readonly BackgroundFrame[];
  /** 模板声明的静态背景图层资源，按文件名映射。 */
  readonly backgroundLayerImages?: BackgroundLayerImages;
  /** 模板头像声明的静态蒙版资源，按文件名映射。 */
  readonly avatarMaskImages?: BackgroundLayerImages;
  /** 用户选择的模板选项；缺失或非法值由核心层回退到模板默认值。 */
  readonly optionValues?: TemplateOptionValues;
  /** 同时驻留的场景 Canvas 累计像素预算。 */
  readonly maxTotalPixels?: number;
  /** 头像管线及场景 Canvas 同时驻留时允许占用的估算 RGBA 内存。 */
  readonly maxMediaMemoryBytes?: number;
}

/**
 * 完整准备一个表情包场景。
 */
export async function prepareScene(
  rawTemplate: unknown,
  options: PrepareSceneOptions = {},
): Promise<PreparedScene> {
  const template = parseTemplate(rawTemplate);
  const inputs: AvatarInputs = options.inputs ?? {};
  const maxTotalPixels = validateSceneBudget(
    options.maxTotalPixels ?? DEFAULT_MAX_SCENE_TOTAL_PIXELS,
    "像素",
  );
  const maxMediaMemoryBytes = validateSceneBudget(
    options.maxMediaMemoryBytes ?? DEFAULT_MAX_MEDIA_MEMORY_BYTES,
    "内存",
  );
  const externalResources = collectReferencedExternalResources(template, inputs, options);
  const externalResourcePixels = measureUniqueCanvasPixels(externalResources, "场景外部常驻资源");
  const avatarResourceBudget = createAvatarResourceBudget({
    maxFrames: MAX_SCENE_FRAMES,
    maxEdge: MAX_MEDIA_EDGE,
    maxTotalPixels,
    maxMemoryBytes: maxMediaMemoryBytes,
  });
  reserveAvatarSceneResources(avatarResourceBudget, externalResourcePixels);
  const measureCtx = createMeasureContext();
  const optionValues = resolveTemplateOptionValues(template.options, options.optionValues);
  const optionVars = templateOptionVariables(template.options, optionValues);
  const textTemplates = template.text.map((text) => ({
    ...text,
    text: resolveOptionString(text.text, optionValues),
    ...(text.color && { color: resolveOptionString(text.color, optionValues) }),
    ...(text.font && { font: resolveOptionString(text.font, optionValues) }),
    ...(text.strokeColor && {
      strokeColor: resolveOptionString(text.strokeColor, optionValues),
    }),
  }));

  // 1. 先算出场景帧数，用于逐帧滤镜参数数组按帧展开。
  //    特效模板（swirl 等）无外部背景图，帧数来自 template.background.length；
  //    普通模板来自外部背景图数量；都没有则取 1。
  const bgImageCount = options.backgroundImages?.length ?? 0;
  const presetFrameCount = bgImageCount > 0 ? bgImageCount : (template.background?.length ?? 1);
  if (
    !Number.isInteger(presetFrameCount) ||
    presetFrameCount <= 0 ||
    presetFrameCount > MAX_SCENE_FRAMES
  ) {
    throw new Error(`背景帧数过多：${presetFrameCount}，最多支持 ${MAX_SCENE_FRAMES} 帧`);
  }
  const transformFrameCount = Array.isArray(template.frameTransform?.angle)
    ? template.frameTransform.angle.length
    : 0;
  const declaredAvatarFrameCount = template.avatar.reduce((max, avatar) => {
    if (
      (avatar.optional && !hasAvatarInput(avatar, inputs)) ||
      isAvatarHiddenByVisibleWhen(avatar, inputs)
    ) {
      return max;
    }
    return Math.max(max, getAvatarDeclaredFrameCount(avatar, inputs));
  }, 0);
  const declaredFrameCount =
    template.type === "GIF"
      ? Math.max(presetFrameCount, transformFrameCount, declaredAvatarFrameCount, 1)
      : Math.max(transformFrameCount, declaredAvatarFrameCount, 1);
  assertSceneFrameCount(declaredFrameCount);

  // 2. 准备所有头像（带帧数，逐帧滤镜参数按帧展开）
  const preparedByTemplateIndex: { index: number; avatar: PreparedAvatar | null }[] = [];
  for (const [index, avatarTemplate] of template.avatar.entries()) {
    preparedByTemplateIndex.push({
      index,
      avatar:
        (avatarTemplate.optional && !hasAvatarInput(avatarTemplate, inputs)) ||
        isAvatarHiddenByVisibleWhen(avatarTemplate, inputs)
          ? null
          : await prepareAvatar(
              avatarTemplate,
              inputs,
              declaredFrameCount,
              options.avatarMaskImages,
              { resourceBudget: avatarResourceBudget },
            ),
    });
  }
  const prepared = preparedByTemplateIndex.flatMap(({ avatar }) => (avatar ? [avatar] : []));

  // 3. 先建立头像与选项尺寸表，让高级文字坐标可引用它们。
  const sizeMap: Record<string, number> = { ...optionVars };
  for (const { avatar, index } of preparedByTemplateIndex) {
    if (!avatar) continue;
    const { width, height } = getAvatarSize(avatar);
    sizeMap[`avatar${index}Width`] = width;
    sizeMap[`avatar${index}Height`] = height;
  }
  // 4. 布局文字，再注入文字尺寸变量供背景表达式复用。
  const texts = layoutTexts(textTemplates, measureCtx, sizeMap);
  texts.forEach((t, i) => {
    sizeMap[`text${i}Width`] = t.bboxWidth;
    sizeMap[`text${i}Height`] = t.bboxHeight;
  });

  const frameCount = computeFrameCount(template, prepared, presetFrameCount);
  assertSceneFrameCount(frameCount);
  const frameDelays = computeFrameDelays(template, prepared, frameCount);

  // 5. 准备背景（此时 sizeMap 含 option + avatar + text 尺寸）
  const [renderWidth, renderHeight] = resolveBackgroundSize(
    template.background,
    options.backgroundImages,
    sizeMap,
  );
  assertCanvasSize(renderWidth, renderHeight);
  const avatarTemporaryPixels = assertAvatarRenderBudget(
    prepared,
    frameCount,
    { ...sizeMap, canvasWidth: renderWidth, canvasHeight: renderHeight },
    avatarResourceBudget,
  );
  assertScenePixelBudget(renderWidth, renderHeight, frameCount, maxTotalPixels);
  const crop = template.frameTransform?.crop;
  const width = crop?.[2] ?? renderWidth;
  const height = crop?.[3] ?? renderHeight;
  assertCanvasSize(width, height);
  assertScenePixelBudget(width, height, frameCount, maxTotalPixels);

  const limits = { maxPixels: maxTotalPixels, maxMemoryBytes: maxMediaMemoryBytes };
  const avatarResidentPixels = measurePreparedAvatarPixels(prepared);
  const backgroundPlan = measureBackgroundPlan(
    template,
    options.backgroundImages,
    renderWidth,
    renderHeight,
    frameCount,
  );
  const foregroundPixels = template.background?.foregroundLayers?.length
    ? measureCanvasBatchPixels(
        renderWidth,
        renderHeight,
        Math.max(backgroundPlan.frameCount, frameCount),
        "场景前景画布",
      )
    : 0;
  const outputPixels = measureCanvasBatchPixels(width, height, frameCount, "场景输出画布");
  // 文字按图层顺序逐个绘制，和头像图层的临时画布不会同时存在，取两者峰值即可。
  const textTemporaryPixels = measureTextDeformTemporaryPixels(texts);
  const temporaryPixels = measurePerFrameTemporaryPixels({
    renderPixels: measureCanvasBatchPixels(renderWidth, renderHeight, 1, "场景单帧工作画布"),
    outputPixels: measureCanvasBatchPixels(width, height, 1, "场景单帧输出画布"),
    hasFrameTransform: template.frameTransform !== undefined,
    hasRoundClip: Boolean(template.background?.round),
    additionalTemporaryPixels: [avatarTemporaryPixels, textTemporaryPixels],
  });

  // 背景带静态图层时，基础背景与合成后的新背景会在构造期间短暂共存。
  assertSceneResourceBudget(
    checkedScenePixelSum(
      [externalResourcePixels, avatarResidentPixels, backgroundPlan.allocationPeakGeneratedPixels],
      "场景背景准备峰值",
    ),
    limits,
  );
  assertSceneResourceBudget(
    checkedScenePixelSum(
      [
        externalResourcePixels,
        avatarResidentPixels,
        backgroundPlan.residentGeneratedPixels,
        foregroundPixels,
      ],
      "场景前景准备峰值",
    ),
    limits,
  );
  assertSceneResourceBudget(
    checkedScenePixelSum(
      [
        externalResourcePixels,
        avatarResidentPixels,
        backgroundPlan.residentGeneratedPixels,
        foregroundPixels,
        outputPixels,
        temporaryPixels,
      ],
      "场景渲染峰值",
    ),
    limits,
  );

  const backgrounds = buildBackgrounds(
    template.background,
    options.backgroundImages,
    sizeMap,
    options.backgroundLayerImages,
    frameCount,
  );
  const foregrounds = buildForegrounds(
    template.background?.foregroundLayers,
    backgrounds,
    sizeMap,
    options.backgroundLayerImages,
    frameCount,
  );

  // 工作画布尺寸 = 第一帧背景尺寸；帧变换可声明更小的最终输出区域。
  if (backgrounds.length === 0) {
    throw new Error("背景帧数为 0");
  }
  if (crop && (crop[0] + crop[2] > renderWidth || crop[1] + crop[3] > renderHeight)) {
    throw new Error("帧变换裁切区域超出工作画布");
  }

  // 5.5 应用 position 偏移 —— position 的 CENTER/RIGHT/BOTTOM 基准依赖画布尺寸，
  //      必须在 width/height 确定后计算。偏移只改 lines 的 x/y，不改边界框，故
  //      前面 sizeMap 里的 text0Width/Height 仍有效。
  const positionedTexts = applyTextPositions(texts, renderWidth, renderHeight);

  // 6. 分层：底层 + 顶层
  const bottomAvatars = prepared.filter((a) => !a.avatarOnTop);
  const topAvatars = prepared.filter((a) => a.avatarOnTop);

  return {
    template,
    width,
    height,
    renderWidth,
    renderHeight,
    frameCount,
    delay: template.delay ?? 65,
    frameDelays,
    reverse: template.reverse ?? false,
    backgrounds,
    foregrounds,
    bottomAvatars,
    topAvatars,
    texts: positionedTexts,
    sizeMap,
    maxTotalPixels,
    maxMediaMemoryBytes,
  };
}

interface BackgroundCanvasPlan {
  readonly frameCount: number;
  /** 不含直接复用外部 Canvas 的场景背景画布。 */
  readonly residentGeneratedPixels: number;
  readonly allocationPeakGeneratedPixels: number;
}

function collectReferencedExternalResources(
  template: PetpetTemplate,
  inputs: AvatarInputs,
  options: PrepareSceneOptions,
): BackgroundFrame[] {
  const resources = new Set<BackgroundFrame>();
  for (const image of options.backgroundImages ?? []) resources.add(image);

  const backgroundLayers = [
    ...(template.background?.layers ?? []),
    ...(template.background?.foregroundLayers ?? []),
  ];
  for (const layer of backgroundLayers) {
    const image = options.backgroundLayerImages?.[layer.asset];
    if (image) resources.add(image);
  }

  for (const avatar of template.avatar) {
    if (
      !avatar.mask ||
      (avatar.optional && !hasAvatarInput(avatar, inputs)) ||
      isAvatarHiddenByVisibleWhen(avatar, inputs)
    ) {
      continue;
    }
    const mask = options.avatarMaskImages?.[avatar.mask];
    if (mask) resources.add(mask);
  }
  return [...resources];
}

function measureBackgroundPlan(
  template: PetpetTemplate,
  externalImages: readonly BackgroundFrame[] | undefined,
  width: number,
  height: number,
  sceneFrameCount: number,
): BackgroundCanvasPlan {
  if (!template.background) {
    if (!externalImages?.length) throw new Error("缺少背景画布");
    const generatedPixels = checkedScenePixelSum(
      externalImages.map((image) =>
        isRuntimeCanvas(image) ? 0 : measureCanvasPixels(image, "场景外部背景副本"),
      ),
      "场景外部背景副本",
    );
    return {
      frameCount: externalImages.length,
      residentGeneratedPixels: generatedPixels,
      allocationPeakGeneratedPixels: generatedPixels,
    };
  }

  const baseFrameCount = externalImages?.length || template.background.length || 1;
  const basePixels = measureCanvasBatchPixels(width, height, baseFrameCount, "场景基础背景画布");
  if (!template.background.layers?.length) {
    return {
      frameCount: baseFrameCount,
      residentGeneratedPixels: basePixels,
      allocationPeakGeneratedPixels: basePixels,
    };
  }

  const frameCount = Math.max(baseFrameCount, sceneFrameCount);
  const residentPixels = measureCanvasBatchPixels(width, height, frameCount, "场景合成背景画布");
  return {
    frameCount,
    residentGeneratedPixels: residentPixels,
    allocationPeakGeneratedPixels: checkedScenePixelSum(
      [basePixels, residentPixels],
      "场景背景构造画布",
    ),
  };
}

function measurePreparedAvatarPixels(avatars: readonly PreparedAvatar[]): number {
  return measureUniqueCanvasPixels(
    avatars.flatMap((avatar) => [...avatar.frames, ...avatar.sourceFrames.flat()]),
    "场景头像画布",
  );
}

function measureSceneResidentPixels(
  scene: PreparedScene,
  avatars: readonly PreparedAvatar[],
): number {
  return measureUniqueCanvasPixels(
    [
      ...scene.backgrounds,
      ...scene.foregrounds,
      ...avatars.flatMap((avatar) => [...avatar.frames, ...avatar.sourceFrames.flat()]),
    ],
    "场景真实常驻画布",
  );
}

interface PerFrameTemporaryOptions {
  readonly renderPixels: number;
  readonly outputPixels: number;
  readonly hasFrameTransform: boolean;
  readonly hasRoundClip: boolean;
  /** 按先后执行、不会彼此共存的图层临时画布峰值，后续文字变形可在此扩展。 */
  readonly additionalTemporaryPixels: readonly number[];
}

function measurePerFrameTemporaryPixels(options: PerFrameTemporaryOptions): number {
  const layerTemporaryPixels = Math.max(0, ...options.additionalTemporaryPixels);
  if (!options.hasFrameTransform) {
    return Math.max(options.hasRoundClip ? options.outputPixels : 0, layerTemporaryPixels);
  }

  // 帧变换绘制时工作画布一直存在；其后旋转画布会与工作画布同时驻留。
  const concurrentPixels = Math.max(
    options.renderPixels,
    options.hasRoundClip ? options.renderPixels : 0,
    layerTemporaryPixels,
  );
  return checkedScenePixelSum([options.renderPixels, concurrentPixels], "场景单帧临时画布");
}

function isRuntimeCanvas(frame: BackgroundFrame): frame is RuntimeCanvas {
  return typeof (frame as RuntimeCanvas).getContext === "function";
}

function assertSceneFrameCount(frameCount: number): void {
  if (!Number.isInteger(frameCount) || frameCount <= 0 || frameCount > MAX_SCENE_FRAMES) {
    throw new Error(`场景帧数过多：${frameCount}，最多支持 ${MAX_SCENE_FRAMES} 帧`);
  }
}

function assertCanvasSize(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`场景画布尺寸无效：${width}x${height}`);
  }
  if (width > MAX_CANVAS_EDGE || height > MAX_CANVAS_EDGE) {
    throw new Error(`场景画布尺寸过大：${width}x${height}，最大边长 ${MAX_CANVAS_EDGE}px`);
  }
}

function assertScenePixelBudget(
  width: number,
  height: number,
  frameCount: number,
  maxTotalPixels: number,
): void {
  const totalPixels = width * height * frameCount;
  if (!Number.isSafeInteger(totalPixels) || totalPixels > maxTotalPixels) {
    throw new Error(`场景累计像素预算超限：单批需要 ${totalPixels}，最多支持 ${maxTotalPixels}`);
  }
}

function computeFrameCount(
  template: PetpetTemplate,
  avatars: readonly PreparedAvatar[],
  backgroundCount: number,
): number {
  const transformFrameCount = Array.isArray(template.frameTransform?.angle)
    ? template.frameTransform.angle.length
    : 0;
  const avatarFrameCount = avatars.reduce(
    (max, avatar) => Math.max(max, getAvatarMaxLength(avatar)),
    0,
  );
  if (template.type === "GIF") {
    return Math.max(backgroundCount, avatarFrameCount, transformFrameCount, 1);
  }
  // IMG：动画长度由头像决定（GIF 头像帧数 / 多帧 pos）
  return Math.max(avatarFrameCount, transformFrameCount, 1);
}

/** 帧延迟下限 20ms；来自解码器/模板的值兜底为有限数，避免播放调度退化为 0ms 空转。 */
function normalizeFrameDelay(value: number): number {
  const delay = Math.abs(value);
  return Number.isFinite(delay) ? Math.max(20, delay) : 65;
}

function computeFrameDelays(
  template: PetpetTemplate,
  avatars: readonly PreparedAvatar[],
  frameCount: number,
): number[] {
  const fallback = normalizeFrameDelay(template.delay ?? 65);
  const delays = Array.from({ length: frameCount }, (_, frameIndex) => {
    for (const avatar of avatars) {
      const delay = getAvatarFrameDelay(avatar, frameIndex);
      if (delay !== null) return normalizeFrameDelay(delay);
    }
    return fallback;
  });
  return template.reverse ? delays.reverse() : delays;
}

/**
 * 把第 frameIndex 帧画到给定 canvas 上。
 * 画布尺寸必须等于 `scene.width × scene.height`。
 */
export function renderFrame(scene: PreparedScene, frameIndex: number, canvas: RuntimeCanvas): void {
  const frameTransform = scene.template.frameTransform;
  if (!frameTransform) {
    renderSceneContent(scene, frameIndex, canvas);
    return;
  }

  const workCanvas = createCanvas(scene.renderWidth, scene.renderHeight);
  renderSceneContent(scene, frameIndex, workCanvas);

  const angles = Array.isArray(frameTransform.angle)
    ? frameTransform.angle
    : [frameTransform.angle];
  const angle = angles[Math.min(frameIndex, angles.length - 1)] ?? 0;
  const rotated = rotateImage(workCanvas, angle, "CROP");
  const [x, y, width, height] = frameTransform.crop;
  const ctx = canvas.getContext("2d") as RuntimeContext;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(rotated, x, y, width, height, 0, 0, width, height);
}

function renderSceneContent(scene: PreparedScene, frameIndex: number, canvas: RuntimeCanvas): void {
  const ctx = canvas.getContext("2d") as RuntimeContext;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const drawSizeMap = {
    ...scene.sizeMap,
    canvasWidth: scene.renderWidth,
    canvasHeight: scene.renderHeight,
  };

  // 底层头像
  for (const a of scene.bottomAvatars) {
    drawAvatar(ctx, a, frameIndex, drawSizeMap);
  }

  // 背景
  const bg = scene.backgrounds[Math.min(frameIndex, scene.backgrounds.length - 1)];
  ctx.drawImage(bg, 0, 0);

  // 顶层头像
  for (const a of scene.topAvatars) {
    drawAvatar(ctx, a, frameIndex, drawSizeMap);
  }

  // 文字
  for (const t of scene.texts) {
    drawText(ctx, t, frameIndex, drawSizeMap);
  }

  const foreground = scene.foregrounds[Math.min(frameIndex, scene.foregrounds.length - 1)];
  if (foreground) ctx.drawImage(foreground, 0, 0);

  const radius = scene.template.background?.round;
  if (radius) clipCanvasRound(ctx, canvas.width, canvas.height, radius);
}

function clipCanvasRound(ctx: RuntimeContext, width: number, height: number, radius: number): void {
  const clipped = createCanvas(width, height);
  const clippedCtx = clipped.getContext("2d") as RuntimeContext;
  clippedCtx.beginPath();
  clippedCtx.roundRect(0, 0, width, height, Math.min(radius, width / 2, height / 2));
  clippedCtx.closePath();
  clippedCtx.clip();
  clippedCtx.drawImage(ctx.canvas, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(clipped, 0, 0);
}

/**
 * 把场景的所有帧都渲染出来，返回独立 Canvas 数组。
 *
 * 适合用于 GIF 编码或在界面层缓存帧。
 */
export function renderAllFrames(scene: PreparedScene): RuntimeCanvas[] {
  assertSceneFrameCount(scene.frameCount);
  assertCanvasSize(scene.width, scene.height);
  assertCanvasSize(scene.renderWidth, scene.renderHeight);
  assertScenePixelBudget(scene.width, scene.height, scene.frameCount, scene.maxTotalPixels);
  const avatars = [...scene.bottomAvatars, ...scene.topAvatars];
  const avatarTemporaryPixels = assertAvatarRenderBudget(
    avatars,
    scene.frameCount,
    {
      ...scene.sizeMap,
      canvasWidth: scene.renderWidth,
      canvasHeight: scene.renderHeight,
    },
    createAvatarResourceBudget({
      maxFrames: MAX_SCENE_FRAMES,
      maxEdge: MAX_MEDIA_EDGE,
      maxTotalPixels: scene.maxTotalPixels,
      maxMemoryBytes: scene.maxMediaMemoryBytes,
    }),
  );
  const outputPixels = measureCanvasBatchPixels(
    scene.width,
    scene.height,
    scene.frameCount,
    "场景输出画布",
  );
  // 防御调用方篡改 PreparedScene；即使 when 某帧为 0，也保守计入声明的临时画布。
  const textTemporaryPixels = measureTextDeformTemporaryPixels(scene.texts);
  const temporaryPixels = measurePerFrameTemporaryPixels({
    renderPixels: measureCanvasBatchPixels(
      scene.renderWidth,
      scene.renderHeight,
      1,
      "场景单帧工作画布",
    ),
    outputPixels: measureCanvasBatchPixels(scene.width, scene.height, 1, "场景单帧输出画布"),
    hasFrameTransform: scene.template.frameTransform !== undefined,
    hasRoundClip: Boolean(scene.template.background?.round),
    additionalTemporaryPixels: [avatarTemporaryPixels, textTemporaryPixels],
  });
  assertSceneResourceBudget(
    checkedScenePixelSum(
      [measureSceneResidentPixels(scene, avatars), outputPixels, temporaryPixels],
      "场景渲染峰值",
    ),
    {
      maxPixels: scene.maxTotalPixels,
      maxMemoryBytes: scene.maxMediaMemoryBytes,
    },
  );
  const frames: RuntimeCanvas[] = [];
  for (let i = 0; i < scene.frameCount; i++) {
    const rawFrameIndex = scene.reverse ? scene.frameCount - 1 - i : i;
    const c = createCanvas(scene.width, scene.height);
    renderFrame(scene, rawFrameIndex, c);
    frames.push(c);
  }
  return frames;
}
