/**
 * 背景生成 —— 把模板里的 `background`（颜色和 `size` 表达式）与外部图片列表合成。
 *
 * 三种情况：
 *   1. 外部图片 + 无模板 `background`：直接使用图片
 *   2. 外部图片 + 模板 `background`：在指定尺寸的纯色画布上叠加图片
 *   3. 无外部图片 + 模板 `background`：返回一张纯色画布
 */

import type {
  AvatarFit,
  BackgroundLayer,
  BackgroundTemplate,
  NumberOrExpr,
} from "../schema/template";
import { drawFit } from "../transforms/fit";
import { parseColor } from "../utils/color";
import { type EvalFn, compileNumber } from "../utils/expression";
import { createCanvas } from "../utils/runtime";
import type { RuntimeCanvas, RuntimeContext, RuntimeImage } from "../utils/runtime";

export type BackgroundFrame = RuntimeCanvas | RuntimeImage;
export type BackgroundLayerImages = Readonly<Record<string, BackgroundFrame>>;

interface CompiledImage {
  readonly imagePos: readonly [EvalFn, EvalFn] | null;
  readonly imageSize: readonly [EvalFn, EvalFn] | null;
  readonly imageFit: AvatarFit;
}

interface CompiledLayer extends CompiledImage {
  readonly asset: string;
  readonly when: EvalFn | null;
}

interface CompiledBackground extends CompiledImage {
  readonly widthFn: EvalFn;
  readonly heightFn: EvalFn;
  readonly color: string;
  readonly layers: readonly CompiledLayer[];
}

function compile(template: BackgroundTemplate): CompiledBackground {
  return {
    widthFn: compileNumber(template.size[0]),
    heightFn: compileNumber(template.size[1]),
    color: parseColor(template.color),
    ...compileImage(template.imagePos, template.imageSize, template.imageFit),
    layers: (template.layers ?? []).map((layer) => compileLayer(layer)),
  };
}

function compileLayer(layer: BackgroundLayer): CompiledLayer {
  return {
    asset: layer.asset,
    when: layer.when === undefined ? null : compileNumber(layer.when),
    ...compileImage(layer.pos, layer.size, layer.fit),
  };
}

function compileImage(
  pos: readonly [NumberOrExpr, NumberOrExpr] | undefined,
  size: readonly [NumberOrExpr, NumberOrExpr] | undefined,
  fit: AvatarFit | undefined,
): CompiledImage {
  return {
    imagePos: compilePair(pos),
    imageSize: compilePair(size),
    imageFit: fit ?? "FILL",
  };
}

function compilePair(
  pair: readonly [NumberOrExpr, NumberOrExpr] | undefined,
): readonly [EvalFn, EvalFn] | null {
  return pair ? [compileNumber(pair[0]), compileNumber(pair[1])] : null;
}

function makeColorCanvas(c: CompiledBackground, sizeMap: Record<string, number>): RuntimeCanvas {
  const width = c.widthFn(sizeMap);
  const height = c.heightFn(sizeMap);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d") as RuntimeContext;
  if (c.color && c.color !== "#ffffff00") {
    ctx.fillStyle = c.color;
    ctx.fillRect(0, 0, width, height);
  }
  return canvas;
}

/** 在创建批量背景画布前求出工作画布尺寸。 */
export function resolveBackgroundSize(
  template: BackgroundTemplate | undefined,
  externalImages: readonly BackgroundFrame[] | undefined,
  sizeMap: Record<string, number>,
): readonly [number, number] {
  if (template) {
    const compiled = compile(template);
    return [Math.trunc(compiled.widthFn(sizeMap)), Math.trunc(compiled.heightFn(sizeMap))];
  }
  const firstImage = externalImages?.[0];
  if (firstImage) return [firstImage.width, firstImage.height];
  throw new Error("缺少背景：既没有 template.background，也没有外部图片");
}

function drawBackgroundImage(
  ctx: RuntimeContext,
  image: BackgroundFrame,
  c: CompiledImage,
  canvas: RuntimeCanvas,
  sizeMap: Record<string, number>,
): void {
  if (!c.imageSize) {
    const [x, y] = evaluateImagePair(c.imagePos, canvas, image, sizeMap, [0, 0]);
    ctx.drawImage(image, x, y);
    return;
  }

  const [x, y] = evaluateImagePair(c.imagePos, canvas, image, sizeMap, [0, 0]);
  const [width, height] = evaluateImagePair(c.imageSize, canvas, image, sizeMap, [
    image.width,
    image.height,
  ]);
  drawFit(ctx, image, x, y, width, height, c.imageFit);
}

function evaluateImagePair(
  pair: readonly [EvalFn, EvalFn] | null,
  canvas: RuntimeCanvas,
  image: BackgroundFrame,
  sizeMap: Record<string, number>,
  fallback: readonly [number, number],
): readonly [number, number] {
  if (!pair) return fallback;
  const vars = imageVars(canvas, image, sizeMap);
  return [pair[0](vars), pair[1](vars)];
}

