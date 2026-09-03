# 更新日志

本项目所有显著变更都将记录在本文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Changed

- 升级 TypeScript 至 5.9、lucide-react 至 1.41
- 升级 @types/node 至 26.4.1、@types/react-dom 至 19.2.7
- 升级 CI 中的 docker/setup-qemu-action 至 4.3

### Removed

- 清理 .gitignore 中不再使用的模板遗留条目（dist-ssr、Playwright 认证目录等）

## [1.0.0] - 2026-09-07

首个正式版本：一款完全在浏览器中运行的表情包制作工具，所有图像处理均在本地完成，无需上传服务器。

### Added

- 模板库：浏览、搜索并按静态图 / 动图筛选模板
- 素材上传：支持图片、GIF、视频作为头像，一次可上传多个候选头像（供 RANDOM 槽位使用）
- 文字编辑：修改模板文字、颜色、字号，可隐藏不需要的文字
- 实时预览：静态图与 GIF 动画即时渲染，展示与导出效果一致
- 一键导出：下载 PNG / GIF，静态图可直接复制到剪贴板
- 模板编辑器（`/editor`）：上传背景、添加头像与文字图层、支持撤销/重做（Ctrl+Z / Ctrl+Shift+Z），可导出模板 ZIP
- 渲染引擎：纯 Canvas 2D 合成，内置 14 种图像滤镜（旋涡、凸出、模糊、油画、像素化等）与头像变形（缩放 / 透视）
- PWA：可安装到桌面，模板索引与内容寻址资产走运行时缓存
- 主题：浅色 / 暗色跟随系统，可手动切换
- 部署：构建产物为纯静态文件，提供 Dockerfile 与 docker-compose 配置

[1.0.0]: https://github.com/baoxinwen/meme-maker/releases/tag/v1.0.0
