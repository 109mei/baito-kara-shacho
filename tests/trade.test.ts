import { describe, expect, it } from 'vitest';
import { makeCity } from '../src/core/city';
import { apply, adviceOf, clientsOf, createGame, fromSave, nearby, poiActions, toSave } from '../src/core/sim';
import { baseQuota, devHours, endMonth, firstUnits, left, newTr, offerBids, quality, releaseUnits, scoreOf, scoreParts, settleDeals, startQ, unitsAt, workMins, type Bid } from '../src/core/trade';
import { balance as b } from '../src/data/schema';

const city = makeCity(20261123, b);
const J = b.jobs;
type G = ReturnType<typeof createGame>;
const at = (s: G, kind: string) => {
  const p = kind === 'home' ? city.home : city.pois.find((q) => q.kind === kind)!;
  s.x = p.x;
  s.y = p.y;
  return p;
};
const act = (s: G, kind: string, a: string) => apply(s, city, { type: 'poi', id: at(s, kind).id, act: a }, b);
const sleepToMonthEnd = (s: G) => {
  const evs = [];
  const m = s.eco.hist.length;
  for (let i = 0; i < 9 && s.eco.hist.length === m; i++) evs.push(...act(s, 'home', 'sleep'));
  return evs;
};

describe('商売の共通の形（仕事の表・知名度・届く話）', () => {
  it('月の枠は知名度で決まる（仕様書6章の式）。高い仕事は、知名度が届いてから', () => {
    const tr = newTr();
    expect(baseQuota(tr, J.craftSmall)).toBe(40);
    expect(baseQuota(tr, J.craftOrder)).toBe(0);
    expect(baseQuota(tr, J.handyTidy) + baseQuota(tr, J.handyClean)).toBe(6);
    tr.fame.craft = 30;
    tr.pitch.craft = 1;
    expect(baseQuota(tr, J.craftSmall)).toBe(40 + 15 + 10);
    expect(baseQuota(tr, J.craftOrder)).toBe(15);
    tr.fame.craft = 100;
    expect(baseQuota(tr, J.craftOrder)).toBe(J.craftOrder.cap); // 上限（時間に合わせて、仕様書の半分の 30）
    tr.fame.handy = 30;
    expect(baseQuota(tr, J.handyWash)).toBe(0); // 道具がない
    tr.washer = true;
    expect(baseQuota(tr, J.handyWash)).toBe(14);
  });
  it('作業の時間：知識が30に満たないと遅く、道具で速く、疲れると遅い。品質は材料4割・技能4割・道具2割', () => {
    const tr = newTr();
    expect(workMins(J.craftSmall, 0, tr, 0)).toBe(Math.round(35 * 1.25));
    expect(workMins(J.craftSmall, 30, tr, 0)).toBe(35);
    tr.power = true;
    expect(workMins(J.craftSmall, 30, tr, 0)).toBe(Math.round(35 * 0.75));
    expect(workMins(J.craftSmall, 30, tr, 85)).toBe(Math.round(35 * 0.75 * 1.3));
    expect(quality(0, false, false)).toBe(20);
    expect(quality(50, true, true)).toBe(65);
  });
  it('同じ種なら、最初の月の枠と届く話は同じ。枠は ±10% の中でゆらぐ', () => {
    const a = createGame(7, city, b);
    const c = createGame(7, city, b);
    expect(a.tr.gigs).toEqual(c.tr.gigs);
    // 仕様書の式（40）に、月の短さの倍率（0.3）を掛けた 12 が、±10% の中でゆらぐ
    expect(a.tr.quota.craftSmall).toBeGreaterThanOrEqual(11);
    expect(a.tr.quota.craftSmall).toBeLessThanOrEqual(13);
    expect(baseQuota(a.tr, J.craftSmall, b.time.quotaScale)).toBe(12);
    expect(a.tr.gigs.length).toBe(a.tr.quota.handyTidy + a.tr.quota.handyClean);
    expect(a.tr.gigs.every((g) => clientsOf(city).includes(g.poi) && !g.taken)).toBe(true);
  });
  it('手作りの品：材料を買い、自宅で作り、売り場に納めると、その場でお金が入る。月末に知名度が上がる', () => {
    const s = createGame(7, city, b);
    const cash = s.cash;
    expect(poiActions(s, city, city.home, b).find((a) => a.id === 'craftSmall')!.ok).toBe(false);
    act(s, 'tool', 'mats');
    expect(s.tr.mats).toBe(10);
    const clock = s.clock;
    act(s, 'home', 'craftSmall');
    expect(s.tr.stock.craftSmall).toBe(4);
    expect(s.clock - clock).toBe(workMins(J.craftSmall, 0, s.tr, 0) * 4);
    expect(s.eco.fatigue).toBeGreaterThan(0);
    expect(s.eco.know.craft).toBeGreaterThan(0);
    act(s, 'home', 'craftSmall');
    act(s, 'market', 'sellGoods');
    expect(s.cash).toBe(cash - 2000 + 8 * 800);
    expect(s.tr.used.craftSmall).toBe(8);
    expect(left(s.tr, 'craftSmall')).toBe(s.tr.quota.craftSmall - 8);
    const ev = sleepToMonthEnd(s);
    const rec = ev.find((e) => e.type === 'month');
    expect(rec && rec.type === 'month' && [rec.rec.sales, rec.rec.cost]).toEqual([6400, 2000]);
    expect(s.tr.fame.craft).toBe(2.7); // 8個 ÷ 10 ÷ 月の短さの倍率（0.3）
    expect(s.eco.credit).toBe(b.credit.start + b.credit.paid + b.credit.run + b.credit.black);
  });
  it('枠より多く作っても、今月は売れない', () => {
    const s = createGame(7, city, b);
    s.tr.stock.craftSmall = 100;
    const q = s.tr.quota.craftSmall;
    act(s, 'market', 'sellGoods');
    expect(s.tr.stock.craftSmall).toBe(100 - q);
    expect(poiActions(s, city, at(s, 'market'), b).find((a) => a.id === 'sellGoods')!.ok).toBe(false);
    act(s, 'market', 'pitchCraft'); // 売り込むと、枠が増える
    expect(left(s.tr, 'craftSmall')).toBe(3); // 仕様書の +10 に、月の短さの倍率を掛けた数
  });
  it('便利屋：届いた話を受け、その家へ行って仕事をすると、その場でお金が入る。受けて守らないと知名度と信用が下がる', () => {
    const s = createGame(7, city, b);
    const g = s.tr.gigs[0];
    const house = city.pois[g.poi];
    s.x = house.x;
    s.y = house.y;
    expect(poiActions(s, city, house, b).some((a) => a.id === 'gig')).toBe(false);
    apply(s, city, { type: 'gig', id: g.id, take: true }, b);
    expect(poiActions(s, city, house, b)[0].id).toBe('gig');
    const cash = s.cash;
    apply(s, city, { type: 'poi', id: house.id, act: 'gig' }, b);
    expect(s.cash).toBe(cash + J[g.job].price - J[g.job].mat);
    expect(s.tr.gigs.includes(g)).toBe(false);
    const g2 = s.tr.gigs[0];
    apply(s, city, { type: 'gig', id: g2.id, take: true }, b);
    s.tr.fame.handy = 5;
    const credit = s.eco.credit;
    sleepToMonthEnd(s);
    expect(s.tr.fame.handy).toBeLessThan(5);
    expect(s.eco.credit).toBeLessThan(credit + b.credit.paid + b.credit.run + b.credit.black);
    expect(s.tr.gigs.every((x) => !x.taken)).toBe(true); // 次の月の話が届いている
    expect(s.tr.gigs.length).toBeGreaterThan(0);
  });
  it('個人開発：ノートPCで作り、発売すると、売上は翌月末に入る。翌月からは決まった割合で減る', () => {
    const s = createGame(7, city, b);
    expect(poiActions(s, city, city.home, b).find((a) => a.id === 'devSmall')!.ok).toBe(false);
    s.laptop = true;
    s.cash = 500000;
    s.eco.know.soft = 30;
    act(s, 'home', 'devSmall');
    for (let i = 0; i < 40 && s.tr.proj; i++) {
      s.eco.fatigue = 0;
      act(s, 'home', 'dev');
    }
    expect(s.tr.proj).toBeNull();
    expect(firstUnits(J.softSmall, 0, false, b.time.quotaScale)).toBe(9); // 仕様書の 30本 に、月の短さの倍率を掛けた 9本
    const first = releaseUnits(J.softSmall, 0, { job: 'softSmall', hours: 0, out: false, q: startQ(30, b), hype: 0 }, 0, b); // 品質（知識30で59）のぶん、少し多い
    expect(first).toBe(10);
    expect(s.tr.titles[0].first).toBe(first);
    const bank = s.bank;
    sleepToMonthEnd(s);
    expect(s.bank).toBe(bank); // 入金は翌月末
    expect(s.tr.recv[0].amount).toBe(first * 350);
    sleepToMonthEnd(s);
    expect(s.bank).toBe(bank + first * 350);
    expect(s.tr.recv[0].amount).toBe(Math.round(first / 2) * 350); // 前の月の半分
    expect(s.tr.fame.soft).toBeGreaterThan(0);
    const t = fromSave(JSON.parse(JSON.stringify(toSave(s))), city, b);
    expect(t.tr).toEqual(s.tr);
  });
  it('疲れ：働くとたまり、寝ると取れる。100になると、1日 寝こむ', () => {
    const s = createGame(7, city, b);
    act(s, 'conbini', 'work');
    expect(s.eco.fatigue).toBe(b.self.tirePerHour * b.money.shiftHours);
    expect(s.eco.know.retail).toBe(1);
    act(s, 'home', 'sleep');
    expect(s.eco.fatigue).toBe(0);
    s.eco.fatigue = 97;
    s.clock = 10 * 60;
    const day = Math.floor(s.clock / 1440);
    const ev = act(s, 'conbini', 'work');
    expect(ev.some((e) => e.type === 'toast' && e.text.includes('倒れた'))).toBe(true);
    expect(Math.floor(s.clock / 1440)).toBe(day + 1);
    expect(s.eco.fatigue).toBe(60);
  });
  it('聞きに行くと、いまの数字から1つだけ、現実の言葉で言われる', () => {
    const s = createGame(7, city, b);
    expect(adviceOf(s, b)).toContain('信用');
    s.eco.owed = [{ what: '生活費', amount: 100 }];
    expect(adviceOf(s, b)).toContain('支払い');
  });
});

