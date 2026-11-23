import { describe, expect, it } from 'vitest';
import { makeCity } from '../src/core/city';
import { addCredit, auditChance, capCredit, closeMonth, dateOf, loanOffers, monthlyPay, newEco, rankOf, takeLoan } from '../src/core/eco';
import { apply, createGame, fromSave, monthLiving, needOf, step, toSave } from '../src/core/sim';
import { makeStaff } from '../src/core/shop';
import { balance as b } from '../src/data/schema';

const city = makeCity(20261123, b);
const dpm = b.time.daysPerMonth;
// 月を n 回締める（商売なし・給料なし）
const months = (e: ReturnType<typeof newEco>, n: number, w: Partial<Parameters<typeof closeMonth>[1]> = {}) => {
  let out: ReturnType<typeof closeMonth> = { cash: w.cash ?? 1e9, bank: 0, bankrupt: false, corpBankrupt: false, caught: 0, rec: null as unknown as ReturnType<typeof closeMonth>['rec'] };
  for (let i = 0; i < n; i++) {
    e.days += dpm;
    out = closeMonth(e, { cash: out.cash, bank: out.bank, living: 0, wages: 0, rent: 0, hasBiz: false, ...w, ...(i > 0 ? { cash: out.cash } : {}) }, b);
  }
  return out;
};

