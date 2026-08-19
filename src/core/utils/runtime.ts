/**
 * 运行时抽象层 —— 让引擎在浏览器和 Node.js 两种环境下都能跑。
 *
 * 浏览器里：使用 DOM 原生 `document.createElement('canvas')` 和 `new Image()`。
 * Node.js 里（用于测试）：注入 `@napi-rs/canvas` 提供的工厂函数。
 */

// 我们用结构性类型，避免在 Node.js 测试时强依赖 DOM lib。
// 实际上 @napi-rs/canvas 的 Canvas / Image 与浏览器 HTMLCanvasElement / HTMLImageElement
// 在我们用到的 API 上完全兼容。
export type RuntimeCanvas = HTMLCanvasElement;
export type RuntimeImage = HTMLImageElement;
export type RuntimeContext = CanvasRenderingContext2D;

export interface CoreRuntime {
  /** 创建一个指定大小的画布 */
  createCanvas(width: number, height: number): RuntimeCanvas;
  /**
   * 把任意来源（Blob、ArrayBuffer、Uint8Array、URL 字符串）解码成 Image。
   * 注：浏览器里 Blob 通过 URL.createObjectURL 加载；Node 里用 Buffer 直接加载。
   */
  loadImage(source: Blob | ArrayBuffer | Uint8Array | string): Promise<RuntimeImage>;
}

// ---- 默认浏览器实现 ----
const browserRuntime: CoreRuntime = {
  createCanvas(width, height) {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    return c;
  },
  loadImage(source) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      let objectUrl: string | null = null;
      const cleanup = () => {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      };
      img.onload = () => {
        cleanup();
        resolve(img);
      };
      img.onerror = (e) => {
        cleanup();
        reject(new Error(`加载图片失败: ${String(e)}`));
      };
      if (typeof source === "string") {
        img.crossOrigin = "anonymous";
        img.src = source;
      } else if (source instanceof Blob) {
        objectUrl = URL.createObjectURL(source);
        img.src = objectUrl;
      } else if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
        const blob = new Blob([source as ArrayBuffer]);
        objectUrl = URL.createObjectURL(blob);
        img.src = objectUrl;
      } else {
        reject(new Error("无法识别的图片来源"));
      }
    });
  },
};

let activeRuntime: CoreRuntime =
  typeof document !== "undefined" ? browserRuntime : (null as unknown as CoreRuntime);

/** 注入一个不同的运行时（用于 Node 测试环境） */
export function setRuntime(runtime: CoreRuntime): void {
  activeRuntime = runtime;
}

/** 取当前运行时 */
export function getRuntime(): CoreRuntime {
  if (!activeRuntime) {
    throw new Error("未配置运行时。浏览器环境会自动配置；Node 环境请先调用 setRuntime() 注入。");
  }
  return activeRuntime;
}

/** 快捷方式：创建画布 */
export function createCanvas(width: number, height: number): RuntimeCanvas {
  return getRuntime().createCanvas(width, height);
}

/** 快捷方式：加载图片 */
export function loadImage(source: Blob | ArrayBuffer | Uint8Array | string): Promise<RuntimeImage> {
  return getRuntime().loadImage(source);
}