describe('契約型：点の高い会社が受注する（運は入らない）', () => {
  const bid = (over: Partial<Bid> = {}): Bid => ({ id: 1, poi: 5, value: 60000, visits: 3, months: 3, quote: 1, calls: 0, heavy: -1, light: -1, rival: 50, ...over });
  it('点の内訳：価格30・実績20・信用20・関係20・納期10。相手ごとに、どれかが10多く、どれかが10少ない', () => {
    const tr = newTr();
    expect(scoreParts(tr, bid(), 0, b)).toEqual([30, 0, 0, 0, 10]);
    tr.jobs = 5;
    tr.rel[5] = 50;
    expect(scoreParts(tr, bid(), 2, b)).toEqual([30, 20, 10, 10, 10]);
    expect(scoreParts(tr, bid({ quote: 1.1 }), 2, b)[0]).toBeCloseTo(27.3);
    expect(scoreParts(tr, bid({ heavy: 3, light: 0 }), 2, b)).toEqual([20, 20, 10, 15, 10]);
    tr.deals = [{ poi: 1, value: 1, visits: 1, left: 1, done: 0 }, { poi: 2, value: 1, visits: 1, left: 1, done: 0 }];
    expect(scoreParts(tr, bid(), 2, b)[4]).toBe(0); // 手がいっぱいだと納期が取れない
  });
  it('話は実績3件から届く。月末に、点が競合より高ければ取れる。回数を守れないと違約金', () => {
    const tr = newTr();
    offerBids(tr, [5, 6], () => 0.5, b);
    expect(tr.bids.length).toBe(0);
    tr.jobs = 5;
    offerBids(tr, [5, 6], () => 0.5, b);
    expect(tr.bids.length).toBe(2);
    tr.bids = [bid({ rival: 80 })];
    expect(settleDeals(tr, 0, 1, b)[0]).toContain('競合に取られた');
    tr.bids = [bid({ rival: 50 })];
    expect(scoreOf(tr, tr.bids[0], 1, b)).toBe(65); // 価格30＋実績20＋信用5＋関係0＋納期10
    expect(settleDeals(tr, 0, 1, b)[0]).toContain('契約が取れた');
    expect(tr.deals.length).toBe(1);
    tr.bids = [];
    tr.deals[0].done = 3;
    settleDeals(tr, 1, 1, b);
    expect(tr.recv[0]).toEqual({ amount: 60000, due: 2, what: '契約の代金' });
    tr.deals[0].done = 2;
    tr.rel[5] = 40;
    expect(settleDeals(tr, 2, 1, b)[0]).toContain('違約金');
    expect(tr.recv[1].amount).toBe(54000);
    expect(tr.rel[5]).toBe(20);
  });
  it('街の中で：通うと関係が上がり、契約の相手の場所で仕事ができる', () => {
    const s = createGame(7, city, b);
    s.tr.bids = [bid({ poi: city.pois.find((p) => p.kind === 'warehouse')!.id })];
    apply(s, city, { type: 'bid', id: 1, act: 'call' }, b);
    apply(s, city, { type: 'bid', id: 1, act: 'low' }, b);
    expect(s.tr.rel[s.tr.bids[0].poi]).toBe(b.deal.relPerVisit);
    expect(s.tr.bids[0].quote).toBe(0.9);
    const p = city.pois[s.tr.bids[0].poi];
    s.tr.deals = [{ poi: p.id, value: 60000, visits: 3, left: 3, done: 0 }];
    s.x = p.x;
    s.y = p.y;
    expect(poiActions(s, city, p, b)[0].id).toBe('deal');
    apply(s, city, { type: 'poi', id: p.id, act: 'deal' }, b);
    expect(s.tr.deals[0].done).toBe(1);
  });
});


