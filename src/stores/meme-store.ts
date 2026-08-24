/**
 * Zustand 状态管理：使用一个状态仓库管理整个表情包制作流程。
 *
 * 设计原则：
 *   - 全部状态只在当前会话有效，刷新后回到未选模板的初始状态
 *   - 不写 localStorage：历史版本的 textOverrides 持久化从未被实际复用
 *     （选模板即清空），恢复被污染的本地数据反而是无收益的攻击面
 */

import {
  type AvatarSource,
  type AvatarType,
  FULL_AVATAR_CROP,
  type TemplateOptionValue,
} from "@/core";
import { create } from "zustand";

export type AvatarState = Partial<
  Record<Exclude<AvatarType, "RANDOM" | "USER">, AvatarSource | null>
> & {
  RANDOM?: AvatarSource[];
  USER?: AvatarSource[];
};

export type AvatarValue = AvatarSource | AvatarSource[] | null;
export type TemplateOptionState = Record<string, TemplateOptionValue>;

/** 用户对一个文字模板的覆盖值（同位置覆盖原模板默认） */
export interface TextOverride {
  readonly text?: string;
  readonly color?: string;
  readonly size?: number;
  readonly hidden?: boolean;
}

interface MemeState {
  /** 当前选中的模板 key，null = 未选 */
  selectedTemplate: string | null;

  /** 每个 AvatarType 对应的用户上传 Blob（不持久化）；RANDOM/USER 使用头像列表 */
  avatars: AvatarState;

  /** 文字覆盖：索引 → 覆盖值 */
  textOverrides: Record<number, TextOverride>;

  /** 当前模板的选项覆盖；未填写的选项使用模板默认值。 */
  optionValues: TemplateOptionState;

  // —— 操作
  setSelectedTemplate: (key: string | null) => void;
  setAvatar: (type: AvatarType, value: AvatarValue) => void;
  clearAvatars: () => void;
  setTextOverride: (index: number, override: TextOverride) => void;
  resetTextOverrides: () => void;
  setOptionValue: (key: string, value: TemplateOptionValue) => void;
  resetOptionValues: () => void;
}

export const useMemeStore = create<MemeState>()((set) => ({
  selectedTemplate: null,
  avatars: {},
  textOverrides: {},
  optionValues: {},

  setSelectedTemplate: (key) =>
    set({ selectedTemplate: key, textOverrides: {}, optionValues: {}, avatars: {} }),

  setAvatar: (type, value) =>
    set((state) => ({ avatars: updateAvatar(state.avatars, type, value) })),

  clearAvatars: () => set({ avatars: {} }),

  setTextOverride: (index, override) =>
    set((state) => ({
      textOverrides: {
        ...state.textOverrides,
        [index]: { ...state.textOverrides[index], ...override },
      },
    })),

  resetTextOverrides: () => set({ textOverrides: {} }),

  setOptionValue: (key, value) =>
    set((state) => ({ optionValues: { ...state.optionValues, [key]: value } })),

  resetOptionValues: () => set({ optionValues: {} }),
}));

function updateAvatar(avatars: AvatarState, type: AvatarType, value: AvatarValue): AvatarState {
  const next: AvatarState = { ...avatars };
  if (type === "RANDOM" || type === "USER") {
    if (Array.isArray(value) && value.length > 0) {
      next[type] = value;
    } else {
      next[type] = undefined;
    }
    return next;
  }

  if (value && !Array.isArray(value) && value.blob instanceof Blob) {
    next[type] = value;
  } else {
    next[type] = undefined;
  }
  return next;
}

export function createAvatarSource(blob: Blob): AvatarSource {
  return { blob, crop: { ...FULL_AVATAR_CROP } };
}
