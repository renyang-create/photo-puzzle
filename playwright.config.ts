import { defineConfig, devices } from "@playwright/test";

/**
 * 端到端测试（可选，但推荐）。
 *
 * 运行前置条件：
 *   1. .env.local 已配置好 Supabase（含 service role key）
 *   2. 已执行 supabase db push（建表 + RLS + storage policy）
 *   3. 照片池里至少有一张照片（否则 /play 会显示空池提示）
 *
 * 命令：
 *   pnpm exec playwright install chromium   # 首次
 *   pnpm test:e2e
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    // 移动端是主战场：默认用 iPhone 视口跑
    ...devices["iPhone 13"],
  },
  projects: [
    {
      name: "mobile-chromium",
      use: { ...devices["iPhone 13"], browserName: "chromium" },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "pnpm dev",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
