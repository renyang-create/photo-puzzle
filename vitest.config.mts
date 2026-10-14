import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    // 关键流程测试全部围绕「纯逻辑」：拼图打乱/胜负判定、本地记录、入参校验、
    // 浏览器端压缩尺寸计算、会话 JWT 签名隔离。它们不依赖浏览器，用 node 环境即可。
    environment: "node",
    include: ["tests/**/*.test.ts"],
    reporters: ["default"],
  },
});
