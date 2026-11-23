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
// 中に入り、行動できる場所（番号）へ動いて、右下のボタンを押す
const enter = async (page: Page) => {
  await page.locator('[data-ctx="poi"]').click();
  await expect(page.locator('[data-inside]')).toBeVisible();
};
const use = async (page: Page, spot: number) => {
  await page.evaluate((i) => window.__game!.spot(i), spot);
  await page.locator('[data-ctx="spot"]').click();
};
// 強盗の行動（脅す・扉・金庫など）の場所へ動いて、ボタンを押す
const go = async (page: Page, h: string, n?: number) => {
  const i = await page.evaluate(([hh, nn]) => window.__game!.go(hh as string, nn as number | undefined), [h, n] as const);
  expect(i).toBeGreaterThanOrEqual(0);
  await page.waitForTimeout(250);
  await page.locator('[data-ctx="spot"]').click();
};
// 出口へ動いて、外へ出る
const out = async (page: Page) => {
  await page.evaluate(() => window.__game!.exit());
  await page.waitForTimeout(250);
  await page.locator('[data-ctx="spot"]').click();
  await expect(page.locator('[data-inside]')).toHaveCount(0);
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
  await enter(page);
  await page.waitForTimeout(900);
  await shot(page, '06-inside-conbini');
  await use(page, 0);
  await expect.poll(async () => (await state(page)).cash).toBe(34400);
  await out(page);
  await goTo(page, 'bike');
  await enter(page);
  await use(page, 0);
  await page.waitForTimeout(600);
  await shot(page, '06b-inside-bike');
  await out(page);
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

test('銀行・昼：入り方を選び、店員を脅して鍵を出させ、金庫をドリルで破る。動かなければ捕まる', async ({ page }) => {
  test.setTimeout(240000);
  await fresh(page);
  await page.locator('[data-start="new"]').click();
  await page.evaluate(() => {
    window.__game!.clock(10);
    window.__game!.give('gun');
    window.__game!.give('drill');
  });
  await goTo(page, 'bank');
  await page.locator('[data-ctx="poi"]').click();
  await expect(page.locator('[data-routes="bank"]')).toBeVisible();
  await shot(page, '07a-routes');
  await expect(page.locator('[data-route="back"]')).toBeDisabled();
  await page.locator('[data-route="front"]').click();
  await expect(page.locator('[data-inside]')).toBeVisible();
  await page.waitForTimeout(1200);
  await shot(page, '07b-bank-lobby');
  await use(page, 0);
  await expect(page.locator('[data-panel="bank"]')).toBeVisible();
  await page.locator('[data-panel] [data-close]').click();
  await go(page, 'threat');
  await expect(page.locator('[data-alarm]')).toBeVisible();
  await page.waitForTimeout(400);
  await shot(page, '07c-holdup');
  await go(page, 'key');
  await go(page, 'door', 0);
  await go(page, 'door', 1);
  await go(page, 'vault');
  await expect(page.locator('[data-drill]')).toBeVisible();
  await page.waitForTimeout(600);
  await shot(page, '07d-drill');
  await expect.poll(async () => (await state(page)).dirty, { timeout: 90000 }).toBeGreaterThan(300000);
  await shot(page, '07e-vault-open');
  await out(page);
  await expect(page.locator('[data-stars]')).toBeVisible();
  await page.waitForTimeout(2500);
  await shot(page, '08-wanted');
  await expect(page.locator('[data-busted]')).toBeVisible({ timeout: 120000 });
  await shot(page, '09-busted');
  await page.locator('[data-ok]').click();
  const s = await state(page);
  expect(s.dirty).toBe(0);
  expect(s.heat).toBe(0);
});

test('宝石店・夜：裏口からピッキングで入り、監視カメラを止めて、金庫とショーケースを静かに開ける。コンビニは銃で脅す', async ({ page }) => {
  test.setTimeout(240000);
  await fresh(page);
  await page.locator('[data-start="new"]').click();
  await page.evaluate(() => {
    window.__game!.clock(2);
    for (const t of ['laptop', 'gun', 'money']) window.__game!.give(t);
  });
  // ピッキング道具とドリルは、道具屋で買う
  await goTo(page, 'tool');
  await enter(page);
  await use(page, 0);
  await expect(page.locator('[data-panel="tool"]')).toBeVisible();
  await shot(page, '14-0-tool-shop');
  await page.locator('[data-act="lockpick"]').click();
  await page.locator('[data-act="drill"]').click();
  await expect(page.locator('[data-act="drill"]')).toBeDisabled();
  await page.locator('[data-panel] [data-close]').click();
  await out(page);
  await goTo(page, 'jewel');
  await page.waitForTimeout(600);
  await shot(page, '14-jewel-outside-night');
  await page.locator('[data-ctx="poi"]').click();
  await expect(page.locator('[data-routes="jewel"]')).toBeVisible();
  await shot(page, '14a-jewel-routes');
  await page.locator('[data-route="back"]').click();
  await expect(page.locator('[data-mini="pick"]')).toBeVisible();
  await shot(page, '14b-pick');
  await page.evaluate(() => window.__game!.mini(3));
  await expect(page.locator('[data-inside]')).toBeVisible();
  await page.waitForTimeout(1500);
  await shot(page, '14c-jewel-back-room');
  expect((await page.evaluate(() => window.__game!.ins()))!.alarm).toBe(-1);
  await go(page, 'panel');
  await expect(page.locator('[data-mini="cam"]')).toBeVisible();
  await page.evaluate(() => window.__game!.mini(3));
  await expect.poll(async () => (await page.evaluate(() => window.__game!.ins()))!.camsOff).toBe(true);
  await go(page, 'vault');
  await expect(page.locator('[data-drill]')).toBeVisible();
  await page.waitForTimeout(500);
  await shot(page, '14d-jewel-drill');
  await expect.poll(async () => (await state(page)).dirty, { timeout: 90000 }).toBeGreaterThan(100000);
  await go(page, 'desk');
  await go(page, 'door', 0);
  await go(page, 'case', 0);
  await page.waitForTimeout(500);
  await shot(page, '14e-jewel-showroom');
  expect((await state(page)).loot).toBeGreaterThan(0);
  expect((await page.evaluate(() => window.__game!.ins()))!.alarm).toBe(-1);
  await out(page);
  await expect(page.locator('[data-stars]')).toHaveCount(0);
  // コンビニ：昼も夜も店員がいる。銃で脅すと、レジの金を出す
  const before = (await state(page)).dirty;
  await goTo(page, 'conbini');
  await enter(page);
  await go(page, 'threat');
  await go(page, 'till');
  await page.waitForTimeout(500);
  await shot(page, '15-conbini-holdup');
  expect((await state(page)).dirty).toBeGreaterThan(before);
  await out(page);
  await page.locator('[data-minimap]').click();
  await expect(page.locator('[data-tools]')).toBeVisible();
  await page.waitForTimeout(400);
  await shot(page, '16-map-tools');
});

test('家に入って寝る。留守の家で盗む。敵の見張りと撃ち合う', async ({ page }) => {
  test.setTimeout(120000);
  await fresh(page);
  await page.locator('[data-start="new"]').click();
  await enter(page);
  await page.waitForTimeout(700);
  await shot(page, '10-inside-home');
  const day = (await state(page)).clock;
  await use(page, 0);
  await expect(page.locator('[data-act="nap"]')).toBeVisible();
  await page.locator('[data-act="sleep"]').click();
  await expect.poll(async () => (await state(page)).clock).toBeGreaterThan(day + 600);
  await out(page);
  // 留守の家：バールを持って、こじ開けて入る
  await page.evaluate(() => window.__game!.give('crowbar'));
  await goTo(page, 'house');
  await page.locator('[data-ctx="poi"]').click();
  await expect(page.locator('[data-mini="break"]')).toBeVisible();
  for (let i = 0; i < 3; i++) await page.locator('[data-mini]').click();
  await expect(page.locator('[data-inside]')).toBeVisible();
  await expect(page.locator('[data-alarm]')).toBeVisible();
  await use(page, 0);
  await page.waitForTimeout(500);
  await shot(page, '11-inside-house');
  expect((await state(page)).loot).toBeGreaterThan(0);
  await out(page);
  // 敵のアジト：銃で見張りと撃ち合う
  await page.evaluate(() => {
    window.__game!.give('gun');
    window.__game!.give('hp');
    const p = window.__game!.poi('gang')!;
    window.__game!.tp(p.x, p.y + 45);
  });
  await page.waitForTimeout(1500);
  await shot(page, '12a-guards-warning');
  await expect(page.locator('[data-ctx="fire"]')).toBeVisible();
  for (let i = 0; i < 6; i++) {
    await page.locator('[data-ctx="fire"]').click();
    await page.waitForTimeout(420);
  }
  await shot(page, '12-gunfight');
  expect((await state(page)).heat).toBeGreaterThan(0);
  await page.locator('[data-minimap]').click();
  await page.waitForTimeout(400);
  await shot(page, '13-turf-map');
  await page.locator('[data-bigmap] [data-close]').click();
  // 倒されると、失った物が出て、自宅で目を覚ます
  await page.evaluate(() => window.__game!.give('down'));
  await expect(page.locator('[data-down]')).toBeVisible();
  await shot(page, '13b-down');
  await page.locator('[data-down] [data-ok]').click();
  await expect(page.locator('[data-down]')).toHaveCount(0);
});

test('ほかの人と一緒に遊ぶ：同じページを開いている人が街に見える。つながらない所では 1人用のまま', async ({ page }) => {
  // claude.ai のページの「room」を、にせ物で置きかえる（相手が1人、自宅の近くにいる）
  await page.addInitScript(() => {
    const w = window as unknown as { claude: unknown; __sent: unknown[]; __push: (p: unknown) => void };
    w.__sent = [];
    let handler: (c: { peers: unknown[] }) => void = () => {};
    w.__push = (presence) => handler({ peers: [{ peer: 'me', isMe: true, sameTab: true, kind: 'viewer', presence: {} }, { peer: 'friend-1', isMe: false, sameTab: false, kind: 'viewer', presence }] });
    w.claude = {
      use: async (name: string) => (name === 'room' ? { presence: async (p: unknown) => void w.__sent.push(p), onPeers: (h: typeof handler) => ((handler = h), () => {}) } : null),
    };
  });
  await fresh(page);
  await page.locator('[data-start="new"]').click();
  const a = await state(page);
  await page.evaluate(([x, y]) => (window as unknown as { __push: (p: unknown) => void }).__push({ g: 1, x: x + 14, y: y + 6, a: 0.6, r: 0, s: 2, t: 1, i: 0, h: 70 }), [a.x, a.y]);
  await expect(page.locator('[data-mates="1"]')).toBeVisible();
  await page.waitForTimeout(700);
  await shot(page, '17-online');
  const sent = await page.evaluate(() => (window as unknown as { __sent: { g: number; x: number }[] }).__sent);
  expect(sent.length).toBeGreaterThan(0);
  expect(sent.at(-1)!.g).toBe(1);
  expect(Math.abs(sent.at(-1)!.x - a.x)).toBeLessThan(2);
});

test('月末の締め：3日目の終わりに月次レポートが出る。銀行の窓口で、融資の条件が見える', async ({ page }) => {
  await fresh(page);
  await page.locator('[data-start="new"]').click();
  // 自宅で3回寝ると、1か月（3日）が終わる
  await enter(page);
  for (let d = 0; d < 3; d++) {
    await use(page, 0);
    await page.locator('[data-act="sleep"]').click();
    await page.waitForTimeout(500);
  }
  await expect(page.locator('[data-report]')).toBeVisible();
  await page.waitForTimeout(500);
  await shot(page, '18-month-report');
  await page.locator('[data-report] [data-ok]').click();
  expect((await state(page)).cash).toBe(30000 - 3500 * 3);
  await out(page);
  await page.evaluate(() => window.__game!.clock(10));
  await goTo(page, 'bank');
  await page.locator('[data-ctx="poi"]').click();
  await page.locator('[data-route="front"]').click();
  await use(page, 0);
  await page.locator('[data-act="loan"]').click();
  await expect(page.locator('[data-loan]')).toBeVisible();
  await expect(page.locator('[data-offer="start"] li.ng')).toHaveCount(2);
  await page.waitForTimeout(300);
  await shot(page, '19-loan');
});

