# AGENTS.md

给 AI 助手的上手指南。读完这一份就能动手改这个项目。

## 项目是什么

MemeMaker 是一个**纯浏览器端**的表情包生成器（React 19 + TypeScript + Vite）。核心流程：选模板 → 上传头像 → 加文字 → 一键生成 PNG / GIF。所有图像合成在浏览器里用 Canvas 2D 完成，无后端、无 WebGL。

## 架构心智模型

三层，依赖单向向下：

```
core/        ← 纯函数合成引擎（无 React、无 DOM 依赖，可在 Node 跑）
  ↑
lib/         ← 加载器与桥接（模板/字体加载、Fabric 桥接、编辑器编译）
  ↑
components/ pages/ stores/  ← React 界面与状态
```

**关键约束**：`src/core/` 不得导入任何 React、`@/components` 或 `@/stores` 内容。它通过 `utils/runtime.ts` 抽象 Canvas/Image：浏览器使用 DOM 实现，Node 测试由 `tests/setup.ts` 注入 `@napi-rs/canvas`。这让引擎能在 Vitest 中渲染真实像素。

## 核心数据流

```
fetchTemplateIndex()                        // lib/template-loader.ts，规范化并过滤 hidden
fetchTemplate(key, length, revision?)       // lib/template-loader.ts
  → { rawTemplate: data.json, backgrounds: [0.png, 1.png, ...], backgroundLayers }
prepareScene(rawTemplate, { inputs, backgroundImages, optionValues, … })   // core/renderer/compositor.ts
  → PreparedScene { width, height, frameCount, backgrounds, bottomAvatars, topAvatars, texts, sizeMap, foregrounds 等 }
renderAllFrames(scene)                      // 按展示/导出顺序逐帧画到 Canvas；reverse 在这里生效
  → HTMLCanvasElement[]
encodeGif(frames, options)                  // 场景帧数 > 1 时触发（与模板 type 无关）；options 含 delay 等
  → GIF Blob → 下载
```

主应用使用 `useScene(entry, avatars, textOverrides, optionValues)` 钩子（`hooks/use-scene.ts`）。它先解析模板供界面展示上传槽位，再合并文字覆盖与模板选项值、等待字体加载、整理头像输入，缓存模板资源与 `PreparedScene`（不缓存渲染帧）。`renderFrame(scene, rawIndex, canvas)` 始终按原始帧号渲染；下载用 `renderAllFrames(scene)`，预览按当前帧调 `renderFrame()` 并套用同一 `reverse` 映射，因此展示与导出一致。

## 模块地图

| 路径 | 职责 |
|---|---|
| `core/schema/template.ts` | Zod 模板校验 + 类型。**新增模板字段先在这里声明**，否则 zod 默认丢弃（见下方雷区） |
| `core/renderer/compositor.ts` | `prepareScene` / `renderFrame` / `renderAllFrames`——引擎主流程 |
| `core/renderer/avatar.ts` | 头像解码、裁剪/风格/滤镜/圆形、位置表达式编译、绘制（ZOOM 缩放 / DEFORM 透视变形）；`RANDOM` 接收多个候选头像（`Blob` 或 `{ blob, crop }`），`antialias/resampling` 映射到 `imageSmoothingEnabled` |
| `core/renderer/text.ts` | 文字变量解包、关键词默认值替换、测量、布局（NONE/BREAK/ZOOM 三种换行模式）、`position` 基准偏移、绘制 |
| `core/renderer/background.ts` | 背景生成：纯色画布 / 外部图 / 动态尺寸（表达式引用 `avatar0Width` 等） |
| `core/filters/` | 14 种纯 Canvas 2D 图像滤镜（SWIRL/BULGE/SWIM/BLUR/OIL/COLORIZE/AFTERIMAGE/PIXELATE 等），支持逐帧参数数组 |
| `core/transforms/` | 图像变换（crop/flip/gray/binarize/clip-circle/fit/deform） |
| `core/codec/` | GIF 编码（gifenc）/ GIF 解码（gifuct-js）/ HTMLVideoElement 视频抽帧 |
| `core/utils/expression.ts` | 模板数值字段共用的白名单表达式解析器：允许数字、变量、括号、`+ - * / % ^` 和 sqrt/min/max/if 等白名单函数 |
| `lib/template-loader.ts` | 从 `public/data/templates/` fetch 模板索引、模板与背景图（带 revision 时改走内容寻址路径 `/data/template-assets/<key>/<revision>/`）；`normalizeTemplateIndex()` 会过滤 `hidden: true` |
| `lib/font-loader.ts` | 注册模板引用的自定义字体别名（FontFace API）；`loadTemplateFonts()` 返回 Promise，渲染前必须等待完成 |
| `lib/upload-limits.ts` | 上传限制与校验：头像 10MB、背景 20MB、最大边长 4096px、GIF/背景最多 120 帧，并限制候选数量与总大小 |
| `lib/editor/` | 模板编辑器：`compile.ts`（状态仓库 → PetpetTemplate）、`fabric-utils.ts`（Fabric 桥接）、`export-zip.ts`（导出 ZIP） |
| `stores/meme-store.ts` | 主应用状态（选中模板/头像/文字覆盖/模板选项值），不持久化任何状态（有意决策，见源码头注释）；刷新后回到未选模板的初始状态 |
| `stores/editor-store.ts` | 编辑器状态（帧/图层/元信息），Fabric 是它的当前帧视图；经 `zundo` temporal 包装提供撤销/重做（快照只含 frames/canvasSize/meta/layers，上限 50 条，背景解码期间 pause 聚合为一条） |
| `components/` | 主应用组件；`components/editor/` 是模板编辑器 |
| `pages/meme-maker-page.tsx` | 主应用页（`/`） |
| `pages/template-editor-page.tsx` | 模板编辑器页（`/editor`） |

