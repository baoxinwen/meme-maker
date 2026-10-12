# MemeMaker Dockerfile —— 多阶段构建。
#
# 阶段 1（builder）：ECR node:26.8.1-alpine3.23（digest 固定）安装依赖、构建 dist/
# 阶段 2（runtime）：ECR nginx:1.31.4-alpine3.24（digest 固定）提供静态服务
#
# 本地构建：docker build -t meme-maker .
# CI 构建：GitHub Actions workflow（.github/workflows/docker.yml）推到 GHCR
#
# 最终镜像约 30MB（nginx:alpine + dist 静态文件）。

# ---- 阶段 1：构建 ----
FROM public.ecr.aws/docker/library/node:26.11.1-alpine3.23@sha256:f1394b3ffc021bc3f4aaf363e70a8d9667f7a9a63538bc824d7cc583129fffad AS builder

WORKDIR /app

# 启用 pnpm（node 26 不再内置 corepack，先安装再启用，读取 packageManager 字段）
RUN npm install -g corepack && corepack enable

# 先拷依赖清单，利用 Docker 层缓存（代码改动不会重装依赖）
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# 再拷源码构建
COPY . .
RUN pnpm build

# ---- 阶段 2：运行 ----
FROM public.ecr.aws/docker/library/nginx:1.31.5-alpine3.24@sha256:72ba65eb42c10344912a84ff42408db7d34f2feb642204570ab8fc5ffd29f1d3 AS runtime

# 拷 nginx 站点配置（SPA fallback、缓存策略）
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 拷构建产物
COPY --from=builder /app/dist /usr/share/nginx/html

# nginx 默认 80 端口
EXPOSE 80

# 健康检查：站点根能返回 200
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost/ >/dev/null 2>&1 || exit 1
