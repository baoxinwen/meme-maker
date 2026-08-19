/**
 * 文字布局 + 绘制。
 *
 * ZOOM 模式重新计算字号时会保留 `fontStyle`，确保斜体和粗体的测量与绘制一致。
 */

import { MAX_MEDIA_EDGE } from "../limits";
import { type TemplateOptionValues, resolveOptionString } from "../options";
import type {
  TextAlign,
  TextPosition,
  TextStyle,
  TextTemplate,
  TextWrap,
  TransformOrigin,
} from "../schema/template";
import { MAX_TEXT_FONT_SIZE } from "../schema/template";
import { drawDeform } from "../transforms/deform";
import { rotateAround } from "../utils/canvas";
import { parseColor } from "../utils/color";
import { type EvalFn, compileNumber } from "../utils/expression";
import { createCanvas } from "../utils/runtime";
import type { RuntimeContext } from "../utils/runtime";

const DEFAULT_FONT = "Arial";
const DEFAULT_MAX_WIDTH = 300;
const MAX_TEXT_LENGTH = 4096;
const MAX_TEXT_LINES = 256;
const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const TEXT_VAR_REGEX = /\$txt\d+\[(.*?)]/g;
const KEYWORD_VARS: Record<string, string> = {
  from: "我",
  to: "TA",
  bot: "机器人",
  group: "群",
};

export type FontStyleString = "normal" | "bold" | "italic" | "bold italic";

function toFontStyle(style: TextStyle | undefined): FontStyleString {
  switch (style) {
    case "BOLD":
      return "bold";
    case "ITALIC":
      return "italic";
    case "BOLD_ITALIC":
      return "bold italic";
    default:
      return "normal";
  }
}

export interface LaidOutLine {
  readonly text: string;
  readonly x: number;
  readonly y: number;
}

export interface PreparedText {
  readonly lines: readonly LaidOutLine[];
  readonly fontString: string;
  readonly fillStyle: string;
  readonly strokeStyle: string | null;
  readonly strokeWidth: number;
  readonly textBaseline: "alphabetic" | "bottom" | "middle";
  readonly angle: number;
  readonly origin: TransformOrigin;
  readonly bboxWidth: number;
  readonly bboxHeight: number;
  /** 坐标计算基准；layoutText 阶段记录，applyTextPositions 阶段据此叠加画布尺寸偏移 */
  readonly position: readonly [TextPosition, TextPosition];
  /** 当前帧的数值条件；为 0 时不绘制。 */
  readonly when: EvalFn | null;
  /** 本地文字画布及其目标透视四边形。 */
  readonly deform?: {
    readonly width: number;
    readonly height: number;
    readonly corners: readonly [
      readonly [number, number],
      readonly [number, number],
      readonly [number, number],
      readonly [number, number],
    ];
  };
}

