import { expect, test, type Page } from '@playwright/test';

const shot = (page: Page, name: string) => page.screenshot({ path: `e2e/shots/${name}.png` });
const cash = async (page: Page) => Number((await page.locator('[data-cash]').innerText()).replace(/[^0-9-]/g, ''));

async function playOrderGame(page: Page) {
  await expect(page.locator('[data-mini="order"]')).toBeVisible();
  for (let n = 1; n <= 4; n++) await page.locator(`[data-piece="${n}"]`).dispatchEvent('pointerdown');
  await expect(page.locator('[data-mini]')).toHaveCount(0, { timeout: 5000 });
}

test('スマホ縦画面で開いて、最初の仕事でお金が入り、再読み込みしても残る', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('[data-pick="craft"]')).toBeVisible();
  await shot(page, '01-pick');

  await page.locator('[data-pick="craft"]').click();
  await expect(page.locator('[data-act="accept"]').first()).toBeVisible();
  await page.waitForTimeout(600);
  await shot(page, '02-home');

  const before = await cash(page);
  await page.locator('[data-act="accept"]').first().click();
  await expect(page.locator('[data-mini="order"]')).toBeVisible();
  await shot(page, '03-mini');
  await playOrderGame(page);
  await expect(page.locator('[data-order="active"]')).toHaveCount(1);

  await page.locator('[data-adv="day"]').click();
  await expect.poll(() => cash(page)).toBeGreaterThan(before);
  await shot(page, '04-after-day');

  await page.reload();
  const state = await page.evaluate(() => window.__game!.state());
  expect(state.day).toBeGreaterThanOrEqual(1);
  expect(state.phase).toBe('play');
});

test('タブを切り替え、時間割を塗り、月末の締めまで進める', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); // 動きを少なくする設定（まとめて進める待ち時間がなくなる）
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator('[data-pick="handy"]').click();
  await page.locator('[data-tabbtn="money"]').click();
  await page.locator('[data-auto]').click(); // 手でやる操作はおまかせ
  await shot(page, '05-money');

  await page.locator('[data-tabbtn="work"]').click();
  await expect(page.locator('[data-biz="handy"]')).toBeVisible();
  await shot(page, '06-work');

  await page.locator('[data-tabbtn="plan"]').click();
  await page.locator('[data-brush="sell"]').click();
  await page.locator('[data-cell="holiday-10"]').click();
  await page.locator('[data-cell="holiday-11"]').click();
  const st = await page.evaluate(() => window.__game!.state());
  expect(st.templates.holiday[10]).toBe('sell');
  await shot(page, '07-plan');

  await page.locator('[data-tabbtn="people"]').click();
  await page.locator('[data-hire]').first().click();
  await expect(page.locator('[data-helper]')).toHaveCount(1);
  await shot(page, '08-people');

  await page.locator('[data-tabbtn="home"]').click();
  for (let i = 0; i < 80; i++) {
    if (await page.locator('[data-monthend]').count()) break;
    const accept = page.locator('[data-act="accept"]').first();
    if (await accept.count()) await accept.click();
    else await page.locator('[data-adv="month"]').click();
  }
  await expect(page.locator('[data-monthend]')).toBeVisible();
  await page.waitForTimeout(300);
  await shot(page, '09-monthend');
  await page.locator('[data-next]').click();
  await expect(page.locator('[data-monthend]')).toHaveCount(0);
  const after = await page.evaluate(() => window.__game!.state());
  expect(after.reports.length).toBe(1);
  expect(after.day).toBe(30);
  await shot(page, '10-month2');
});

test('個人開発：手でやる操作（タップ）で作品を始められる', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator('[data-pick="dev"]').click();
  await page.locator('[data-adv="day"]').click();
  await page.locator('[data-tabbtn="work"]').click();
  await page.locator('[data-start="small"]').click();
  await expect(page.locator('[data-mini="tap"]')).toBeVisible();
  await page.waitForTimeout(250);
  await shot(page, '11-mini-tap');
  for (let i = 0; i < 3; i++) {
    await page.locator('[data-tap]').dispatchEvent('pointerdown');
    await page.waitForTimeout(120);
  }
  await expect(page.locator('[data-mini]')).toHaveCount(0, { timeout: 5000 });
  const st = await page.evaluate(() => window.__game!.state());
  expect(st.project).not.toBeNull();
  await page.locator('[data-tabbtn="home"]').click();
  await shot(page, '12-dev-home');
});

test('1週：1日ずつ進み、途中で止められる。街の絵は夜にも切り替わる', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await shot(page, '13-title');
  await page.locator('[data-pick="dev"]').click();
  await page.locator('[data-adv="day"]').click();
  await page.waitForTimeout(1050); // 1日を通して見せている途中（夕方〜夜）
  await shot(page, '14-dusk');
  await page.waitForTimeout(1200);
  await page.locator('[data-adv="week"]').click();
  await expect(page.locator('[data-adv="stop"]')).toBeVisible();
  await shot(page, '15-running');
  await page.locator('[data-adv="stop"]').click();
  await expect(page.locator('[data-adv="day"]')).toBeVisible();
  const st = await page.evaluate(() => window.__game!.state());
  expect(st.day).toBeGreaterThanOrEqual(2);
  expect(st.day).toBeLessThan(9);
  // 音と動きの設定を切り替えられる
  await page.locator('[data-tabbtn="money"]').click();
  await page.locator('[data-sound="off"]').click();
  await page.locator('[data-calm="on"]').click();
  await page.reload();
  await page.locator('[data-tabbtn="money"]').click();
  await expect(page.locator('[data-calm="on"]')).toHaveClass(/on/);
  await expect(page.locator('[data-sound="off"]')).toHaveClass(/on/);
});
