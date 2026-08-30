import { describe, expect, it } from "vitest";
import { parseTemplate } from "../../src/core/schema/template";

describe("parseTemplate", () => {
  it("解析 osu 模板（典型 IMG 类型）", () => {
    const json = {
      type: "IMG",
      avatar: [],
      text: [
        {
          text: "osu!",
          color: "#ffffff",
          pos: [175, 175, 230],
          size: 104,
          font: "Aller-Bold",
          wrap: "ZOOM",
          align: "CENTER",
          style: "BOLD",
        },
      ],
      inRandomList: false,
    };
    const parsed = parseTemplate(json);
    expect(parsed.type).toBe("IMG");
    expect(parsed.text).toHaveLength(1);
    expect(parsed.text[0].font).toBe("Aller-Bold");
    expect(parsed.avatar).toEqual([]);
  });

  it("解析 tightly 模板（GIF 多帧）", () => {
    const json = {
      type: "GIF",
      avatar: [
        {
          type: "TO",
          pos: [
            [39, 169, 267, 141],
            [40, 167, 264, 143],
          ],
          avatarOnTop: false,
        },
      ],
      text: [],
      alias: ["黏"],
    };
    const parsed = parseTemplate(json);
    expect(parsed.type).toBe("GIF");
    expect(parsed.avatar[0].type).toBe("TO");
    expect(parsed.avatar[0].avatarOnTop).toBe(false);
    expect(parsed.alias).toEqual(["黏"]);
  });

  it("解析逐帧角度、不透明度、方形裁剪和反相样式", () => {
    const parsed = parseTemplate({
      type: "GIF",
      avatar: [
        {
          type: "TO",
          pos: [
            [
              [0, 0],
              [32, 0],
              [32, 32],
              [0, 32],
              [0, 0],
            ],
            [
              [1, 1],
              [33, 1],
              [33, 33],
              [1, 33],
              [1, 1],
            ],
          ],
          posType: "DEFORM",
          deformSize: [320, 180],
          deformCrop: [0, 0, 160, 180],
          preFitSize: [160, 120],
          square: true,
          style: ["INVERT"],
          preRotate: [0, 90],
          preRotateMode: "EXPAND",
          angle: [0, 90],
          opacity: [1, 0.5],
        },
      ],
    });

    expect(parsed.avatar[0].square).toBe(true);
    expect(parsed.avatar[0].deformSize).toEqual([320, 180]);
    expect(parsed.avatar[0].deformCrop).toEqual([0, 0, 160, 180]);
    expect(parsed.avatar[0].preFitSize).toEqual([160, 120]);
    expect(parsed.avatar[0].style).toEqual(["INVERT"]);
    expect(parsed.avatar[0].preRotate).toEqual([0, 90]);
    expect(parsed.avatar[0].preRotateMode).toBe("EXPAND");
    expect(parsed.avatar[0].angle).toEqual([0, 90]);
    expect(parsed.avatar[0].opacity).toEqual([1, 0.5]);
  });

  it("解析文字区域与自动字号范围", () => {
    const parsed = parseTemplate({
      type: "IMG",
      text: [
        {
          text: "区域文字",
          area: [0, 0, 200, 80],
          minSize: 16,
          maxSize: 48,
        },
      ],
    });

    expect(parsed.text[0].area).toEqual([0, 0, 200, 80]);
    expect(parsed.text[0].minSize).toBe(16);
    expect(parsed.text[0].maxSize).toBe(48);
  });

  it("拒绝超出文字字号预算的数值 maxSize", () => {
    expect(() =>
      parseTemplate({
        type: "IMG",
        text: [{ text: "区域文字", area: [0, 0, 200, 80], maxSize: 1e308 }],
      }),
    ).toThrow(/maxSize/);
  });

  it("拒绝超出归一化范围的网屏中心坐标", () => {
    expect(() =>
      parseTemplate({
        type: "IMG",
        avatar: [
          {
            type: "TO",
            pos: [0, 0, 8, 8],
            filter: [{ type: "HALFTONE", x: 1e308 }],
          },
        ],
      }),
    ).toThrow(/filter\.0\.x/);
  });

  it("限制单个头像的滤镜数量", () => {
    expect(() =>
      parseTemplate({
        type: "IMG",
        avatar: [
          {
            type: "TO",
            pos: [0, 0, 8, 8],
            filter: Array.from({ length: 33 }, () => ({ type: "NOISE" })),
          },
        ],
      }),
    ).toThrow(/filter/);
  });

  it("限制单个头像的样式数量，并接受上限边界", () => {
    const parsed = parseTemplate({
      type: "IMG",
      avatar: [
        {
          type: "TO",
          pos: [0, 0, 8, 8],
          style: Array.from({ length: 16 }, () => "INVERT"),
        },
      ],
    });

    expect(parsed.avatar[0].style).toHaveLength(16);
    expect(() =>
      parseTemplate({
        type: "IMG",
        avatar: [
          {
            type: "TO",
            pos: [0, 0, 8, 8],
            style: Array.from({ length: 17 }, () => "INVERT"),
          },
        ],
      }),
    ).toThrow(/avatar\.0\.style/);
  });

  it("限制单个头像的裁切多边形顶点数量，并接受上限边界", () => {
    const parsed = parseTemplate({
      type: "IMG",
      avatar: [
        {
          type: "TO",
          pos: [0, 0, 8, 8],
          clipPolygon: Array.from({ length: 256 }, (_, index) => [index, index]),
        },
      ],
    });

    expect(parsed.avatar[0].clipPolygon).toHaveLength(256);
    expect(() =>
      parseTemplate({
        type: "IMG",
        avatar: [
          {
            type: "TO",
            pos: [0, 0, 8, 8],
            clipPolygon: Array.from({ length: 257 }, (_, index) => [index, index]),
          },
        ],
      }),
    ).toThrow(/avatar\.0\.clipPolygon/);
  });

  it.each([
    ["avatar", 65, { type: "TO", pos: [0, 0, 1, 1] }],
    ["text", 33, { text: "文字" }],
  ] as const)("限制模板 %s 图层数量", (field, count, item) => {
    expect(() =>
      parseTemplate({
        type: "IMG",
        [field]: Array.from({ length: count }, () => item),
      }),
    ).toThrow(new RegExp(field));
  });

  it.each([
    ["layers", 129],
    ["foregroundLayers", 17],
  ] as const)("限制背景 %s 图层数量", (field, count) => {
    expect(() =>
      parseTemplate({
        type: "IMG",
        background: {
          size: [1, 1],
          [field]: Array.from({ length: count }, () => ({ asset: "layer.png" })),
        },
      }),
    ).toThrow(new RegExp(field));
  });

  it("解析逐帧预适配尺寸", () => {
    const parsed = parseTemplate({
      type: "GIF",
      avatar: [
        {
          type: "TO",
          pos: [
            [0, 0, 10, 10],
            [0, 0, 20, 20],
          ],
          preFitSize: [
            [10, 10],
            [20, 20],
          ],
        },
      ],
    });

    expect(parsed.avatar[0].preFitSize).toEqual([
      [10, 10],
      [20, 20],
    ]);
  });

  it("解析合成后的逐帧旋转裁切", () => {
    const parsed = parseTemplate({
      type: "GIF",
      background: { size: [600, 600], length: 5 },
      frameTransform: {
        type: "ROTATE_CROP",
        angle: [0, 18, 36, 54, 72],
        crop: [50, 50, 500, 500],
      },
    });

    expect(parsed.frameTransform).toEqual({
      type: "ROTATE_CROP",
      angle: [0, 18, 36, 54, 72],
      crop: [50, 50, 500, 500],
    });
  });

  it("解析头像的逐帧 Y 轴透视旋转", () => {
    const parsed = parseTemplate({
      type: "GIF",
      avatar: [
        {
          type: "FROM",
          pos: [0, 0, 100, 80],
          projection: { type: "ROTATE_Y", angle: [0, 45, 90], fov: 50 },
        },
      ],
      background: { size: [100, 80], length: 3 },
    });

    expect(parsed.avatar[0].projection).toEqual({
      type: "ROTATE_Y",
      angle: [0, 45, 90],
      fov: 50,
      loop: false,
      align: "BOUNDS_CENTER",
    });
  });

  it("解析 USER 输入循环、多边形裁切和自定义三维模型", () => {
    const parsed = parseTemplate({
      type: "GIF",
      avatar: [
        {
          type: "USER",
          inputCycle: { framesPerInput: 15, offset: 1, maxInputs: 4 },
          pos: [0, 0, 180, 254],
          clipPolygon: [
            [90, 0],
            [0, 254],
            [180, 254],
          ],
          projection: {
            type: "ROTATE_Y",
            angle: [-90, -45, 0],
            loop: true,
            model: [
              [-90, -90, 0],
              [90, -90, 0],
              [90, 90, 90],
              [-90, 90, 90],
            ],
            cameraSize: [300, 300],
            align: "MODEL_CENTER",
          },
        },
      ],
      background: { size: [300, 300] },
    });

    expect(parsed.avatar[0].inputCycle).toEqual({
      framesPerInput: 15,
      offset: 1,
      maxInputs: 4,
    });
    expect(parsed.avatar[0].clipPolygon).toHaveLength(3);
    expect(parsed.avatar[0].projection).toMatchObject({
      loop: true,
      cameraSize: [300, 300],
      align: "MODEL_CENTER",
    });
  });

  it("缺少 type 字段时抛出可读错误", () => {
    expect(() => parseTemplate({ avatar: [], text: [] })).toThrow(/type/);
  });

  it("错误的 type 值时抛出错误", () => {
    expect(() => parseTemplate({ type: "BMP", avatar: [], text: [] })).toThrow();
  });

  it("默认值生效（缺省的 avatar / text 自动变 []）", () => {
    const parsed = parseTemplate({ type: "IMG" });
    expect(parsed.avatar).toEqual([]);
    expect(parsed.text).toEqual([]);
  });
});