describe('許認可の要る契約（建設・運送・警備）と入札', () => {
  const firms = [3, 4, 5];
  const r = (seed = 3) => {
    let x = seed;
    return () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296;
  };
  it('許可を持っている種類の話だけが届く。入札は、信用のランクBと、同じ種類の実績3か月から', () => {
    const tr = newTr();
    offerBids(tr, firms, r(), b);
    expect(tr.bids).toEqual([]);
    offerBids(tr, firms, r(), b, ['guard'], 2);
    expect(tr.bids.map((q) => [q.kind, q.crew, q.big])).toEqual([['guard', b.pro.guardCrew, false]]);
    tr.pro.guard = b.pro.bigJobs;
    offerBids(tr, firms, r(), b, ['guard'], 2);
    expect(tr.bids.length).toBe(1); // ランクCでは入札に出られない
    offerBids(tr, firms, r(), b, ['guard', 'build'], b.pro.bigRank);
    expect(tr.bids.map((q) => [q.kind, q.big])).toEqual([['build', false], ['guard', false], ['guard', true]]);
    const big = tr.bids[2];
    expect(big.crew).toBe(b.pro.guardCrew * 2);
    expect(big.value).toBeGreaterThan(b.pro.guardValue * b.pro.big * 0.79);
  });
  it('人を回す契約は、回した人が足りていれば代金が入り、実績が積もる。足りないと入らず、関係が下がる', () => {
    const tr = newTr();
    tr.rel[3] = 50;
    tr.deals.push({ poi: 3, value: 90000, visits: 1, left: 2, done: 0, kind: 'guard', crew: 2 });
    let notes = settleDeals(tr, 0, 2, b, 2);
    expect(notes).toEqual([]);
    expect(tr.recv).toEqual([{ amount: 90000, due: 1, what: '契約の代金' }]);
    expect(tr.pro.guard).toBe(1);
    notes = settleDeals(tr, 1, 2, b, 1);
    expect(notes[0]).toContain('人が足りなかった');
    expect(tr.recv.length).toBe(1);
    expect(tr.rel[3]).toBe(50 - b.deal.relLoss);
    expect(tr.deals).toEqual([]);
  });
  it('点の「納期」は、空いている人が要る人数に足りているかで決まる', () => {
    const tr = newTr();
    const bid = { id: 1, poi: 3, kind: 'build' as const, crew: 3, value: 180000, visits: 1, months: 2, quote: 1, calls: 0, heavy: -1, light: -1, rival: 50 };
    expect(scoreParts(tr, bid, 2, b, 2)[4]).toBe(0);
    expect(scoreParts(tr, bid, 2, b, 3)[4]).toBe(10);
    tr.deals.push({ poi: 4, value: 1, visits: 1, left: 1, done: 0, kind: 'guard', crew: 2 });
    expect(scoreParts(tr, bid, 2, b, 4)[4]).toBe(0); // 2人は、ほかの契約に取られている
    tr.pro.build = 5;
    expect(scoreParts(tr, bid, 2, b, 5)[1]).toBe(20); // 実績は、同じ種類の仕事で数える
  });
});