function imageVars(
  canvas: RuntimeCanvas,
  image: BackgroundFrame,
  sizeMap: Record<string, number>,
): Record<string, number> {
  return {
    ...sizeMap,
    width: canvas.width,
    height: canvas.height,
    imageWidth: image.width,
    imageHeight: image.height,
  };
}

/**
 * 构造一组背景帧。
 *
 * @param template 模板的 background 字段（可选）
 * @param externalImages 外部传入的图片帧（如 0.png / 1.png ...），可选
 * @param sizeMap 头像尺寸映射（avatar0Width 之类）；表达式可引用
 */
export function buildBackgrounds(
  template: BackgroundTemplate | undefined,
  externalImages: readonly BackgroundFrame[] | undefined,
  sizeMap: Record<string, number>,
  layerImages?: BackgroundLayerImages,
  frameCount = externalImages?.length ?? template?.length ?? 1,
): RuntimeCanvas[] {
  const hasTemplate = !!template;
  const hasImages = !!externalImages && externalImages.length > 0;

  if (!hasTemplate && !hasImages) {
    throw new Error("缺少背景：既没有 template.background，也没有外部图片");
  }

  // 情况 1：只有外部图片 —— 直接转 Canvas
  if (!hasTemplate && hasImages) {
    return externalImages!.map((src) => {
      if (isCanvas(src)) return src;
      const c = createCanvas(src.width, src.height);
      const ctx = c.getContext("2d") as RuntimeContext;
      ctx.drawImage(src, 0, 0);
      return c;
    });
  }

  const compiled = compile(template!);

  // 情况 3：只有模板背景 —— 返回纯色画布
  //   特效模板（swirl 等）无外部图片，靠 background.length 指定帧数，
  //   逐帧由头像滤镜产生动画。length 缺省时返回单帧。
  let backgrounds: RuntimeCanvas[];
  if (!hasImages) {
    const length = template!.length ?? 1;
    backgrounds = Array.from({ length }, () => makeColorCanvas(compiled, sizeMap));
  } else {
    // 情况 2：模板背景 + 外部图片 —— 在指定画布上叠加每一帧
    backgrounds = externalImages!.map((src) => {
      const c = makeColorCanvas(compiled, sizeMap);
      const ctx = c.getContext("2d") as RuntimeContext;
      drawBackgroundImage(ctx, src, compiled, c, sizeMap);
      return c;
    });
  }

  if (compiled.layers.length === 0) return backgrounds;
  // 背景带静态图层：每帧先拷贝基础背景，再按声明顺序叠加图层。
  return compositeLayeredFrames(
    backgrounds,
    compiled.layers,
    layerImages,
    sizeMap,
    frameCount,
    "背景",
    true,
  );
}

/**
 * 图层帧合成 —— 对每一帧：取参考帧（越界夹到末帧），新建同尺寸画布，
 * 可选地先把参考帧画上去，再依次绘制满足 when 条件的静态图层。
 * 背景图层与前景图层的唯一差异是是否带底图与缺失资源的提示文案。
 */
function compositeLayeredFrames(
  referenceFrames: readonly BackgroundFrame[],
  layers: readonly CompiledLayer[],
  layerImages: BackgroundLayerImages | undefined,
  sizeMap: Record<string, number>,
  frameCount: number,
  label: string,
  copyBase: boolean,
): RuntimeCanvas[] {
  const outputLength = Math.max(referenceFrames.length, frameCount);
  return Array.from({ length: outputLength }, (_, frameIndex) => {
    const reference = referenceFrames[Math.min(frameIndex, referenceFrames.length - 1)];
    const canvas = createCanvas(reference.width, reference.height);
    const ctx = canvas.getContext("2d") as RuntimeContext;
    if (copyBase) ctx.drawImage(reference, 0, 0);
    for (const layer of layers) {
      const image = layerImages?.[layer.asset];
      if (!image) throw new Error(`缺少${label}图层资源: ${layer.asset}`);
      const vars = { ...imageVars(canvas, image, sizeMap), frameIndex };
      if (layer.when && layer.when(vars) === 0) continue;
      drawBackgroundImage(ctx, image, layer, canvas, sizeMap);
    }
    return canvas;
  });
}

/**
 * 按背景帧尺寸构造透明前景帧，供合成器在头像与文字之后绘制。
 */
export function buildForegrounds(
  layers: readonly BackgroundLayer[] | undefined,
  referenceFrames: readonly RuntimeCanvas[],
  sizeMap: Record<string, number>,
  layerImages?: BackgroundLayerImages,
  frameCount = referenceFrames.length,
): RuntimeCanvas[] {
  if (!layers?.length) return [];
  const compiledLayers = layers.map((layer) => compileLayer(layer));
  // 前景帧从透明画布开始，只叠加满足 when 条件的图层。
  return compositeLayeredFrames(
    referenceFrames,
    compiledLayers,
    layerImages,
    sizeMap,
    frameCount,
    "前景",
    false,
  );
}

function isCanvas(x: BackgroundFrame): x is RuntimeCanvas {
  return typeof (x as RuntimeCanvas).getContext === "function";
}