describe("模板数值边界校验", () => {
  // 回归：越界的 color 数组拼出非法 rgba 串被 Canvas 静默忽略、背景渲染成黑色；
  // 越界 opacity 直接赋 globalAlpha 被规范忽略，按全不透明渲染（评审意见 I3）。
  it("拒绝 background 颜色数组元素越界", () => {
    expect(() =>
      parseTemplate({
        type: "IMG",
        avatar: [],
        text: [],
        background: { size: [100, 100], color: [300, 300, 300] },
      }),
    ).toThrow();
    expect(() =>
      parseTemplate({
        type: "IMG",
        avatar: [],
        text: [],
        background: { size: [100, 100], color: [10, -1, 10] },
      }),
    ).toThrow();
  });

  it("接受合法的 background 颜色数组", () => {
    const parsed = parseTemplate({
      type: "IMG",
      avatar: [],
      text: [],
      background: { size: [100, 100], color: [200, 100, 50, 0.5] },
    });
    expect(parsed.background?.color).toEqual([200, 100, 50, 0.5]);
  });

  it("拒绝头像 opacity 超出 [0,1]", () => {
    for (const opacity of [-0.5, 1.5, [0.5, 2]]) {
      expect(() =>
        parseTemplate({
          type: "IMG",
          avatar: [{ type: "TO", pos: [0, 0, 10, 10], opacity: opacity as never }],
          text: [],
        }),
      ).toThrow(/opacity|不透明度/i);
    }
  });
});
