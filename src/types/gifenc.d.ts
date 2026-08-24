// gifenc 没有自带类型声明，这里补一个最小可用的声明。
// 参考 https://github.com/mattdesl/gifenc
declare module "gifenc" {
  export interface WriteFrameOpts {
    palette?: number[][] | null;
    /** 每帧延迟（毫秒）；内部会转换成 GIF 的 1/100 秒单位 */
    delay?: number;
    transparent?: boolean;
    transparentIndex?: number;
    /** 循环次数，0 = 无限循环 */
    repeat?: number;
    colorDepth?: number;
    /** GIF 帧处置方式：-1 未指定，2 恢复背景 */
    dispose?: number;
    first?: boolean;
  }

  export interface Encoder {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: WriteFrameOpts): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    reset(): void;
  }

  export function GIFEncoder(opts?: {
    initialCapacity?: number;
    auto?: boolean;
  }): Encoder;

  export type QuantizeFormat = "rgb565" | "rgb444" | "rgba4444";

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    opts?: {
      format?: QuantizeFormat;
      clearAlpha?: boolean;
      clearAlphaThreshold?: number;
      oneBitAlpha?: boolean | number;
    },
  ): number[][];

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: number[][],
    format?: QuantizeFormat,
  ): Uint8Array;

  const _default: typeof GIFEncoder;
  export default _default;
}
