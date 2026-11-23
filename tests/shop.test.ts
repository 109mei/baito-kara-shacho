import { describe, expect, it } from 'vitest';
import { makeCity } from '../src/core/city';
import { custK, newEco, PHASES, turnMonth } from '../src/core/eco';
import { applyCount, apartFill, apartIncome, arriveRate, askOne, burgleChance, secOf, dayWorks, lineDay, makeStaff, newFirm, newShop, openConds, procCaps, rivalsReact, seen, serve } from '../src/core/shop';
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

describe('街の動き（景気・出来事・ほかの会社）', () => {
  it('景気は 好況→後退→不況→回復 の順に回る。次の局面は3か月前に新聞に出る', () => {
    const e = newEco(b);
    const r = rng(3);
    const seen2: string[] = [];
    const news: string[] = [];
    for (let m = 1; m <= 80; m++) {
      news.push(...turnMonth(e, m, r, b));
      if (seen2[seen2.length - 1] !== PHASES[e.cycle.phase].name) seen2.push(PHASES[e.cycle.phase].name);
    }
    expect(seen2.slice(0, 5)).toEqual(['好況', '後退', '不況', '回復', '好況']);
    expect(news.filter((t) => t.includes('3か月後')).length).toBeGreaterThanOrEqual(4);
    e.cycle.phase = 2;
    e.fx = [];
    expect(custK(e)).toBe(0.85);
  });
  it('出来事は1か月前に予告され、次の月に始まり、その次の月に終わる', () => {
    const e = newEco(b);
    e.events = [{ kind: 'typhoon', month: 5 }];
    turnMonth(e, 4, () => 0.99, b);
    expect(e.fx).toEqual([]);
    const news = turnMonth(e, 5, () => 0.99, b);
    expect(e.fx).toEqual(['typhoon']);
    expect(news.some((t) => t.includes('台風'))).toBe(true);
    expect(custK(e)).toBeCloseTo(PHASES[e.cycle.phase].cust * 0.6);
    turnMonth(e, 6, () => 0.99, b);
    expect(e.fx).toEqual([]);
    const pre = turnMonth(e, 7, () => 0, b); // 出来事が起きる月
    expect(pre.some((t) => t.startsWith('予告'))).toBe(true);
    expect(e.events[0].month).toBe(8);
  });
  it('保険：台風の月に入っていれば、減った売上の半分が戻る。入っていなければ、その差が月次レポートに出る', () => {
    const play = (insured: boolean) => {
      const s = createGame(7, city, b);
      s.cash = 3000000;
      s.eco.credit = 250;
      s.clock = 10 * 60;
      go(s, lot, 'shop');
      s.biz[0].aware = 90;
      s.firm.staff.push({ ...makeStaff(1, rng(2), b), at: lot.id });
      s.eco.fx = ['typhoon'];
      s.eco.insured = insured;
      const ev = monthEnd(s);
      const rec = ev.find((e) => e.type === 'month');
      return rec && rec.type === 'month' ? rec.rec : null;
    };
    expect(play(true)!.notes.some((t) => t.startsWith('保険で'))).toBe(true);
    expect(play(false)!.notes.some((t) => t.includes('保険に入っていれば'))).toBe(true);
    expect(play(true)!.rent - play(false)!.rent).toBe(b.town.insure); // 保険料は、家賃と光熱費に入る
  });
  it('競合：値下げには2か月で値段を合わせ、よく売れる店の近くには2か月で店ができる。客が割れる', () => {
    const z = newShop('stall', lot.id, 0, 0, 0, b);
    z.aware = 50;
    const alone = arriveRate(z, 1, b);
    z.m.sales = b.town.rivalStall + 1;
    expect(rivalsReact(z, rng(), b)).toEqual([]);
    expect(rivalsReact(z, rng(), b)[0]).toContain('同じような店');
    expect(z.rivals).toBe(1);
    expect(arriveRate(z, 1, b)).toBeCloseTo(alone / 1.2);
    z.m.sales = 0;
    z.price = 0.8;
    const cheap = arriveRate(z, 1, b);
    rivalsReact(z, rng(), b);
    expect(rivalsReact(z, rng(), b)[0]).toContain('値段を合わせてきた');
    expect(arriveRate(z, 1, b)).toBeLessThan(cheap); // 値下げの効き目がなくなる
  });
});

