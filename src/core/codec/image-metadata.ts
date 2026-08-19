/** 浏览器完整解码前使用的轻量图片尺寸解析。 */

const READ_WINDOW_BYTES = 64;
const MAX_METADATA_READ_BYTES = 64 * 1024;
const MAX_JPEG_SEGMENTS = 256;
const MAX_WEBP_CHUNKS = 256;

export type SupportedImageFormat = "PNG" | "JPEG" | "WebP" | "GIF";

export interface ImageMetadata {
  readonly format: SupportedImageFormat;
  readonly width: number;
  readonly height: number;
}

class BlobRangeReader {
  private cacheOffset = 0;
  private cache = new Uint8Array(0);
  private totalRead = 0;

  constructor(private readonly blob: Blob) {}

  get size(): number {
    return this.blob.size;
  }

  async read(offset: number, length: number, label = "静态图片数据不完整"): Promise<Uint8Array> {
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length <= 0
    ) {
      throw new Error("静态图片元数据偏移无效");
    }
    const end = offset + length;
    if (!Number.isSafeInteger(end) || end > this.blob.size) {
      throw new Error(label);
    }

    const cacheEnd = this.cacheOffset + this.cache.byteLength;
    if (offset >= this.cacheOffset && end <= cacheEnd) {
      return this.cache.subarray(offset - this.cacheOffset, end - this.cacheOffset);
    }

    const readEnd = Math.min(this.blob.size, offset + Math.max(length, READ_WINDOW_BYTES));
    const readLength = readEnd - offset;
    if (this.totalRead + readLength > MAX_METADATA_READ_BYTES) {
      throw new Error(`静态图片元数据过大：最多读取 ${MAX_METADATA_READ_BYTES} 字节`);
    }
    this.cacheOffset = offset;
    this.cache = new Uint8Array(await this.blob.slice(offset, readEnd).arrayBuffer());
    this.totalRead += this.cache.byteLength;
    return this.cache.subarray(0, length);
  }
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function assertDimensions(
  format: SupportedImageFormat,
  width: number,
  height: number,
): ImageMetadata {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`${format} 图片尺寸无效：${width}x${height}`);
  }
  return { format, width, height };
}

async function readPng(reader: BlobRangeReader): Promise<ImageMetadata> {
  const bytes = await reader.read(0, 33, "PNG 数据不完整");
  const lengthView = new DataView(bytes.buffer, bytes.byteOffset + 8, 4);
  if (lengthView.getUint32(0) !== 13 || ascii(bytes, 12, 4) !== "IHDR") {
    throw new Error("PNG 缺少有效的 IHDR");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return assertDimensions("PNG", view.getUint32(16), view.getUint32(20));
}

const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function isStandaloneJpegMarker(marker: number): boolean {
  return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);
}

async function readJpeg(reader: BlobRangeReader): Promise<ImageMetadata> {
  let offset = 2;
  for (let segmentIndex = 0; segmentIndex < MAX_JPEG_SEGMENTS; segmentIndex += 1) {
    const markerPrefix = await reader.read(offset, 1, "JPEG 标记不完整");
    if (markerPrefix[0] !== 0xff) {
      throw new Error("JPEG 标记无效");
    }

    let markerCode: number;
    do {
      offset += 1;
      const code = await reader.read(offset, 1, "JPEG 标记不完整");
      markerCode = code[0];
    } while (markerCode === 0xff);

    if (markerCode === 0x00 || markerCode === 0xd8) throw new Error("JPEG 标记无效");
    if (markerCode === 0xd9) break;
    if (markerCode === 0xda) throw new Error("JPEG 在尺寸信息前进入扫描数据");
    if (isStandaloneJpegMarker(markerCode)) {
      // 独立标记（TEM/RSTn）没有长度字段，前进 1 字节消费标记码，否则下一轮会误判
      offset += 1;
      continue;
    }

    offset += 1;
    const lengthBytes = await reader.read(offset, 2, "JPEG segment 长度不完整");
    const segmentLength = (lengthBytes[0] << 8) | lengthBytes[1];
    if (segmentLength < 2) throw new Error("JPEG segment 长度无效");
    const nextOffset = offset + segmentLength;
    if (!Number.isSafeInteger(nextOffset) || nextOffset > reader.size) {
      throw new Error("JPEG segment 超出文件边界");
    }

    if (JPEG_SOF_MARKERS.has(markerCode)) {
      if (segmentLength < 8) throw new Error("JPEG SOF 数据不完整");
      const sof = await reader.read(offset, 8, "JPEG SOF 数据不完整");
      const height = (sof[3] << 8) | sof[4];
      const width = (sof[5] << 8) | sof[6];
      return assertDimensions("JPEG", width, height);
    }
    offset = nextOffset;
  }
  throw new Error("JPEG 缺少尺寸信息");
}

