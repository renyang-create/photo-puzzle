import { expect, test } from "@playwright/test";

/**
 * 关键流程 E2E：
 *   封面 → 开始挑战 → 切换难度 → 棋盘渲染正确块数 → 点击交换生效 → 相册墙锁定态
 *
 * 注意：这里不模拟「拼完」（需要真实重排到解），解锁链路由集成测试 + 手工验收覆盖；
 * 但会校验 3/4/5 三档难度可切换、data-index/data-slot 语义、触控区尺寸。
 */
test.describe("照片拼图解锁 · 移动端主流程", () => {
  test("封面可以进入拼图页并切换三种难度", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toContainText("解锁");

    await page.getByRole("link", { name: "开始挑战" }).click();
    await expect(page).toHaveURL(/\/play$/);

    for (const difficulty of [3, 4, 5] as const) {
      await page.getByTestId(`difficulty-${difficulty}`).click();
      const board = page.getByTestId("puzzle-board");
      await expect(board).toHaveAttribute("data-difficulty", String(difficulty));

      // 打乱动画结束后进入可交互状态
      await expect(board).toHaveAttribute("data-phase", /playing|solved/, {
        timeout: 20_000,
      });

      const pieces = board.locator("[data-index]");
      await expect(pieces).toHaveCount(difficulty * difficulty);

      // 每块最小触控区 44px
      const box = await pieces.first().boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    }
  });

  test("点击两块交换：槽位内容变化且不是已完成状态", async ({ page }) => {
    await page.goto("/play");
    const board = page.getByTestId("puzzle-board");
    await expect(board).toHaveAttribute("data-phase", "playing", {
      timeout: 20_000,
    });

    const pieces = board.locator("[data-index]");
    const before = await pieces.evaluateAll((nodes) =>
      nodes.map((node) => ({
        index: node.getAttribute("data-index"),
        slot: node.getAttribute("data-slot"),
      })),
    );
    expect(before.some((item) => item.index !== item.slot)).toBe(true);

    // 点第一块，再点第二块 → 两者 data-index 互换
    await pieces.nth(0).click();
    await pieces.nth(1).click();

    const after = await pieces.evaluateAll((nodes) =>
      nodes.map((node) => ({
        index: node.getAttribute("data-index"),
        slot: node.getAttribute("data-slot"),
      })),
    );
    const slot0 = after.find((item) => item.slot === "0");
    const slot1 = after.find((item) => item.slot === "1");
    expect(slot0?.index).toBe(before.find((item) => item.slot === "1")?.index);
    expect(slot1?.index).toBe(before.find((item) => item.slot === "0")?.index);
  });

  test("未解锁的相册项拿不到任何图片地址", async ({ page }) => {
    await page.goto("/gallery");

    const locked = page.locator('[data-testid^="gallery-locked-"]');
    if ((await locked.count()) > 0) {
      // 服务端对未解锁项不返回 URL，占位块里不应该有 <img>
      await expect(locked.first().locator("img")).toHaveCount(0);
    }
  });

  test("匿名 cookie 带 HttpOnly + SameSite=Lax", async ({ page, context }) => {
    await page.goto("/");
    const cookies = await context.cookies();
    const anon = cookies.find((cookie) => cookie.name === "pp_anon");
    expect(anon).toBeTruthy();
    expect(anon?.httpOnly).toBe(true);
    expect(anon?.sameSite).toBe("Lax");
    // secure 在 https 部署下为 true；本地 http 必须为 false 否则浏览器不写入
    expect(typeof anon?.secure).toBe("boolean");
  });

  test("管理 API 未登录一律 401", async ({ request }) => {
    const response = await request.post("/api/admin/photos/upload-url", {
      data: { fileName: "a.jpg", contentType: "image/jpeg", size: 1024 },
    });
    expect(response.status()).toBe(401);
  });
});
