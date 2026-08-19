/** 模板仓库中存在 167 帧的合法模板，上限需高于上传 GIF 的 120 帧限制。 */
export const MAX_SCENE_FRAMES = 512;

/** 场景全部输出帧允许占用的最大像素总量。 */
export const DEFAULT_MAX_SCENE_TOTAL_PIXELS = 128 * 1024 * 1024;

/** 浏览器媒体解码允许的最大单边长度。 */
export const MAX_MEDIA_EDGE = 4096;

/** 场景输出/工作画布允许的最大单边长度。 */
export const MAX_CANVAS_EDGE = 4096;

/** 浏览器媒体解码期间允许占用的估算 RGBA 内存。 */
export const DEFAULT_MAX_MEDIA_MEMORY_BYTES = 512 * 1024 * 1024;

/** USER 顺序头像输入集合的核心层硬上限。 */
export const MAX_USER_AVATAR_INPUTS = 20;
