# ============================================================
# 腾讯云 CloudBase 云托管（容器型）部署用镜像
#
# 为什么这么写：
#   1) 基础镜像用 node:22-slim（glibc）而不是 alpine（musl）：
#      sharp 0.35 的预编译二进制在 glibc 下最稳，alpine 需要 musl 变体，容易踩坑。
#   2) 单阶段构建：本项目用 pnpm，node_modules 里全是「相对软链 + .pnpm 内容仓库」，
#      跨阶段 COPY 容易出现软链失效；单阶段最稳（代价只是镜像大一点）。
#   3) 用 pnpm install --frozen-lockfile：保证容器里装的依赖和本地验证过的完全一致。
#   4) 必须监听 3000（云托管的端口约定），启动命令就是 next start。
#   5) 构建期需要 NEXT_PUBLIC_* 环境变量（Next 会把它们内联进前端产物），
#      所以请在 CloudBase 控制台**先配好环境变量再部署**，否则前端拿不到 Supabase 配置。
# ============================================================
FROM node:22-slim

# 注意：这里**不能**设 NODE_ENV=production，否则 pnpm 会跳过 devDependencies，
# 而 typescript / tailwindcss / @tailwindcss/turbopack 都在 devDependencies 里，
# 构建会直接失败。NODE_ENV 放到构建完成之后再设。
ENV PORT=3000 \
    NEXT_TELEMETRY_DISABLED=1 \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

# 用 npm 装 pnpm（比 corepack 少一层交互式确认，构建更不容易卡住）
RUN npm install -g pnpm@10.34.7 && pnpm --version

WORKDIR /app

# 先只拷依赖清单，最大化利用 Docker 层缓存
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# 再拷业务代码并构建
COPY . .
RUN pnpm build

# 构建完成后再切到生产模式
ENV NODE_ENV=production

EXPOSE 3000
CMD ["pnpm", "start"]
