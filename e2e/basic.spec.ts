import { expect, test, type Page } from '@playwright/test';

const shot = (page: Page, name: string) => page.screenshot({ path: `e2e/shots/${name}.png` });
const state = (page: Page) => page.evaluate(() => window.__game!.state());
const goTo = async (page: Page, kind: string) => {
  await page.evaluate((k) => {
    const p = window.__game!.poi(k)!;
    window.__game!.tp(p.x, p.y + 2);
  }, kind);
  await page.waitForTimeout(350);
};
const fresh = async (page: Page) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('[data-title]')).toBeVisible();
};

test('題名から始めて、広い街を歩ける。地図で道案内を出せる', async ({ page }) => {
  await fresh(page);
  await shot(page, '01-title');
  await page.locator('[data-start="new"]').click();
  await expect(page.locator('[data-stage] canvas')).toBeVisible();
  await page.waitForTimeout(1200);
  await shot(page, '02-start');
  const a = await state(page);
  await page.keyboard.down('ArrowDown');
  await page.waitForTimeout(1500);
  await page.keyboard.up('ArrowDown');
  const c = await state(page);
  expect(Math.hypot(c.x - a.x, c.y - a.y)).toBeGreaterThan(4);
  await shot(page, '03-walk');
  await page.locator('[data-minimap]').click();
  await expect(page.locator('[data-bigmap]')).toBeVisible();
  await page.locator('[data-mapcanvas]').click({ position: { x: 200, y: 120 } });
  await expect(page.locator('[data-noway]')).toBeVisible();
  await page.waitForTimeout(300);
  await shot(page, '04-bigmap');
  await page.locator('[data-bigmap] [data-close]').click();
  await page.waitForTimeout(600);
  await shot(page, '05-route');
});

test('はたらいてお金を得て、自転車を買って乗る。再読み込みしても残る', async ({ page }) => {
  await fresh(page);
  await page.locator('[data-start="new"]').click();
  await goTo(page, 'conbini');
  await page.locator('[data-ctx="poi"]').click();
  await expect(page.locator('[data-panel="conbini"]')).toBeVisible();
  await shot(page, '06-panel');
  await page.locator('[data-act="work"]').click();
  await expect.poll(async () => (await state(page)).cash).toBe(34400);
  await goTo(page, 'bike');
  await page.locator('[data-ctx="poi"]').click();
  await page.locator('[data-act="buyBike"]').click();
  await page.locator('[data-panel] [data-close]').click();
  await expect(page.locator('[data-ctx="ride"]')).toBeVisible();
  await page.locator('[data-ctx="ride"]').click();
  await expect(page.locator('[data-app]')).toHaveAttribute('data-ride', 'bike');
  const a = await state(page);
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(1800);
  await shot(page, '07-bike');
  await page.keyboard.up('ArrowRight');
  const c = await state(page);
  expect(Math.hypot(c.x - a.x, c.y - a.y)).toBeGreaterThan(6);
  await page.waitForTimeout(4500);
  await page.reload();
  await page.locator('[data-start="continue"]').click();
  const d = await state(page);
  expect(d.cash).toBe(34400 - 18000);
  expect(d.mine).not.toBeNull();
});

test('強盗すると手配され、動かなければ捕まる', async ({ page }) => {
  test.setTimeout(120000);
  await fresh(page);
  await page.locator('[data-start="new"]').click();
  await goTo(page, 'bank');
  await page.locator('[data-ctx="poi"]').click();
  await page.locator('[data-act="rob"]').click();
  await expect(page.locator('[data-stars]')).toBeVisible();
  expect((await state(page)).dirty).toBeGreaterThan(300000);
  await page.waitForTimeout(2500);
  await shot(page, '08-wanted');
  await expect(page.locator('[data-busted]')).toBeVisible({ timeout: 90000 });
  await shot(page, '09-busted');
  await page.locator('[data-ok]').click();
  const s = await state(page);
  expect(s.dirty).toBe(0);
  expect(s.heat).toBe(0);
});