describe('お金の決まり', () => {
  it('暦：1か月は数値の表の日数、1年は12か月', () => {
    const e = newEco(b);
    expect(dateOf(e, b)).toEqual({ year: 1, month: 1, day: 1 });
    e.days = dpm * 13 + 1;
    expect(dateOf(e, b)).toEqual({ year: 2, month: 2, day: 2 });
  });
  it('返済は毎月同じ額（借りた額 × 月の利率 ÷（1 −（1 + 月の利率）の −回数 乗））', () => {
    expect(monthlyPay(1000000, 0.12, 24)).toBe(47073);
    expect(monthlyPay(240000, 0, 24)).toBe(10000);
  });
  it('月末の締め：期日どおりに払うと信用が上がる。商売を続けて黒字なら、さらに上がる', () => {
    const e = newEco(b);
    const a = months(e, 1, { living: 10000 });
    expect(a.cash).toBe(1e9 - 10000);
    expect(e.credit).toBe(b.credit.start + b.credit.paid);
    e.m.sales = 50000;
    e.m.cost = 20000;
    const c = months(e, 1, { hasBiz: true, wages: 5000, rent: 5000 });
    expect(c.rec.profit).toBe(20000);
    expect(c.rec.creditDiff).toBe(b.credit.paid + b.credit.run + b.credit.black);
    expect(e.m).toEqual({ sales: 0, cost: 0, job: 0 });
    expect(e.hist.length).toBe(2);
  });
  it('払えない物は来月へ回る（3%上乗せ・信用が下がる）。次の月末にも払えないと倒産', () => {
    const e = newEco(b);
    e.credit = 300;
    const a = months(e, 1, { cash: 4000, living: 10000 });
    expect(a.bankrupt).toBe(false);
    expect(a.rec.unpaid).toEqual([{ what: '生活費', amount: Math.round(6000 * 1.03) }]);
    expect(e.credit).toBe(300 + b.credit.late);
    e.days += dpm;
    const ok = closeMonth(structuredClone(e), { cash: 50000, bank: 0, living: 10000, wages: 0, rent: 0, hasBiz: false }, b);
    expect(ok.bankrupt).toBe(false);
    expect(ok.cash).toBe(50000 - 6180 - 10000);
    const ng = closeMonth(e, { cash: 100, bank: 0, living: 10000, wages: 0, rent: 0, hasBiz: false }, b);
    expect(ng.bankrupt).toBe(true);
  });
  it('年末の決算：もうけの2割が税になり、2か月後に納める。期日どおりに納めると信用が上がる', () => {
    const e = newEco(b);
    for (let m = 0; m < b.time.monthsPerYear; m++) {
      e.m.sales = 30000;
      months(e, 1, { hasBiz: true });
    }
    expect(e.closings).toBe(1);
    expect(e.tax).toEqual([{ amount: 30000 * 12 * b.tax.person, due: 11 + b.tax.delayMonths }]);
    expect(e.infl).toBeCloseTo(1.02);
    months(e, 1);
    expect(e.tax.length).toBe(1);
    const before = e.credit;
    const out = months(e, 1);
    expect(out.rec.tax).toBe(72000);
    expect(e.tax.length).toBe(0);
    expect(e.credit).toBe(before + b.credit.taxPaid + b.credit.paid);
  });
  it('信用のランクと上限：200点ごとに E→A。倒産や逮捕のあとは、しばらく上限がつく', () => {
    expect([0, 199, 200, 400, 600, 800, 1000].map(rankOf)).toEqual(['E', 'E', 'D', 'C', 'B', 'A', 'A']);
    const e = newEco(b);
    e.credit = 700;
    capCredit(e, 400, b);
    expect(e.credit).toBe(400);
    addCredit(e, 300, b);
    expect(e.credit).toBe(400);
    e.days = dpm * (b.credit.capMonths + 1);
    addCredit(e, 300, b);
    expect(e.credit).toBe(700);
  });
  it('融資の審査に運はない：条件をすべて満たせば必ず通り、足りない条件は見える', () => {
    const e = newEco(b);
    let o = loanOffers(e, 300000, false, b);
    expect(o[0].ok).toBe(false);
    expect(o[0].conds.filter((c) => !c.ok).length).toBe(2); // ランクと知識
    expect(takeLoan(e, 'start', 100000, 300000, false, b)).toBeNull();
    e.credit = 250;
    e.know.retail = 30;
    o = loanOffers(e, 300000, false, b);
    expect(o[0].ok).toBe(true);
    expect(o[0].max).toBe(600000); // 自己資金の2倍まで
    expect(o[0].rate).toBe(b.loan.rateD);
    expect(takeLoan(e, 'start', 700000, 300000, false, b)).toBeNull();
    const loan = takeLoan(e, 'start', 600000, 300000, false, b)!;
    expect(loan.pay).toBe(monthlyPay(600000, b.loan.rateD, b.loan.months));
    expect(loanOffers(e, 300000, false, b)[0].ok).toBe(false); // 創業の融資は1回だけ
    // 返済：利息のぶんだけ多く払い、回数どおりに終わる
    let paid = 0;
    for (let m = 0; m < b.loan.months; m++) paid += months(e, 1).rec.repay;
    expect(e.loans.length).toBe(0);
    expect(paid).toBeGreaterThan(600000);
    expect(paid).toBeLessThan(600000 * 1.14);
    // 銀行：決算1回・ランクC・月のもうけの半分まで
    expect(loanOffers(e, 0, false, b)[1].ok).toBe(false);
    e.credit = 450;
    e.closings = 1;
    e.hist.slice(-3).forEach((h) => (h.profit = 60000));
    const bank = loanOffers(e, 0, false, b)[1];
    expect(bank.ok).toBe(true);
    expect(monthlyPay(bank.max, bank.rate, bank.months)).toBeLessThanOrEqual(30000);
  });
});