function uint24le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

async function readWebp(reader: BlobRangeReader): Promise<ImageMetadata> {
  const header = await reader.read(0, 20, "WebP 数据不完整");
  const headerView = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const riffEnd = headerView.getUint32(4, true) + 8;
  if (!Number.isSafeInteger(riffEnd) || riffEnd < 20 || riffEnd > reader.size) {
    throw new Error("WebP RIFF 长度超出文件边界");
  }

  let offset = 12;
  for (let chunkIndex = 0; chunkIndex < MAX_WEBP_CHUNKS && offset < riffEnd; chunkIndex += 1) {
    const chunkHeader = await reader.read(offset, 8, "WebP chunk 头不完整");
    const chunkType = ascii(chunkHeader, 0, 4);
    const chunkSize = new DataView(
      chunkHeader.buffer,
      chunkHeader.byteOffset,
      chunkHeader.byteLength,
    ).getUint32(4, true);
    const dataOffset = offset + 8;
    const paddedSize = chunkSize + (chunkSize & 1);
    const nextOffset = dataOffset + paddedSize;
    if (!Number.isSafeInteger(nextOffset) || nextOffset > riffEnd) {
      throw new Error("WebP chunk 超出 RIFF 边界");
    }

    if (chunkType === "VP8X") {
      if (chunkSize < 10) throw new Error("WebP VP8X 数据不完整");
      const data = await reader.read(dataOffset, 10, "WebP VP8X 数据不完整");
      return assertDimensions("WebP", uint24le(data, 4) + 1, uint24le(data, 7) + 1);
    }
    if (chunkType === "VP8L") {
      if (chunkSize < 5) throw new Error("WebP VP8L 数据不完整");
      const data = await reader.read(dataOffset, 5, "WebP VP8L 数据不完整");
      if (data[0] !== 0x2f) throw new Error("WebP VP8L 签名无效");
      const packed = new DataView(data.buffer, data.byteOffset + 1, 4).getUint32(0, true);
      return assertDimensions("WebP", (packed & 0x3fff) + 1, ((packed >>> 14) & 0x3fff) + 1);
    }
    if (chunkType === "VP8 ") {
      if (chunkSize < 10) throw new Error("WebP VP8 数据不完整");
      const data = await reader.read(dataOffset, 10, "WebP VP8 数据不完整");
      if (data[3] !== 0x9d || data[4] !== 0x01 || data[5] !== 0x2a) {
        throw new Error("WebP VP8 帧头无效");
      }
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      return assertDimensions(
        "WebP",
        view.getUint16(6, true) & 0x3fff,
        view.getUint16(8, true) & 0x3fff,
      );
    }
    offset = nextOffset;
  }
  throw new Error("WebP 缺少尺寸信息");
}

async function readGif(reader: BlobRangeReader): Promise<ImageMetadata> {
  const bytes = await reader.read(0, 10, "GIF 数据不完整");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return assertDimensions("GIF", view.getUint16(6, true), view.getUint16(8, true));
}

export async function readImageMetadata(blob: Blob): Promise<ImageMetadata> {
  const reader = new BlobRangeReader(blob);
  const signature = await reader.read(0, 12);
  if (
    signature[0] === 0x89 &&
    signature[1] === 0x50 &&
    signature[2] === 0x4e &&
    signature[3] === 0x47 &&
    signature[4] === 0x0d &&
    signature[5] === 0x0a &&
    signature[6] === 0x1a &&
    signature[7] === 0x0a
  ) {
    return readPng(reader);
  }
  if (signature[0] === 0xff && signature[1] === 0xd8) return readJpeg(reader);
  if (ascii(signature, 0, 4) === "RIFF" && ascii(signature, 8, 4) === "WEBP") {
    return readWebp(reader);
  }
  const gifSignature = ascii(signature, 0, 6);
  if (gifSignature === "GIF87a" || gifSignature === "GIF89a") return readGif(reader);
  throw new Error("不支持的静态图片格式，仅支持 PNG、JPEG、WebP 和 GIF");
}
