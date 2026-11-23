import { describe, expect, it } from 'vitest';
import { makeCity } from '../src/core/city';
import { applyCount, apartFill, apartIncome, arriveRate, askOne, makeStaff, newFirm, newShop, openConds, seen, serve } from '../src/core/shop';
import { apply, createGame, fromSave, fuzz, poiActions, rank, toSave } from '../src/core/sim';
import { balance as b } from '../src/data/schema';

const city = makeCity(20261123, b);
const S = b.shop;
type G = ReturnType<typeof createGame>;
const lot = city.pois.find((p) => p.kind === 'lot')!;
const go = (s: G, p: { x: number; y: number; id: number }, a: string) => {
  s.x = p.x;
  s.y = p.y;
  return apply(s, city, { type: 'poi', id: p.id, act: a }, b);
};
const kind = (k: string) => city.pois.find((p) => p.kind === k)!;
const monthEnd = (s: G) => {
  const out = [];
  const n = s.eco.hist.length;
  for (let i = 0; i < 9 && s.eco.hist.length === n; i++) out.push(...go(s, city.home, 'sleep'));
  return out;
};
const rng = (seed = 1) => {
  let x = seed;
  return () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296;
};

describe('来店型の店', () => {
  it('客数 ＝ 前を通る人 × 気づく割合 × 入る割合。さばけない分は帰り、評判が下がる', () => {
    const z = newShop('stall', lot.id, 0, 0, 0, b);
    expect(z.aware).toBe(S.awareStart);
    z.aware = 50;
    // 1時間に 70人 が通り、半分が気づき、10% が入る
    expect(arriveRate(z, 1, b)).toBeCloseTo(3.5);
    z.price = 1.25;
    expect(arriveRate(z, 1, b)).toBeCloseTo(2.8); // 値段が高いと入る人が減る
    z.price = 1;
    z.repute = 100;
    expect(arriveRate(z, 2, b)).toBeCloseTo(14); // 評判と人通りで増える
    const ok = serve(z, 4, [{ cap: 20, service: 80 }], 2, 1, b);
    expect([ok.cust, ok.lost]).toEqual([56, 0]);
    expect(ok.sales).toBe(56 * S.stallUnit);
    expect(ok.cost).toBe(Math.round(56 * S.stallUnit * S.stallCost));
    z.repute = 60;
    const before = z.repute;
    const busy = serve(z, 4, [{ cap: 2, service: 80 }], 2, 1, b); // 手が足りない
    expect(busy.cust).toBe(8);
    expect(busy.lost).toBeGreaterThan(20);
    expect(z.repute).toBeLessThan(before);
  });
  it('屋台は講習が要る。店は保証金が要り、信用が E だと 10か月分になる', () => {
    const firm = newFirm();
    expect(openConds('stall', 1, 0, 1e9, firm, b).conds[0].ok).toBe(false);
    firm.permits.push('food');
    expect(openConds('stall', 1, 0, 1e9, firm, b).conds.every((c) => c.ok)).toBe(true);
    const e = openConds('shop', 1, 0, 1e9, firm, b);
    const d = openConds('shop', 1, 1, 1e9, firm, b);
    expect(e.deposit).toBe(S.shopRent * b.time.daysPerMonth * S.depositMonthsE);
    expect(d.deposit).toBe(S.shopRent * b.time.daysPerMonth * S.depositMonths);
    expect(openConds('shop', 1, 1, d.deposit, firm, b).conds.every((c) => c.ok)).toBe(false);
  });
  it('街の中で：講習→屋台を出す→店に立つと、その場で売上が入る。値段と広告で客が変わる', () => {
    const s = createGame(7, city, b);
    s.cash = 400000;
    s.clock = 10 * 60;
    expect(poiActions(s, city, lot, b).find((a) => a.id === 'stall')!.ok).toBe(false);
    go(s, kind('office'), 'lecture');
    expect(s.firm.permits).toContain('food');
    s.clock = Math.floor(s.clock / 1440 + 1) * 1440 + 10 * 60;
    go(s, lot, 'stall');
    expect(s.biz.length).toBe(1);
    expect(rank(s)).toBe('個人事業主');
    const z = s.biz[0];
    go(s, lot, 'ad');
    go(s, lot, 'ad');
    expect(z.aware).toBe(S.awareStart + S.adGain * 2);
    const cash = s.cash;
    go(s, lot, 'tend');
    expect(s.cash).toBeGreaterThan(cash);
    expect(z.m.cust).toBeGreaterThan(0);
    expect(s.eco.know.food).toBeGreaterThan(0);
    go(s, lot, 'priceUp');
    expect(z.price).toBe(1.1);
    const [lo, hi] = fuzz(100, 0);
    expect([lo, hi]).toEqual([75, 125]); // 知識がないと、数字は ±25% の幅で見える
    go(s, lot, 'closeShop');
    expect(s.biz.length).toBe(0);
  });
});