describe('製造型（工房）', () => {
  const crew = (procs: number[]) => {
    const firm = newFirm();
    procs.forEach((pr, i) => firm.staff.push({ ...makeStaff(i + 1, rng(9), b), at: lot.id, proc: pr, skill: 100, exp: 1 }));
    return firm;
  };
  it('1日に作れる数は、いちばん遅い工程の数。機械は、その工程を2倍にする', () => {
    const z = newShop('works', lot.id, 0, 0, 0, b);
    const firm = crew([0, 1, 2]);
    expect(procCaps(z, firm, 1, b)).toEqual([75, 30, 85]); // 切る8分・組む20分・仕上げ7分（1日10時間）
    const out = dayWorks(z, firm, 1000, 0, b);
    expect(out.made).toBe(30); // 組む工程が足を引っぱる
    z.mach[1] = true;
    expect(procCaps(z, firm, 1, b)[1]).toBe(60);
    expect(procCaps(z, crew([0, 1, 1, 2]), 1, b)[1]).toBe(120); // 人を足しても増える
    expect(procCaps(z, crew([0, 0, 0]), 1, b)[1]).toBe(0); // 工程に人がいないと、何も作れない
  });
  it('材料がなければ作れない。技能が低いと不良が出て、材料を余分に使う', () => {
    const z = newShop('works', lot.id, 0, 0, 0, b);
    expect(dayWorks(z, crew([0, 1, 2]), 0, 0, b).made).toBe(0);
    const low = newFirm();
    [0, 1, 2].forEach((pr, i) => low.staff.push({ ...makeStaff(i + 1, rng(9), b), at: lot.id, proc: pr, skill: 20, exp: 1 }));
    const out = dayWorks(z, low, 1000, 0, b);
    expect(out.bad).toBeGreaterThan(0);
    expect(out.used).toBe(out.made + out.bad);
  });
  it('街の中で：工房を開き、人が小物を作り、できた品が売り場と卸に売れる', () => {
    const s = createGame(7, city, b);
    s.cash = 3000000;
    s.eco.credit = 250;
    s.clock = 10 * 60;
    go(s, lot, 'works');
    expect(s.biz[0].type).toBe('works');
    [0, 1, 2].forEach((pr, i) => s.firm.staff.push({ ...makeStaff(i + 1, rng(9), b), at: lot.id, proc: pr }));
    go(s, kind('tool'), 'matsBulk');
    expect(s.tr.mats).toBe(b.works.bulk);
    go(s, lot, 'manage');
    go(s, city.home, 'sleep');
    expect(s.tr.stock.craftSmall).toBeGreaterThan(0);
    expect(s.tr.mats).toBeLessThan(b.works.bulk);
    s.tr.stock.craftSmall = 200;
    go(s, kind('market'), 'sellGoods');
    go(s, kind('market'), 'wholesale');
    expect(s.tr.stock.craftSmall).toBe(0);
    expect(s.tr.recv.some((r) => r.what === '卸の代金')).toBe(true);
  });
});