function quoteFontFamily(family: string): string {
  if (!/[\s"']/.test(family)) return family;
  return `"${family.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function fontStringOf(style: FontStyleString, pixelSize: number, family: string): string {
  return `${style} ${pixelSize}px ${quoteFontFamily(family)}`;
}

function alignedX(rawX: number, width: number, align: TextAlign): number {
  switch (align) {
    case "RIGHT":
      return rawX - width;
    case "CENTER":
      return rawX - width / 2;
    default:
      return rawX;
  }
}

function wrapLineToWidth(
  line: string,
  maxWidth: number,
  ctx: RuntimeContext,
  maxLines: number,
): string[] | null {
  if (!line || ctx.measureText(line).width <= maxWidth) {
    if (maxLines < 1) return null;
    return [line];
  }

  const lines: string[] = [];
  let remaining = line;
  while (remaining.length > 0) {
    remaining = remaining.replace(/^\s+/, "");
    if (remaining.length === 0) {
      if (lines.length === 0) {
        if (maxLines < 1) return null;
        lines.push("");
      }
      break;
    }
    const graphemes = Array.from(GRAPHEME_SEGMENTER.segment(remaining));
    let low = 1;
    let high = graphemes.length;
    let cut = 1;
    while (low <= high) {
      const candidate = Math.floor((low + high) / 2);
      const endOffset = graphemes[candidate - 1].index + graphemes[candidate - 1].segment.length;
      if (ctx.measureText(remaining.slice(0, endOffset)).width <= maxWidth) {
        cut = candidate;
        low = candidate + 1;
      } else {
        high = candidate - 1;
      }
    }

    const cutSegment = graphemes[cut - 1];
    const cutOffset = cutSegment.index + cutSegment.segment.length;
    let breakAt = cutOffset;
    if (remaining[cutOffset] !== " ") {
      for (const grapheme of graphemes.slice(0, cut)) {
        if (grapheme.segment === " " && grapheme.index > 0) breakAt = grapheme.index;
      }
    }

    const wrappedLine = remaining.slice(0, breakAt).replace(/\s+$/, "");
    if (wrappedLine.length > 0) lines.push(wrappedLine);
    if (lines.length > maxLines) return null;
    remaining = remaining.slice(breakAt).replace(/^\s+/, "");
  }

  return lines;
}

function wrapTextToWidth(text: string, maxWidth: number, ctx: RuntimeContext): string[] | null {
  const lines: string[] = [];
  for (const line of text.split("\n")) {
    const wrapped = wrapLineToWidth(line, maxWidth, ctx, MAX_TEXT_LINES - lines.length);
    if (!wrapped) return null;
    lines.push(...wrapped);
  }
  return lines;
}

function textMetrics(ctx: RuntimeContext, lines: readonly string[], fontSize: number) {
  const metrics = lines.map((line) => ctx.measureText(line || "M"));
  let ascent = 0;
  let descent = 0;
  let width = 0;
  for (const metric of metrics) {
    ascent = Math.max(ascent, metric.actualBoundingBoxAscent || fontSize * 0.8);
    descent = Math.max(descent, metric.actualBoundingBoxDescent || fontSize * 0.2);
    width = Math.max(width, metric.width);
  }
  return {
    ascent,
    lineHeight: Math.max(1, ascent + descent),
    width: Math.max(0, width),
  };
}

function layoutAreaText(
  template: TextTemplate,
  area: readonly [number, number, number, number],
  minFontSize: number,
  maxFontSize: number,
  angle: number,
  text: string,
  measureCtx: RuntimeContext,
  fontStyle: FontStyleString,
  family: string,
  align: TextAlign,
  position: readonly [TextPosition, TextPosition],
  when: EvalFn | null,
  fillStyle: string,
  strokeStyle: string | null,
  strokeWidth: number,
): PreparedText {
  if (!Number.isFinite(maxFontSize) || maxFontSize > MAX_TEXT_FONT_SIZE) {
    throw new Error(`文字字号过大：最多支持 ${MAX_TEXT_FONT_SIZE}px`);
  }
  const [left, top, right, bottom] = area;
  const maxWidth = Math.max(1, right - left);
  const maxHeight = Math.max(1, bottom - top);
  const maxSize = Math.max(1, maxFontSize);
  const minSize = Math.min(Math.max(1, minFontSize), maxSize);
  let selectedSize = minSize;
  let selectedLines: string[] = [];
  let selectedMetrics = { ascent: minSize * 0.8, lineHeight: minSize, width: 0 };

  let low = Math.ceil(minSize);
  let high = Math.floor(maxSize);
  while (low <= high) {
    const size = Math.floor((low + high) / 2);
    measureCtx.font = fontStringOf(fontStyle, size, family);
    const lines = wrapTextToWidth(text, maxWidth, measureCtx);
    if (!lines) {
      high = size - 1;
      continue;
    }
    const metrics = textMetrics(measureCtx, lines, size);
    if (metrics.lineHeight * lines.length <= maxHeight) {
      selectedSize = size;
      selectedLines = lines;
      selectedMetrics = metrics;
      low = size + 1;
    } else {
      high = size - 1;
    }
  }

  if (selectedLines.length === 0) {
    measureCtx.font = fontStringOf(fontStyle, selectedSize, family);
    const fallbackLines = wrapTextToWidth(text, maxWidth, measureCtx);
    if (!fallbackLines) {
      throw new Error(`文字行数过多：最多支持 ${MAX_TEXT_LINES} 行`);
    }
    selectedLines = fallbackLines;
    selectedMetrics = textMetrics(measureCtx, selectedLines, selectedSize);
  }

  // 二分搜索的最后一次探测可能以失败收尾，残留的探测字号会污染行宽测量，
  // 导致 CENTER/RIGHT 对齐按错误宽度计算行 x。
  measureCtx.font = fontStringOf(fontStyle, selectedSize, family);

  const rawX = align === "RIGHT" ? right : align === "CENTER" ? (left + right) / 2 : left;
  const lines = selectedLines.map((line, index) => {
    const width = measureCtx.measureText(line).width;
    return {
      text: line,
      x: alignedX(rawX, width, align),
      y: top + selectedMetrics.ascent + selectedMetrics.lineHeight * index,
    };
  });

  return {
    lines,
    fontString: fontStringOf(fontStyle, selectedSize, family),
    fillStyle,
    strokeStyle,
    strokeWidth,
    textBaseline: "alphabetic",
    angle,
    origin: template.origin ?? "DEFAULT",
    bboxWidth: selectedMetrics.width,
    bboxHeight: selectedMetrics.lineHeight * selectedLines.length,
    position,
    when,
  };
}

/**
 * 在不绘制的前提下测量并切分文本，处理 NONE、BREAK、ZOOM 三种换行方式。
 *
 * 注：需要一个临时 ctx 来调用 measureText。
 */
export function layoutText(
  template: TextTemplate,
  measureCtx: RuntimeContext,
  vars: Record<string, number> = {},
): PreparedText {
  const text = resolveTemplateText(template.text);
  if (text.length > MAX_TEXT_LENGTH) {
    throw new Error(`文字长度过长：${text.length}，最多支持 ${MAX_TEXT_LENGTH}`);
  }
  if (text.split("\n").length > MAX_TEXT_LINES) {
    throw new Error(`文字行数过多：最多支持 ${MAX_TEXT_LINES} 行`);
  }
  const fontStyle = toFontStyle(template.style);
  const family = template.font ?? DEFAULT_FONT;
  const align = template.align ?? "LEFT";
  const wrap: TextWrap = template.wrap ?? "NONE";
  const [rawX, rawY, maxWAttr] = (template.pos ?? [50, 50]).map((value) =>
    compileNumber(value)(vars),
  );
  const baseSize = Math.min(
    MAX_TEXT_FONT_SIZE,
    Math.max(1, compileNumber(template.size ?? 16)(vars)),
  );
  const angle = compileNumber(template.angle ?? 0)(vars);
  const area = template.area?.map((value) => compileNumber(value)(vars)) as
    | [number, number, number, number]
    | undefined;
  const position = template.position ?? (["LEFT", "TOP"] as const);
  const when = template.when === undefined ? null : compileNumber(template.when);
  // 上游模板未声明 color 时按 Canvas 文字默认值使用黑色；背景的缺省色仍由背景模块保持透明。
  const fillStyle = parseColor(template.color, "#000000");
  const strokeWidth = Math.max(0, compileNumber(template.strokeSize ?? 0)(vars));
  const strokeStyle = strokeWidth > 0 ? parseColor(template.strokeColor ?? "#ffffff") : null;
  const deform =
    template.deform && template.deformSize
      ? assertTextDeformCanvasSize(
          evaluateTextDeformDimension(template.deformSize[0], vars),
          evaluateTextDeformDimension(template.deformSize[1], vars),
          {
            corners: template.deform.map(([x, y]) => [
              compileNumber(x)(vars),
              compileNumber(y)(vars),
            ]) as [[number, number], [number, number], [number, number], [number, number]],
          },
        )
      : undefined;

  if (area) {
    return {
      ...layoutAreaText(
        template,
        area,
        compileNumber(template.minSize ?? 1)(vars),
        compileNumber(template.maxSize ?? baseSize)(vars),
        angle,
        text,
        measureCtx,
        fontStyle,
        family,
        align,
        position,
        when,
        fillStyle,
        strokeStyle,
        strokeWidth,
      ),
      deform,
    };
  }

  let pixelSize = baseSize;
  let fontString = fontStringOf(fontStyle, pixelSize, family);
  measureCtx.font = fontString;
  measureCtx.textBaseline = "bottom";
  measureCtx.textAlign = "left";

  const lines: LaidOutLine[] = [];
  let bboxWidth = 0;
  let bboxHeight = 0;
  let lineIndex = 0;

  const pushLine = (lineText: string) => {
    const m = measureCtx.measureText(lineText);
    const lineW = m.width;
    const fontHeight = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    const x = alignedX(rawX, lineW, align);
    const y = rawY + fontHeight * lineIndex;
    lines.push({ text: lineText, x, y });
    bboxWidth = Math.max(bboxWidth, lineW);
    bboxHeight = fontHeight * (lineIndex + 1);
    lineIndex++;
  };

  const rawLines = text.split("\n");

  if (wrap === "NONE") {
    for (const line of rawLines) pushLine(line);
  } else if (wrap === "BREAK") {
    const maxWidth = maxWAttr || DEFAULT_MAX_WIDTH;
    const wrappedLines = wrapTextToWidth(text, maxWidth, measureCtx);
    if (!wrappedLines) {
      throw new Error(`文字行数过多：最多支持 ${MAX_TEXT_LINES} 行`);
    }
    for (const line of wrappedLines) pushLine(line);
  } else {
    // ZOOM —— 整段缩放到指定宽度
    const maxWidth = maxWAttr || DEFAULT_MAX_WIDTH;
    // 使用字体族变量和 fontStyle 重新构造 CSS font 字符串，确保测量结果可靠。
    measureCtx.font = fontStringOf(fontStyle, baseSize, family);
    const originWidth = Math.max(...rawLines.map((l) => measureCtx.measureText(l).width));
    const scale = maxWidth / (originWidth || 1);
    // 巨字号只会造成 measureText/fillText 的实现相关卡顿，统一钳到上限
    pixelSize = Math.min(scale * baseSize, MAX_TEXT_FONT_SIZE);
    fontString = fontStringOf(fontStyle, pixelSize, family);
    measureCtx.font = fontString;
    for (const line of rawLines) pushLine(line);
  }

  return {
    lines,
    fontString,
    fillStyle,
    strokeStyle,
    strokeWidth,
    textBaseline: align === "CENTER" ? "middle" : "bottom",
    angle,
    origin: template.origin ?? "DEFAULT",
    bboxWidth,
    bboxHeight,
    position,
    when,
    deform,
  };
}

export function resolveTemplateText(text: string, optionValues: TemplateOptionValues = {}): string {
  return resolveOptionString(text, optionValues)
    .replace(TEXT_VAR_REGEX, (_, captured: string) => captured)
    .replace(/\$(from|to|bot|group)\b/g, (_, key: string) => KEYWORD_VARS[key] ?? "");
}

/**
 * 把布局好的文字画到 ctx 上。
 */
export function drawText(
  ctx: RuntimeContext,
  prepared: PreparedText,
  frameIndex = 0,
  vars: Record<string, number> = {},
): void {
  if (prepared.when && prepared.when({ ...vars, frameIndex }) === 0) return;
  if (prepared.deform) {
    const deform = assertTextDeformCanvasSize(
      prepared.deform.width,
      prepared.deform.height,
      prepared.deform,
    );
    const local = createCanvas(deform.width, deform.height);
    const localContext = local.getContext("2d") as RuntimeContext;
    drawText(localContext, { ...prepared, when: null, deform: undefined }, frameIndex, vars);
    drawDeform(ctx, local, deform.corners);
    return;
  }
  ctx.save();
  ctx.font = prepared.fontString;
  ctx.textBaseline = prepared.textBaseline;
  ctx.textAlign = "left";
  ctx.fillStyle = prepared.fillStyle;

  for (const line of prepared.lines) {
    if (prepared.angle !== 0) {
      ctx.save();
      applyLineRotation(ctx, prepared, line);
    }
    ctx.fillText(line.text, line.x, line.y);
    if (prepared.angle !== 0) ctx.restore();
  }

  if (prepared.strokeStyle && prepared.strokeWidth > 0) {
    ctx.strokeStyle = prepared.strokeStyle;
    ctx.lineWidth = prepared.strokeWidth;
    for (const line of prepared.lines) {
      if (prepared.angle !== 0) {
        ctx.save();
        applyLineRotation(ctx, prepared, line);
      }
      ctx.strokeText(line.text, line.x, line.y);
      if (prepared.angle !== 0) ctx.restore();
    }
  }
  ctx.restore();
}

/** 按文字的旋转角与原点基准，把画布变换到该行的绘制坐标系。 */
function applyLineRotation(
  ctx: RuntimeContext,
  prepared: PreparedText,
  line: { x: number; y: number },
): void {
  const centerX = prepared.origin === "CENTER";
  rotateAround(
    ctx,
    prepared.angle,
    line.x + (centerX ? prepared.bboxWidth / 2 : 0),
    line.y + (centerX ? prepared.bboxHeight / 2 : 0),
  );
}

/**
 * 一次性给一组文字模板做布局。
 */
export function layoutTexts(
  templates: readonly TextTemplate[],
  measureCtx: RuntimeContext,
  vars: Record<string, number> = {},
): PreparedText[] {
  return templates.map((t) => layoutText(t, measureCtx, vars));
}

/** 按文字逐个绘制的执行时序，测量最大变形临时画布像素。 */
export function measureTextDeformTemporaryPixels(texts: readonly PreparedText[]): number {
  let peakPixels = 0;
  for (const text of texts) {
    if (!text.deform) continue;
    const deform = assertTextDeformCanvasSize(text.deform.width, text.deform.height, text.deform);
    const pixels = deform.width * deform.height;
    if (!Number.isSafeInteger(pixels)) {
      throw new Error(`文字变形画布尺寸无效：${deform.width}x${deform.height}`);
    }
    peakPixels = Math.max(peakPixels, pixels);
  }
  return peakPixels;
}

function evaluateTextDeformDimension(value: number | string, vars: Record<string, number>): number {
  try {
    return compileNumber(value)(vars);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("表达式结果不是有限数字")) {
      throw new Error(`文字变形画布尺寸无效：${String(value)}`);
    }
    throw error;
  }
}

function assertTextDeformCanvasSize<T extends object>(
  width: number,
  height: number,
  rest: T,
): T & { readonly width: number; readonly height: number } {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error(`文字变形画布尺寸无效：${width}x${height}`);
  }
  if (width > MAX_MEDIA_EDGE || height > MAX_MEDIA_EDGE) {
    throw new Error(`文字变形画布尺寸过大：${width}x${height}，单边最多支持 ${MAX_MEDIA_EDGE}px`);
  }
  return { ...rest, width, height };
}

/**
 * 按画布尺寸应用 `position` 偏移，返回新的 PreparedText（lines 的 x/y 已叠加偏移）。
 *
 * 必须在背景尺寸确定后调用——`position` 的 CENTER/RIGHT/BOTTOM 基准依赖画布宽高。
 * 偏移对 x、y 各自独立：
 *   x 基准 LEFT→0，CENTER→canvasW/2，RIGHT→canvasW - bboxW
 *   y 基准 TOP→0，CENTER→canvasH/2，BOTTOM→canvasH - bboxH
 * （RIGHT/BOTTOM 使用整段文本的边界框宽高，对应 `100vw-100cw`/`100vh-100ch`）。
 *
 * 注：layoutText 里每行 x 已应用 align（CENTER→x-lineW/2 等）。由于偏移是常量，
 * 偏移叠加到每行 x 上，等价于先加偏移再执行对齐。
 */
export function applyTextPositions(
  texts: readonly PreparedText[],
  canvasWidth: number,
  canvasHeight: number,
): PreparedText[] {
  return texts.map((t) => {
    const [posX, posY] = t.position;
    const offsetX = positionOffsetX(posX, canvasWidth, t.bboxWidth);
    const offsetY = positionOffsetY(posY, canvasHeight, t.bboxHeight);
    if (offsetX === 0 && offsetY === 0) return t;
    return {
      ...t,
      lines: t.lines.map((l) => ({ ...l, x: l.x + offsetX, y: l.y + offsetY })),
    };
  });
}

function positionOffsetX(pos: TextPosition, canvasWidth: number, bboxWidth: number): number {
  switch (pos) {
    case "CENTER":
      return canvasWidth / 2;
    case "RIGHT":
      return canvasWidth - bboxWidth;
    default:
      return 0;
  }
}

function positionOffsetY(pos: TextPosition, canvasHeight: number, bboxHeight: number): number {
  switch (pos) {
    case "CENTER":
      return canvasHeight / 2;
    case "BOTTOM":
      return canvasHeight - bboxHeight;
    default:
      return 0;
  }
}

/** 创建一个用于测量的临时 ctx —— 浏览器和 Node 都能用 */
export function createMeasureContext(): RuntimeContext {
  const c = createCanvas(1, 1);
  return c.getContext("2d") as RuntimeContext;
}