describe('人', () => {
  it('応募の数 ＝ 探している人 × 届く割合 ×（日給 ÷ 相場）の2乗。相場より低いと5分の1', () => {
    const m = b.staff.market;
    expect(applyCount({ site: false, wage: m }, b)).toBe(4);
    expect(applyCount({ site: true, wage: m }, b)).toBe(6); // 上限 6人
    expect(applyCount({ site: false, wage: m * 0.9 }, b)).toBe(1);
    expect(applyCount({ site: false, wage: m * 1.2 }, b)).toBe(6);
  });
  it('面接の質問は3つ。1つで ±10、同じ項目に2つで ±3 の幅で見え、聞かない項目は見えない。幅は本当の値を含む', () => {
    const firm = newFirm();
    const r = rng(5);
    for (let i = 1; i <= 30; i++) firm.pool.push(makeStaff(i, r, b));
    for (const p of firm.pool) {
      expect(seen(p, 0)).toBeNull();
      expect(askOne(firm, p.id, 0)).toBe(true);
      const a = seen(p, 0)!;
      expect(a[0] <= p.skill && p.skill <= a[1] && a[1] - a[0] <= 20).toBe(true);
      expect(askOne(firm, p.id, 0)).toBe(true);
      const c = seen(p, 0)!;
      expect(c[0] <= p.skill && p.skill <= c[1] && c[1] - c[0] <= 6).toBe(true);
      expect(askOne(firm, p.id, 2)).toBe(true);
      expect(askOne(firm, p.id, 1)).toBe(false); // 4つ目は聞けない
      expect(seen(p, 1)).toBeNull();
    }
  });
  it('街の中で：求人→月の初めに応募→雇う→店が人で回る→月末に給料と家賃を払う。不満がたまると辞める', () => {
    const s = createGame(7, city, b);
    s.cash = 3000000;
    s.eco.credit = 250;
    s.clock = 10 * 60;
    go(s, lot, 'shop');
    const z = s.biz[0];
    expect(z.deposit).toBeGreaterThan(0);
    z.aware = 80;
    go(s, kind('office'), 'postSite');
    monthEnd(s);
    expect(s.firm.pool.length).toBe(6);
    const pick = s.firm.pool[0];
    apply(s, city, { type: 'staff', id: pick.id, act: 'ask', k: 1 }, b);
    expect(seen(pick, 1)).not.toBeNull();
    apply(s, city, { type: 'staff', id: pick.id, act: 'hire' }, b);
    expect(s.firm.staff[0].at).toBe(lot.id); // 店が1つなら、そこに入る
    go(s, kind('office'), 'postOff');
    const ev = monthEnd(s);
    const rec = ev.find((e) => e.type === 'month');
    expect(rec && rec.type === 'month' && rec.rec.wage).toBe(pick.wage * b.time.daysPerMonth);
    expect(rec && rec.type === 'month' && rec.rec.rent).toBe(z.rent * b.time.daysPerMonth);
    expect(rec && rec.type === 'month' && rec.rec.sales).toBeGreaterThan(0);
    expect(pick.see).toEqual([3, 3, 3]); // 1か月働くと、数字がすべて見える
    // 見ていない日は、店の回りが落ちる。店長に任せると、まとめる力しだい
    expect(poiActions(s, city, lot, b).find((a) => a.id === 'manage')!.ok).toBe(true);
    apply(s, city, { type: 'staff', id: pick.id, act: 'boss' }, b);
    expect(z.boss).toBe(pick.id);
    expect(poiActions(s, city, lot, b).find((a) => a.id === 'manage')!.ok).toBe(false);
    // 不満：80 を超えた翌月末に辞める。面談で下がる
    pick.mood = 85;
    apply(s, city, { type: 'staff', id: pick.id, act: 'talk' }, b);
    expect(pick.mood).toBe(85 - b.staff.talk);
    pick.mood = 85;
    const ev2 = monthEnd(s);
    expect(s.firm.staff.length).toBe(0);
    expect(z.boss).toBe(0);
    const rec2 = ev2.find((e) => e.type === 'month');
    expect(rec2 && rec2.type === 'month' && rec2.rec.notes.some((t) => t.includes('辞めた'))).toBe(true);
    const t = fromSave(JSON.parse(JSON.stringify(toSave(s))), city, b);
    expect(t.biz).toEqual(s.biz);
    expect(t.firm).toEqual(s.firm);
  });
});

describe('資産型（アパート）', () => {
  it('月の収入 ＝ 単価 × 埋まっている割合 − 維持費。家賃を上げると埋まりが減り、傷むと減る', () => {
    const a = { poi: 0, rent: 1, state: 1, paid: 3000000 };
    const full = apartFill(a, 1.5);
    expect(full).toBe(1);
    expect(apartIncome(a, 1.5, b)).toBe(b.apart.rooms * b.apart.unit - b.apart.upkeep);
    expect(apartFill({ ...a, rent: 1.4 }, 1)).toBeLessThan(apartFill(a, 1));
    expect(apartFill({ ...a, state: 0.6 }, 1)).toBeLessThan(apartFill(a, 1));
  });
  it('街の中で：買うと、月末に家賃が入る', () => {
    const s = createGame(7, city, b);
    const ap = kind('apart');
    s.bank = 5000000;
    go(s, ap, 'buyApart');
    expect(s.firm.aparts.length).toBe(1);
    const bank = s.bank;
    const ev = monthEnd(s);
    const rec = ev.find((e) => e.type === 'month');
    expect(rec && rec.type === 'month' && rec.rec.sales).toBeGreaterThan(0);
    expect(s.bank).toBeGreaterThan(bank - 20000);
    expect(poiActions(s, city, ap, b).map((x) => x.id)).toEqual(['rentUp', 'rentDown', 'repair']);
  });
});