describe('お金の決まり（街の中で）', () => {
  const sleep = (s: ReturnType<typeof createGame>) => {
    s.x = city.home.x;
    s.y = city.home.y;
    return apply(s, city, { type: 'poi', id: city.home.id, act: 'sleep' }, b);
  };
  it('生活費は月末にまとめて出ていく。月末に月次レポートが出る', () => {
    const s = createGame(7, city, b);
    const cash = s.cash;
    let ev = [...sleep(s), ...sleep(s)];
    expect(s.cash).toBe(cash);
    expect(ev.some((e) => e.type === 'month')).toBe(false);
    ev = sleep(s);
    const m = ev.find((e) => e.type === 'month');
    expect(m && m.type === 'month' && m.rec.living).toBe(monthLiving(s, b));
    expect(s.cash).toBe(cash - b.money.living * dpm);
    expect(s.eco.credit).toBe(b.credit.start + b.credit.paid);
  });
  it('払えない月が2回続くと倒産：事業と乗り物と借入を失い、現金10万円でアルバイトからやり直す', () => {
    const s = createGame(7, city, b);
    s.cash = 0;
    s.eco.know.retail = 55;
    let broke = false;
    for (let d = 0; d < dpm * 2; d++) {
      s.cash = 0;
      s.bank = 0;
      broke = sleep(s).some((e) => e.type === 'bankrupt') || broke;
    }
    expect(broke).toBe(true);
    expect(s.cash).toBe(b.credit.restartCash);
    expect(s.eco.credit).toBe(0);
    expect(s.eco.know.retail).toBe(55); // 知識は残る
    expect(s.eco.owed).toEqual([]);
  });
  it('銀行で借りる：審査に通ると預金に入り、月末から返済が始まる。保存しても残る', () => {
    const s = createGame(7, city, b);
    const bank = city.pois.find((p) => p.kind === 'bank')!;
    s.x = bank.x;
    s.y = bank.y;
    s.cash = 300000;
    apply(s, city, { type: 'loan', id: bank.id, kind: 'start', amount: 200000, plan: 60000 }, b);
    expect(s.eco.loans.length).toBe(0); // ランクEでは借りられない
    s.eco.credit = 220;
    s.eco.know.retail = 40;
    apply(s, city, { type: 'loan', id: bank.id, kind: 'start', amount: 200000 }, b);
    expect(s.eco.loans.length).toBe(0); // 計画が要る
    apply(s, city, { type: 'loan', id: bank.id, kind: 'start', amount: 200000, plan: 60000 }, b);
    expect(s.eco.loans.length).toBe(1);
    expect(s.bank).toBe(200000);
    expect(s.eco.plan).toBe(60000);
    const t = fromSave(JSON.parse(JSON.stringify(toSave(s))), city, b);
    expect(t.eco.loans).toEqual(s.eco.loans);
    expect(t.eco.credit).toBe(220);
  });
  it('逮捕されると信用が300下がり、上限がつく', () => {
    const s = createGame(7, city, b);
    s.eco.credit = 800;
    s.heat = 90;
    s.catchT = 99;
    s.x = city.home.x;
    s.y = city.home.y;
    step(s, city, { mx: 0, my: 0 }, b);
    expect(s.eco.credit).toBe(b.credit.arrestCap);
  });
});

describe('裏の道の残り（税・自首・弁護士・下見）', () => {
  const yearEnd = (hide: number, audit: number, mixed = 0) => {
    const e = newEco(b);
    e.days = dpm * 12;
    e.yearProfit = 1000000;
    e.yearSales = 2000000;
    e.hide = hide;
    e.mixed = mixed;
    e.credit = 500;
    const out = closeMonth(e, { cash: 1e9, bank: 0, living: 0, wages: 0, rent: 0, hasBiz: true, audit }, b);
    return { e, out };
  };
  it('少なく申告すると税が減る。調査の見込みは 10% + 隠した割合 × 20%。見つかると、隠した税の 1.35倍', () => {
    expect(yearEnd(0, 0).e.tax[0].amount).toBe(200000);
    const e0 = newEco(b);
    e0.hide = 0.3;
    expect(auditChance(e0, b)).toBeCloseTo(0.16);
    const safe = yearEnd(0.3, 0.9);
    expect(safe.e.tax[0].amount).toBe(140000);
    const hit = yearEnd(0.3, 0.05);
    expect(hit.e.tax[0].amount).toBe(200000 + Math.round(60000 * 0.35));
    expect(hit.e.credit).toBeLessThan(safe.e.credit);
    expect(hit.e.hide).toBe(0);
  });
  it('売上に混ぜると、混ぜた額 ÷ 売上 × 50% だけ調査の見込みが上がり、見つかると没収', () => {
    const e = newEco(b);
    e.mixed = 400000;
    e.yearSales = 2000000;
    expect(auditChance(e, b)).toBeCloseTo(0.1);
    expect(yearEnd(0, 0.05, 400000).out.caught).toBe(400000);
    expect(yearEnd(0, 0.5, 400000).out.caught).toBe(0);
  });
  it('自首すると、罰金と出られるまでの時間が半分。弁護士がいると、さらに7割の長さ', () => {
    const bust = (self: boolean, lawyer: boolean) => {
      const s = createGame(7, city, b);
      const p = city.pois.find((q) => q.kind === 'police')!;
      s.x = p.x;
      s.y = p.y;
      s.cash = 1000000;
      s.heat = 90;
      s.firm.lawyer = lawyer;
      const ev = self ? apply(s, city, { type: 'poi', id: p.id, act: 'surrender' }, b) : ((s.catchT = 99), step(s, city, { mx: 0, my: 0 }, b));
      const e = ev.find((x) => x.type === 'busted');
      return e && e.type === 'busted' ? e : null;
    };
    const full = bust(false, false)!;
    const half = bust(true, false)!;
    expect(half.fine / full.fine).toBeCloseTo(b.law.surrender, 2);
    expect(half.hours).toBe(full.hours * b.law.surrender);
    expect(bust(false, true)!.hours).toBe(Math.round(full.hours * b.law.lawyerCut));
  });
  it('下見をすると、その家の通報までの時間が延びる', () => {
    const s = createGame(7, city, b);
    const h = city.pois.find((q) => q.kind === 'house')!;
    s.x = h.x;
    s.y = h.y;
    s.crowbar = true;
    apply(s, city, { type: 'poi', id: h.id, act: 'case' }, b);
    apply(s, city, { type: 'enter', id: h.id, hits: 3 }, b);
    expect(s.inside!.alarm).toBeCloseTo(b.crime.alarmQuiet * b.law.caseAlarm);
  });
});


