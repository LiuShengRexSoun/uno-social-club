import { test, expect, type Page } from "@playwright/test";

async function ready(page: Page) {
  await page.goto("/");
  await expect(page.locator(".game-app")).toBeVisible();
  await expect(page.locator(".playing-card")).toHaveCount(7);
  await expect(
    page.getByRole("button", { name: "打开菜单", exact: true }),
  ).toBeVisible();
}
async function expectFullCards(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const box = document
          .querySelector(".hand-scroll")!
          .getBoundingClientRect();
        return [...document.querySelectorAll(".playing-card")].every(
          (el) => el.getBoundingClientRect().bottom <= box.bottom + 2,
        );
      }),
    )
    .toBe(true);
}
async function menu(page: Page, item: string) {
  await page.getByRole("button", { name: "打开菜单", exact: true }).click();
  await page.getByRole("button", { name: item, exact: false }).click();
}

test("fullscreen desktop: game-first layout, legal play and secondary house-rule menu", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await ready(page);
  await expect(
    page.locator("header,footer,.rail,.intro,.side-panel"),
  ).toHaveCount(0);
  await expect(page.locator(".game-stage canvas")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight === innerHeight,
    ),
  ).toBe(true);
  for (
    let n = 0;
    n < 5 && (await page.locator(".hand-slot.playable").count()) === 0;
    n++
  )
    await menu(page, "开始新一局");
  const card = page.locator(".hand-slot.playable .playing-card").first();
  const label = await card.getAttribute("aria-label");
  await card.click();
  await expect(card).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "出牌", exact: true }).click();
  if (label?.includes("万能"))
    await page.getByRole("button", { name: "红色", exact: true }).click();
  await expect(page.locator(".playing-card")).toHaveCount(6);
  await menu(page, "自定义村规");
  await page.getByRole("button", { name: "欢乐混战", exact: true }).click();
  await expect(page.getByRole("switch", { name: "同牌抢出" })).toBeChecked();
  await page.getByRole("button", { name: "按这个规则开一局" }).click();
  await expect(page.locator(".hud-mode")).toContainText("自定义村规");
  await expectFullCards(page);
  await page.screenshot({ path: "runs/2026111020/fullscreen-desktop.png" });
  expect(errors).toEqual([]);
});

test("fullscreen mobile: fixed viewport, hand controls and menus in portrait/landscape", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  expect(
    await page.evaluate(() => ({
      x: document.documentElement.scrollWidth <= innerWidth,
      y: document.documentElement.scrollHeight === innerHeight,
    })),
  ).toEqual({ x: true, y: true });
  const bounds = await page.locator(".game-hand").boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(845);
  await expect(
    page.getByRole("button", { name: "出牌", exact: true }),
  ).toBeVisible();
  await menu(page, "音效与画面");
  await page.getByRole("switch", { name: "减少动态效果" }).click();
  await expect(
    page.getByRole("switch", { name: "减少动态效果" }),
  ).toBeChecked();
  await page.getByRole("button", { name: "关闭弹窗" }).click();
  await expectFullCards(page);
  await page.screenshot({ path: "runs/2026111020/fullscreen-mobile.png" });
  await page.setViewportSize({ width: 844, height: 390 });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <= innerWidth &&
        document.documentElement.scrollHeight === innerHeight,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "打开菜单", exact: true }),
  ).toBeVisible();
  const landscape = await page.locator(".game-hand").boundingBox();
  expect(landscape!.y + landscape!.height).toBeLessThanOrEqual(391);
  await expectFullCards(page);
  await page.screenshot({ path: "runs/2026111020/fullscreen-landscape.png" });
  expect(errors).toEqual([]);
});

test("static local profiles: create/select/reload without a backend", async ({
  page,
}) => {
  const errors: string[] = [];
  const apiCalls: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (/\/(api|socket.io)(\/|\?)/.test(r.url())) apiCalls.push(r.url());
  });
  await ready(page);
  await menu(page, "玩家与战绩");
  await expect(
    page.getByText("线上相聚，稍后开启。", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("input[type=password]")).toHaveCount(0);
  await page.locator("input[name=nickname]").fill("白焰");
  await page.getByRole("button", { name: "创建本地玩家", exact: true }).click();
  await expect(page.locator(".online-identity b")).toHaveText("白焰");
  await page.getByRole("button", { name: "关闭弹窗" }).click();
  await page.reload();
  await expect(page.locator(".you-profile")).toContainText("白焰");
  await menu(page, "玩家与战绩");
  await page.locator("input[name=nickname]").fill("阿尔菲");
  await page.getByRole("button", { name: "创建本地玩家", exact: true }).click();
  await expect(
    page.locator('.saved-profiles button[aria-label^="删除玩家"]'),
  ).toHaveCount(2);
  await page
    .locator(".saved-profiles")
    .getByRole("button", { name: /白焰.*选择入座/ })
    .click();
  await expect(page.locator(".online-identity b")).toHaveText("白焰");
  expect(errors).toEqual([]);
  expect(apiCalls).toEqual([]);
});
