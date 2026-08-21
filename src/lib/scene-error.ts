/**
 * 场景错误 —— 把核心层抛出的异常整理成界面可分支的结构，
 * 替代旧的"用正则解析错误文案"做法。
 */

import { isMissingAvatarInputError } from "@/core";

export interface MissingAvatarInfo {
  readonly type: string;
  /** USER 类型缺少的第几个输入（从 0 开始）；其他类型为 null */
  readonly inputIndex: number | null;
}

export interface SceneError {
  readonly message: string;
  /** 非 null 时是"缺头像引导态"，界面显示上传提示而非报错。 */
  readonly missingAvatar: MissingAvatarInfo | null;
}

export function toSceneError(error: unknown): SceneError {
  const message = error instanceof Error ? error.message : String(error);
  if (isMissingAvatarInputError(error)) {
    return {
      message,
      missingAvatar: { type: error.avatarType, inputIndex: error.inputIndex },
    };
  }
  return { message, missingAvatar: null };
}