describe('路線型（バス）', () => {
  it('乗る人は、本数が多いほど増え、運賃が高いほど減る。遠い区間ほど少ない', () => {
    const ln = { a: 0, b: 1, buses: 5, fare: 1, d: { riders: 0, sales: 0, cost: 0 } };
    const base = lineDay(ln, 1, 1, 1000, b).riders;
    expect(lineDay({ ...ln, buses: 8 }, 1, 1, 1000, b).riders).toBeGreaterThan(base);
    expect(lineDay({ ...ln, fare: 1.3 }, 1, 1, 1000, b).riders).toBeLessThan(base);
    expect(lineDay(ln, 1, 1, 6000, b).riders).toBeLessThan(base);
    expect(lineDay(ln, 2, 1.5, 1000, b).riders).toBeGreaterThan(base);
    expect(lineDay(ln, 1, 1, 1000, b).cost).toBe(5 * (b.staff.market + b.bus.fuel));
  });
  it('街の中で：講習を受けて5台で始めると、毎日 売上と経費が出る。停まる場所を変えられる', () => {
    const s = createGame(7, city, b);
    s.cash = 5000000;
    s.clock = 10 * 60;
    go(s, kind('office'), 'busStart');
    expect(s.firm.line).toBeNull(); // 講習が要る
    go(s, kind('office'), 'busLecture');
    s.clock = Math.floor(s.clock / 1440 + 1) * 1440 + 10 * 60;
    go(s, kind('office'), 'busStart');
    expect(s.firm.line!.buses).toBe(b.bus.min);
    const a = s.firm.line!.a;
    apply(s, city, { type: 'line', act: 'a' }, b);
    expect(s.firm.line!.a).not.toBe(a);
    expect(s.firm.line!.a).not.toBe(s.firm.line!.b);
    apply(s, city, { type: 'line', act: 'fareDown' }, b);
    expect(s.firm.line!.fare).toBe(0.9);
    go(s, city.home, 'sleep');
    expect(s.firm.line!.d.riders).toBeGreaterThan(0);
    expect(s.eco.m.sales).toBe(s.firm.line!.d.sales);
  });
});


describe('法人にする', () => {
  it('街の中で：売上が出てから窓口で法人にすると、商売のお金は会社の口座で動き、月末に給料が自分へ移る', () => {
    const s = createGame(7, city, b);
    s.cash = 2000000;
    s.clock = 10 * 60;
    expect(poiActions(s, city, kind('office'), b).find((a) => a.id === 'incorp')!.why).toBe('商売の売上が出てから');
    go(s, kind('office'), 'lecture');
    s.clock = Math.floor(s.clock / 1440 + 1) * 1440 + 10 * 60;
    go(s, lot, 'stall');
    go(s, lot, 'tend');
    expect(s.eco.m.sales).toBeGreaterThan(0);
    s.clock = Math.floor(s.clock / 1440 + 1) * 1440 + 10 * 60;
    const cash = s.cash + s.bank;
    go(s, kind('office'), 'incorp');
    expect(s.eco.corp).toEqual({ bank: b.corp.capital, salary: b.corp.salary });
    expect(s.cash + s.bank).toBe(cash - b.corp.fee - b.corp.capital);
    // 店に立った売上は、会社の口座に入る。自分の現金は増えない
    const mine = s.cash;
    go(s, lot, 'tend');
    expect(s.cash).toBe(mine);
    expect(s.eco.corp!.bank).toBeGreaterThan(b.corp.capital);
    // 給料を上げ下げできる。自分のお金を会社に入れられる
    apply(s, city, { type: 'corp', act: 'payUp' }, b);
    expect(s.eco.corp!.salary).toBe(b.corp.salary + b.corp.step);
    const cb = s.eco.corp!.bank;
    apply(s, city, { type: 'corp', act: 'in' }, b);
    expect(s.eco.corp!.bank).toBe(cb + b.corp.unit);
    // 月末：会社の口座から家賃が出て、給料が自分の預金へ入る
    const evs = monthEnd(s);
    const rec = (evs.find((e) => e.type === 'month') as { rec: { salary?: number; corp?: number; living: number } }).rec;
    expect(rec.salary).toBe(b.corp.salary + b.corp.step);
    expect(rec.corp).toBe(s.eco.corp!.bank);
    // 保存して読み込んでも、会社は残る
    const t = fromSave(JSON.parse(JSON.stringify(toSave(s))), city, b);
    expect(t.eco.corp).toEqual(s.eco.corp);
  });
});