describe('法人（会社の口座・役員報酬・会社の倒産）', () => {
  const corpEco = (bank: number, salary: number) => {
    const e = newEco(b);
    e.corp = { bank, salary };
    return e;
  };
  it('商売の支払いは会社の口座から出て、自分には給料として移る。給料は会社の経費になる', () => {
    const e = corpEco(500000, 30000);
    e.days += dpm;
    e.m = { sales: 200000, cost: 50000 };
    const out = closeMonth(e, { cash: 0, bank: 20000, living: 10000, wages: 40000, rent: 9000, hasBiz: true }, b);
    expect(e.corp!.bank).toBe(500000 - 40000 - 9000 - 30000);
    expect(out.bank).toBe(20000 + 30000 - 10000); // 給料が入り、生活費が出る
    expect(out.rec.salary).toBe(30000);
    expect(out.rec.profit).toBe(200000 - 50000 - 40000 - 9000 - 30000);
    expect(out.rec.corp).toBe(e.corp!.bank);
    expect(out.rec.unpaid).toEqual([]);
  });
  it('会社の口座が足りないと、給料は出せる分だけ。自分の現金は、会社の払いに使われない', () => {
    const e = corpEco(45000, 30000);
    e.days += dpm;
    const out = closeMonth(e, { cash: 900000, bank: 0, living: 0, wages: 40000, rent: 9000, hasBiz: true }, b);
    expect(out.cash).toBe(900000);
    expect(out.rec.salary).toBe(0);
    expect(out.rec.unpaid).toEqual([{ what: '家賃と光熱費', amount: Math.round(4000 * (1 + b.loan.deferFee)), corp: true }]);
  });
  it('法人の税は利益の30%、個人事業は20%。会社の税は会社の口座から納める', () => {
    const run = (corp: boolean) => {
      const e = corp ? corpEco(5000000, 0) : newEco(b);
      let out = { cash: 0, bank: 5000000 };
      for (let i = 0; i < b.time.monthsPerYear + b.tax.delayMonths; i++) {
        e.days += dpm;
        if (i < b.time.monthsPerYear) e.m = { sales: 100000, cost: 0 };
        out = closeMonth(e, { cash: out.cash, bank: out.bank, living: 0, wages: 0, rent: 0, hasBiz: true }, b);
      }
      return { e, out };
    };
    const me = run(false);
    const co = run(true);
    const profit = 100000 * b.time.monthsPerYear;
    expect(5000000 - me.out.bank).toBe(profit * b.tax.person);
    expect(co.out.bank).toBe(5000000); // 自分の預金は減らない
    expect(5000000 - co.e.corp!.bank).toBe(profit * b.tax.corp);
  });
  it('会社の払いが2か月続けて払えないと、会社が倒産する。自分のお金は残り、保証人になった借入も残る', () => {
    const e = corpEco(0, 30000);
    e.loans.push({ id: 1, kind: 'bank', amount: 600000, left: 600000, pay: 20000, rate: 0.05, n: 36, corp: true });
    e.credit = 700;
    e.days += dpm;
    let out = closeMonth(e, { cash: 300000, bank: 0, living: 0, wages: 50000, rent: 0, hasBiz: true }, b);
    expect(out.corpBankrupt).toBe(false);
    expect(e.owed.every((x) => x.corp)).toBe(true);
    e.days += dpm;
    out = closeMonth(e, { cash: out.cash, bank: out.bank, living: 0, wages: 50000, rent: 0, hasBiz: true }, b);
    expect(out.corpBankrupt).toBe(true);
    expect(out.bankrupt).toBe(false);
    expect(out.cash).toBe(300000);
    expect(e.corp).toBeNull();
    expect(e.owed).toEqual([]);
    expect(e.loans.length).toBe(1);
    expect(e.loans[0].corp).toBeUndefined();
    expect(e.credit).toBeLessThanOrEqual(b.credit.bankruptCap);
    // 次の月からは、残った借入を自分で返す
    e.days += dpm;
    out = closeMonth(e, { cash: out.cash, bank: out.bank, living: 0, wages: 0, rent: 0, hasBiz: false }, b);
    expect(out.cash).toBeLessThan(300000);
  });
});

