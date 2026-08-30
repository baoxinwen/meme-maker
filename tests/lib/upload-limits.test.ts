import { describe, expect, it } from "vitest";
import {
  UPLOAD_LIMITS,
  assertAvatarFileBasics,
  assertFrameSequence,
  assertGifFrameLimit,
  assertImageDimensions,
  assertImageFileBasics,
  assertUploadCollection,
} from "../../src/lib/upload-limits";

describe("upload-limits", () => {
  it("拒绝超出头像大小限制的文件", () => {
    const file = new File([new Uint8Array(UPLOAD_LIMITS.avatarMaxBytes + 1)], "avatar.png", {
      type: "image/png",
    });

    expect(() => assertImageFileBasics(file, "avatar")).toThrow(/文件过大/);
  });

  it("拒绝超出最大边长的图片尺寸", () => {
    expect(() => assertImageDimensions(UPLOAD_LIMITS.imageMaxEdge + 1, 100)).toThrow(/尺寸过大/);
  });

  it("拒绝超过上限的 GIF 帧数", () => {
    expect(() => assertGifFrameLimit(UPLOAD_LIMITS.gifMaxFrames + 1)).toThrow(/帧数过多/);
  });

  it("接受视频头像，但仍执行单文件大小限制", () => {
    expect(() =>
      assertAvatarFileBasics(new File(["video"], "a.webm", { type: "video/webm" })),
    ).not.toThrow();
    expect(() =>
      assertAvatarFileBasics(
        new File([new Uint8Array(UPLOAD_LIMITS.avatarMaxBytes + 1)], "a.webm", {
          type: "video/webm",
        }),
      ),
    ).toThrow(/文件过大/);
  });

  it.each(["image/svg+xml", "image/avif", "image/bmp"])(
    "头像与背景上传在解码前拒绝不支持的 %s",
    (type) => {
      const file = new File(["image"], "unsupported", { type });

      expect(() => assertAvatarFileBasics(file)).toThrow(/不支持的头像格式/);
      expect(() => assertImageFileBasics(file, "background")).toThrow(/不支持的背景图格式/);
    },
  );

  it.each(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"])(
    "允许声明支持的图片 MIME：%s",
    (type) => {
      const file = new File(["image"], "supported", { type });

      expect(() => assertAvatarFileBasics(file)).not.toThrow();
      expect(() => assertImageFileBasics(file, "background")).not.toThrow();
    },
  );

  it("拒绝过多 RANDOM 候选和尺寸不一致的背景帧", () => {
    const candidates = Array.from(
      { length: UPLOAD_LIMITS.randomAvatarMaxFiles + 1 },
      (_, index) => new File(["x"], `${index}.png`, { type: "image/png" }),
    );
    expect(() => assertUploadCollection(candidates, "random-avatar")).toThrow(/数量过多/);
    expect(() =>
      assertFrameSequence([
        { width: 100, height: 100 },
        { width: 120, height: 100 },
      ]),
    ).toThrow(/尺寸不一致/);
  });
});
