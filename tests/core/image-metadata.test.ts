import { describe, expect, it } from "vitest";

import { readImageMetadata } from "../../src/core/codec/image-metadata";

describe("JPEG 独立标记容忍", () => {
  // 回归：TEM/RSTn 独立标记后 offset 未消费标记码字节，下一轮误报「JPEG 标记无效」（评审意见 M1）。
  it("SOF 前出现 TEM 独立标记不再误报标记无效", async () => {
    // SOI + TEM（独立标记）+ EOI + 尾部填充（分发前置读取需要 12 字节）
    const bytes = new Uint8Array([
      0xff, 0xd8, 0xff, 0x01, 0xff, 0xd9, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    const blob = new Blob([bytes], { type: "image/jpeg" });

    await expect(readImageMetadata(blob)).rejects.toThrow(/缺少尺寸信息/);
  });
});
