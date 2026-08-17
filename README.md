# MemeMaker

一款完全在浏览器中运行的表情包制作工具。选择模板、上传头像、编辑文字，即可生成 PNG 或 GIF；图片处理均在本地完成，无需上传到服务器。

## 功能

- 浏览、搜索并按静态图或动图筛选模板
- 上传图片、GIF 或视频作为头像素材
- 支持一次上传多个候选头像（供声明 RANDOM 类型头像槽位的模板使用）
- 编辑模板文字、颜色和字号，并可隐藏不需要的文字
- 实时预览静态图与 GIF 动画
- 下载 PNG 或 GIF，静态图可直接复制到剪贴板
- 使用模板编辑器制作自定义模板并导出 ZIP
- 支持安装为 PWA，在浏览器中获得接近桌面应用的使用体验
- 浅色 / 暗色主题（跟随系统，可手动切换）
- 编辑器支持撤销/重做（Ctrl+Z / Ctrl+Shift+Z）

## 使用方法

1. 从左侧模板库（窄屏为底部抽屉）中选择需要的效果。
2. 根据提示上传头像素材；没有头像要求的模板会直接生成预览。
3. 按需修改文字、颜色和字号。
4. 在预览区确认效果后下载 PNG 或 GIF；静态图也可以直接复制。

模板编辑器位于 `/editor`，可以上传背景、添加头像和文字图层、预览效果并导出模板文件。

## 本地运行

需要 Node.js 20+ 和 pnpm 10+。

```bash
pnpm install
pnpm dev
```

开发服务器默认运行在 `http://localhost:5173`。

常用命令：

```bash
pnpm build       # 生产构建
pnpm test        # 单元与集成测试
pnpm test:e2e    # 浏览器端到端测试
pnpm lint        # 代码检查
pnpm check       # 完整质量检查
```

## 部署

项目构建后生成纯静态文件，可以部署到任意静态站点托管服务。

```bash
pnpm build
```

构建产物位于 `dist/`。也可以通过 Docker Compose 运行已发布的镜像：

```bash
docker compose pull
docker compose up -d
```

启动后访问 `http://localhost:8080`。如需在本地构建镜像，可运行
`docker build -t meme-maker .`。

## 许可证

项目源代码采用 [MIT License](./LICENSE)。模板图片和字体不属于 MIT 授权范围，
相关权利与使用说明见 [第三方资源声明](./THIRD_PARTY_NOTICES.md)。

> 说明：本仓库中的表情素材等均来自网络，如有侵权，请联系作者删除。