describe('許認可（建設・運送・警備）', () => {
  it('窓口で、足りない条件が「あとどれだけ」で見える。そろうと許可が出て、人を契約に回せる', () => {
    const s = createGame(7, city, b);
    s.cash = 300000;
    s.clock = 10 * 60;
    const act = (k: string) => poiActions(s, city, kind('office'), b).find((a) => a.id === `permit_${k}`)!;
    expect(act('build').ok).toBe(false);
    expect(act('build').sub).toContain('技術者');
    expect(act('build').sub).toContain('決算');
    expect(act('guard').ok).toBe(true);
    // 警備：講習を受けると許可が出る。前科があると取れない
    s.eco.cap = b.credit.arrestCap;
    s.eco.capUntil = 99;
    expect(act('guard').ok).toBe(false);
    s.eco.capUntil = 0;
    go(s, kind('office'), 'permit_guard');
    expect(s.firm.permits).toContain('guard');
    expect(s.cash).toBe(300000 - b.pro.guardFee);
    // 建設：技術者・決算・資金がそろうと取れる
    s.firm.staff.push({ ...makeStaff(1, rng(9), b), skill: 75 }, { ...makeStaff(2, rng(8), b), skill: 40 });
    s.eco.closings = 1;
    s.bank = b.pro.buildFund;
    s.clock = Math.floor(s.clock / 1440 + 1) * 1440 + 10 * 60;
    expect(act('build').ok).toBe(true);
    go(s, kind('office'), 'permit_build');
    expect(s.firm.permits).toContain('build');
    expect(s.bank).toBe(b.pro.buildFund); // 資金は見せるだけで、取られない
    // 人の持ち場を「契約」にできる
    apply(s, city, { type: 'staff', id: 1, act: 'assign' }, b);
    expect(s.firm.staff[0].at).toBe(-2);
    // 月が変わると、許可のある種類の話が届く
    monthEnd(s);
    expect(s.tr.bids.map((q) => q.kind).sort()).toEqual(['build', 'guard']);
  });
});

describe('狙われる側（空き巣と防犯）', () => {
  it('見込みは 1% ×（その月の売上 ÷ 10万円）。防犯は1つで3割ずつ効く', () => {
    const z = newShop('shop', lot.id, 0, 0, 0, b);
    z.m.sales = 300000;
    expect(burgleChance(z, b)).toBeCloseTo(0.03);
    expect(secOf(z, b)).toBe(0);
    z.sec = { lock: true, cam: true, guard: false };
    expect(secOf(z, b)).toBeCloseTo(0.6);
  });
  it('街の中で：知らせの次の月末に取られる。保険に入っていると8割が戻る。防犯は店で買える', () => {
    const run = (insured: boolean) => {
      const s = createGame(7, city, b);
      s.cash = 2000000;
      s.clock = 10 * 60;
      go(s, kind('office'), 'lecture');
      s.clock = Math.floor(s.clock / 1440 + 1) * 1440 + 10 * 60;
      go(s, lot, 'stall');
      monthEnd(s);
      s.eco.insured = insured;
      s.biz[0].hit = s.eco.hist.length; // 今月 狙われる
      s.biz[0].m.sales = 200000;
      const money = s.cash + s.bank;
      const evs = monthEnd(s);
      const rec = (evs.find((e) => e.type === 'month') as { rec: { notes: string[]; cost: number } }).rec;
      return { s, rec, lost: money - (s.cash + s.bank) };
    };
    const a = run(false);
    const c = run(true);
    expect(a.rec.notes.some((t) => t.includes('空き巣にあい'))).toBe(true);
    expect(a.s.biz[0].hit).toBeUndefined();
    const loss = 200000 * b.town.burgleLoss;
    expect(a.lost - c.lost).toBe(loss * b.town.burgleRefund - b.town.insure);
    // 防犯を買う
    const s = a.s;
    s.clock = Math.floor(s.clock / 1440 + 1) * 1440 + 10 * 60;
    go(s, lot, 'secLock');
    go(s, lot, 'secCam');
    go(s, lot, 'secGuard');
    expect(s.biz[0].sec).toEqual({ lock: true, cam: true, guard: true });
    expect(secOf(s.biz[0], b)).toBeCloseTo(0.9);
  });
});