> 页面组件在 `src/pages/`，编辑器组件在 `src/components/editor/`。

## 约定

- **语言**：界面文字、文档、代码注释、提交摘要和正文统一使用中文，不接入国际化；代码标识符、文件路径、依赖名称、模板字段和约定式提交类型保留英文
- **图像处理**：纯 Canvas 2D，不引入 WebGL
- **PWA 缓存**：首次安装只预缓存应用外壳、图标和应用清单；模板索引、内容寻址的模板资产与字体使用运行时缓存
- **代码风格**：Biome——双引号、分号、2 空格缩进、`useImportType` 强制、`noNonNullAssertion` off、`noExplicitAny` warn。`pnpm lint` / `pnpm lint:fix`
- **视觉风格**：活泼梗图风（奶油底/午夜紫 + 墨线描边 + 错位硬阴影），设计令牌全部集中在 `styles/globals.css`（含 `.dark` 暗色集），组件内禁止硬编码颜色
- **日志**：统一走 `lib/logger.ts`（基于 loglevel），禁止直接 `console.*`。级别语义：error=操作失败、warn=降级运行、info=关键成功路径、debug=诊断细节；生产默认 warn，调试用 URL `?log=debug` 或 `localStorage["meme-maker:logLevel"]` 覆盖
- **路径别名**：`@/` 指向 `src/`
- **提交**：采用约定式提交；类型前缀保留英文，摘要和正文使用中文
- **依赖**：pnpm 10、Node 20+

## 常用命令

```bash
pnpm install              # 装依赖
pnpm dev                  # 开发服务器 http://localhost:5173
pnpm build                # 生产构建（tsc -b && vite build）
pnpm test                 # 单元 + 集成测试（Vitest）
pnpm test:templates       # 非破坏性验证全部索引模板
pnpm test:e2e             # 端到端测试（Playwright，首次需 pnpm test:e2e:install）
pnpm test:gen-previews    # 为程序化特效模板写 0.png/preview.gif、重写声明 thumbnail 条目并重建索引（public/data/templates/）
pnpm lint                 # Biome 检查
pnpm typecheck            # tsc -b --noEmit
pnpm check                # 类型 + lint + 单测 + 模板验证 + 构建
pnpm check:ci             # check + Playwright 完整门禁
```

在非交互环境里如果 `pnpm dev` 触发依赖清理保护，可直接使用本地可执行文件：`.\node_modules\.bin\vite.cmd --host 127.0.0.1 --port 5173 --strictPort`，再运行 `.\node_modules\.bin\playwright.cmd test`。

## 调试渲染问题（方法论）

**不要用图片分析工具**——用户的模型不支持图片输入。排查"生成的 PNG 错乱"走代码路径：

1. **读模板**：`public/data/templates/<key>/data.json`，对照预期效果想清楚每个字段应如何渲染
2. **查数据结构定义是否丢字段**：`src/core/schema/template.ts` 里有没有声明该字段？Zod 默认丢弃未声明字段且**不报错**，缺少 `position` 等声明会直接导致渲染结果偏离模板语义
3. **核对字段语义**：查看数据结构定义、渲染实现和现有模板用例，确认字段在各层的处理一致
4. **数值断言代替视觉检查**：用 `@napi-rs/canvas` 的 `getImageData` 读像素值做断言。参考 `tests/core/render.test.ts` 的集成测试范式，或 `tests/scripts/` 下的脚本

模板字段中特别容易漏的语义：`reverse` 在 `renderAllFrames` 里影响展示/导出顺序；`hidden` 不进入 `index.json` 和模板选择器；`greedy` 无任何交互入口，仅做数据保真；`inRandomList` 可在模板编辑器中设置并随导出保留，但主应用没有随机池消费逻辑。

集成测试会把渲染结果写到 `tests/output/`，可直接看文件确认效果。