describe('手でやる操作の結果', () => {
  const home = city.home;
  const make = (grade?: 0 | 1 | 2) => {
    const s = createGame(7, city, b);
    s.cash = 100000;
    s.clock = 9 * 60;
    s.tr.mats = 40;
    s.x = home.x;
    s.y = home.y;
    const t0 = s.clock;
    apply(s, city, { type: 'poi', id: home.id, act: 'craftSmall', ...(grade === undefined ? {} : { grade }) }, b);
    return { s, mins: s.clock - t0 };
  };
  it('上出来は品質 +5。ふつう（おまかせ）はそのまま。やり直しは時間が2割多くかかる。材料とお金は同じ', () => {
    const [auto, bad, ok, good] = [make(), make(0), make(1), make(2)];
    expect(ok.mins).toBe(auto.mins);
    expect(good.mins).toBe(auto.mins);
    expect(bad.mins).toBeCloseTo(auto.mins * b.self.handSlow, 5);
    for (const r of [bad, ok, good]) {
      expect(r.s.tr.mats).toBe(auto.s.tr.mats);
      expect(r.s.cash).toBe(auto.s.cash);
      expect(r.s.tr.stock.craftSmall).toBe(4);
    }
    expect(auto.s.tr.q.sum).toBe(0);
    expect(good.s.tr.q.sum).toBe(b.self.handGood * 4);
  });
});

