/**
 * 核心层结构化错误 —— 让界面能按类型分支，而不必解析错误文案。
 */

/** 缺少头像输入错误：界面据此显示对应槽位的上传引导，而非通用报错。 */
export class MissingAvatarInputError extends Error {
  /** 头像槽位类型（FROM/TO/BOT/GROUP/RANDOM/USER） */
  readonly avatarType: string;
  /** USER 类型缺少的第几个输入（从 0 开始）；其他类型为 null */
  readonly inputIndex: number | null;

  constructor(message: string, avatarType: string, inputIndex: number | null = null) {
    super(message);
    this.name = "MissingAvatarInputError";
    this.avatarType = avatarType;
    this.inputIndex = inputIndex;
  }
}

export function isMissingAvatarInputError(error: unknown): error is MissingAvatarInputError {
  return error instanceof MissingAvatarInputError;
}