describe('独立（アルバイトをせずに、3か月 お金が減らない）', () => {
  it('アルバイトの給料がなく、商売の売上があって、お金が減らない月が3か月続くと、独立になる', () => {
    const e = newEco(b);
    let out = { cash: 100000, bank: 0 };
    const month = (sales: number, job: number, living = 5000) => {
      e.days += dpm;
      e.m = { sales, cost: 0, job };
      const o = closeMonth(e, { cash: out.cash + sales + job, bank: out.bank, living, wages: 0, rent: 0, hasBiz: true }, b);
      out = o;
      return o.rec;
    };
    month(20000, 5000);
    month(20000, 0);
    month(20000, 0);
    expect(e.indep).toBe(-1);
    month(20000, 4400); // アルバイトをした月は、数え直し
    expect(e.free).toBe(0);
    month(20000, 0);
    month(3000, 0); // お金が減った月も、数え直し
    expect(e.free).toBe(0);
    month(20000, 0);
    month(20000, 0);
    expect(e.indep).toBe(-1);
    const rec = month(20000, 0);
    expect(e.indep).toBe(rec.month);
    expect(rec.notes.some((t) => t.includes('独立できた'))).toBe(true);
  });
});

describe('足りないものを、1つだけ出す', () => {
  it('順番は 現金 → 警察 → 納期 → 物 → 人。足りているものは出ない', () => {
    const s = createGame(7, city, b);
    expect(needOf(s, b)).toBeNull();
    s.cash = 500000; // 給料を払えるだけのお金がある
    s.firm.staff.push({ ...makeStaff(1, () => 0.5, b), mood: 70, at: -1 });
    expect(needOf(s, b)!.kind).toBe('staff');
    s.eco.know.craft = 1;
    expect(needOf(s, b)!.kind).toBe('stuff'); // 作る枠が残っているのに、材料がない
    s.tr.gigs[0].taken = true;
    expect(needOf(s, b)!.kind).toBe('stuff'); // 月の最後の日でなければ、納期は出ない
    s.eco.days = b.time.daysPerMonth - 1;
    expect(needOf(s, b)!.kind).toBe('due');
    s.heat = b.heat.perStar * 2;
    expect(needOf(s, b)!.kind).toBe('police');
    s.cash = 0;
    expect(needOf(s, b)!.kind).toBe('cash');
    expect(needOf(s, b)!.text).toContain('月末の払いに');
  });
});