describe('仕事を受けた家', () => {
  it('バールを持っていなくても、仕事を受けた家には近づいて入れる（受けていない留守の家は出ない）', () => {
    const s = createGame(7, city, b);
    const g = s.tr.gigs[0];
    const p = city.pois[g.poi];
    s.x = p.x;
    s.y = p.y + 2;
    expect(nearby(s, city).poi?.id).not.toBe(p.id);
    g.taken = true;
    expect(nearby(s, city).poi?.id).toBe(p.id);
    expect(poiActions(s, city, p, b).some((a) => a.id === 'gig')).toBe(true);
  });
});

describe('個人開発を広げる（品質・期待・体験版・アップデート・セール・ファン・開発の仕事・チーム）', () => {
  const dev = () => {
    const s = createGame(7, city, b);
    s.laptop = true;
    s.cash = 900000;
    s.clock = 9 * 60;
    return s;
  };
  it('発売の本数は、品質50で1倍（0で0.6倍、100で1.4倍）。期待は1%で1%増える。ファンの3割が買う', () => {
    const pj = (q: number, hype: number) => ({ job: 'softMid', hours: 0, out: false, q, hype });
    const base = firstUnits(J.softMid, 20, false, b.time.quotaScale);
    expect(releaseUnits(J.softMid, 20, pj(50, 0), 0, b)).toBe(base);
    expect(releaseUnits(J.softMid, 20, pj(100, 0), 0, b)).toBe(Math.round(base * 1.4));
    expect(releaseUnits(J.softMid, 20, pj(0, 0), 0, b)).toBe(Math.round(base * 0.6));
    expect(releaseUnits(J.softMid, 20, pj(50, 50), 0, b)).toBe(Math.round(base * 1.5));
    expect(releaseUnits(J.softMid, 20, pj(50, 0), 100, b)).toBe(base + 100 * b.soft.fanBuy);
    expect(startQ(0, b)).toBe(b.soft.qBase);
  });
  it('街の中で：不具合を直すと品質、宣伝と体験版で期待が上がり、発売の見込みが増える。時間は「作る」に入らない', () => {
    const s = dev();
    act(s, 'home', 'devSmall');
    expect(s.tr.proj).toMatchObject({ q: b.soft.qBase, hype: 0 });
    const acts = () => poiActions(s, city, city.home, b);
    expect(acts().find((a) => a.id === 'fix')!.ok).toBe(false); // まだ直す所がない
    expect(acts().find((a) => a.id === 'demo')!.ok).toBe(false); // 半分まで作ってから
    act(s, 'home', 'dev');
    const h = s.tr.proj!.hours;
    const t0 = s.clock;
    act(s, 'home', 'fix');
    expect(s.clock - t0).toBe(b.soft.fixHours * 60);
    expect(s.tr.proj!.q).toBe(b.soft.qBase + b.soft.fixGain);
    expect(s.tr.proj!.hours).toBe(h);
    act(s, 'home', 'promo');
    expect(s.tr.proj!.hype).toBe(b.soft.promoGain);
    while (s.tr.proj!.hours < devHours(J.softSmall, b) * b.soft.demoAt) {
      s.eco.fatigue = 0;
      act(s, 'home', 'dev');
    }
    const fame = s.tr.fame.soft ?? 0;
    act(s, 'home', 'demo');
    expect(s.tr.proj!.demo).toBe(true);
    expect(s.tr.proj!.hype).toBe(b.soft.promoGain + b.soft.demoHype);
    expect(s.tr.fame.soft).toBe(fame + 1);
    act(s, 'home', 'demo');
    expect(s.tr.proj!.hype).toBe(b.soft.promoGain + b.soft.demoHype); // 体験版は1回だけ
    const want = releaseUnits(J.softSmall, s.tr.fame.soft, s.tr.proj!, 0, b);
    expect(want).toBeGreaterThan(firstUnits(J.softSmall, s.tr.fame.soft, false, b.time.quotaScale));
    while (s.tr.proj) {
      s.eco.fatigue = 0;
      act(s, 'home', 'dev');
    }
    expect(s.tr.titles[0].first).toBe(want);
    expect(s.tr.titles[0].q).toBe(b.soft.qBase + b.soft.fixGain);
  });
  it('アップデートは売れ行きの落ちを1か月ぶん止める（3回まで）。セールは1作品に1回で、本数2倍・値段半分', () => {
    const t = { job: 'softSmall', month: 0, first: 40 };
    expect(unitsAt(J.softSmall, t, 2)).toBe(10);
    expect(unitsAt(J.softSmall, { ...t, upd: 1 }, 2)).toBe(20);
    expect(unitsAt(J.softSmall, { ...t, upd: 5 }, 2)).toBe(40);
    const tr = newTr();
    tr.titles.push({ ...t, sale: 1 });
    endMonth(tr, 1, b);
    expect(tr.recv[0].amount).toBe(40 * J.softSmall.price * 0.5); // 20本 × 2倍 × 半額
    expect(tr.fans).toBe(40 * b.soft.fanRate);
    // 街の中で
    const s = dev();
    s.tr.titles.push({ job: 'softSmall', month: 0, first: 40 });
    s.eco.days = b.time.daysPerMonth; // 2か月目
    for (let i = 0; i < 5; i++) {
      s.eco.fatigue = 0;
      act(s, 'home', 'devUpdate');
    }
    expect(s.tr.titles[0].upd).toBe(b.soft.updMax);
    act(s, 'home', 'devSale');
    expect(s.tr.titles[0].sale).toBe(1);
    expect(poiActions(s, city, city.home, b).find((a) => a.id === 'devSale')!.ok).toBe(false);
  });
  it('作品の種類：仕事用の道具は知名度10から、大作は30から。道具は長く売れる', () => {
    const s = dev();
    const ok = (id: string) => poiActions(s, city, city.home, b).find((a) => a.id === id)!.ok;
    expect([ok('devSmall'), ok('devMid'), ok('devTool'), ok('devBig')]).toEqual([true, true, false, false]);
    s.tr.fame.soft = 10;
    expect(ok('devTool')).toBe(true);
    s.tr.fame.soft = 30;
    expect(ok('devBig')).toBe(true);
    expect(J.softTool.decay).toBeGreaterThan(J.softMid.decay);
  });
  it('開発の仕事（会社から）：ノートPCがあると話が届く。売り込むと増える。自宅の机でやり、代金は翌月末', () => {
    const s = dev();
    expect(s.tr.gigs.some((g) => g.job === 'softWork')).toBe(false); // PCを買う前に始まった月には、届いていない
    s.clock = 10 * 60;
    for (let i = 0; i < 2; i++) act(s, 'market', 'pitchSoft');
    const g = s.tr.gigs.find((q) => q.job === 'softWork')!;
    expect(g.poi).toBe(city.home.id);
    apply(s, city, { type: 'gig', id: g.id, take: true }, b);
    const cash = s.cash;
    act(s, 'home', 'deskGig');
    expect(s.tr.gigs.some((q) => q.id === g.id)).toBe(false);
    expect(s.cash).toBe(cash);
    expect(s.tr.recv.at(-1)).toMatchObject({ amount: J.softWork.price, what: '開発の仕事の代金' });
    expect(s.eco.m.sales).toBe(J.softWork.price);
  });
  it('開発に回した人は、作っている作品を毎日進める', () => {
    const s = dev();
    act(s, 'home', 'devMid');
    const mk = (id: number, skill: number) => ({ id, name: `人${id}`, bio: '', skill, service: 50, honest: 80, lead: 50, grow: 1, ask: 8000, wage: 8000, mood: 0, exp: 1, at: -3, proc: 0, see: [3, 3, 3], months: 3, quiet: 0 });
    s.firm.staff.push(mk(1, 100) as never, mk(2, 50) as never);
    act(s, 'home', 'sleep');
    expect(s.tr.proj!.hours).toBeCloseTo(1.5 * b.soft.teamHours, 5);
  });
});

