import { describe, expect, it } from "vitest";

import { getAvatarSlots } from "../../src/components/avatar-uploader";
import { parseTemplate } from "../../src/core";

describe("头像上传槽位", () => {
  it("取多个 USER 循环图层上限的最大值", () => {
    const template = parseTemplate({
      type: "GIF",
      avatar: [
        {
          type: "USER",
          inputCycle: { framesPerInput: 1, maxInputs: 2 },
          pos: [0, 0, 8, 8],
        },
        {
          type: "USER",
          inputCycle: { framesPerInput: 1, maxInputs: 4 },
          pos: [8, 0, 8, 8],
        },
      ],
      text: [],
      background: { size: [16, 8] },
    });

    expect(getAvatarSlots(template)).toEqual([{ type: "USER", requiredCount: 1, maxCount: 4 }]);
  });

  it("模板上限不会阻断可选的固定 USER 输入", () => {
    const template = parseTemplate({
      type: "IMG",
      avatar: [
        {
          type: "USER",
          inputCycle: { framesPerInput: 1, maxInputs: 4 },
          pos: [0, 0, 8, 8],
        },
        { type: "USER", input: 5, optional: true, pos: [8, 0, 8, 8] },
      ],
      text: [],
      background: { size: [16, 8] },
    });

    expect(getAvatarSlots(template)).toEqual([{ type: "USER", requiredCount: 1, maxCount: 6 }]);
  });

  it("任一循环图层未声明上限时不设置模板级上限", () => {
    const template = parseTemplate({
      type: "GIF",
      avatar: [
        {
          type: "USER",
          inputCycle: { framesPerInput: 1, maxInputs: 2 },
          pos: [0, 0, 8, 8],
        },
        {
          type: "USER",
          inputCycle: { framesPerInput: 1 },
          pos: [8, 0, 8, 8],
        },
      ],
      text: [],
      background: { size: [16, 8] },
    });

    expect(getAvatarSlots(template)).toEqual([{ type: "USER", requiredCount: 1 }]);
  });
});
