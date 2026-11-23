// 受け入れ条件（仕様書 13章）を、ルール本体と同じコードで確かめるシミュレーター。
// ふだんのテストでは少ない回数で「止まらない・同じ結果になる」だけを見る。
// 本番の回数（各 1,000回）は `npm run sim`（SIM=1）で回し、結果を表で出す。
import { describe, expect, it } from 'vitest';
import { makeCity } from '../src/core/city';
import { apply, createGame, hourOf, passTime, poiActions, type Ev } from '../src/core/sim';
import { fameOf, left } from '../src/core/trade';
import { balance as b } from '../src/data/schema';

const city = makeCity(20261123, b);
const FULL = !!(globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.SIM;
const RUNS = FULL ? 1000 : 40;
const kind = (k: string) => city.pois.find((p) => p.kind === k)!;
const P = { home: city.home, job: kind('conbini'), tool: kind('tool'), market: kind('market'), office: kind('office') };
const living = b.money.living * b.time.daysPerMonth;

export type Model = 'craft' | 'handy' | 'soft' | 'random';
export interface Run { indep: number; broke: number; stuck: boolean; months: number; picks: Record<string, number>[]; money: number }

// 1回ぶん遊ばせる。同じ種なら、同じ結果になる
export function play(model: Model, seed: number, months: number): Run {
  const s = createGame(seed, city, b);
  let x = (seed * 2654435761) >>> 0;
  const rnd = () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296; // 模型の乱数（でたらめな人の手えらび）
  const run: Run = { indep: -1, broke: -1, stuck: false, months: 0, picks: [], money: 0 };
  let at = -1;
  let quit = false; // アルバイトを辞めた
  let lastBiz = 0; // 先月の商売のもうけ
  let pitched = 0;
  const pick = (name: string) => {
    const m = (run.picks[run.months] ??= {});
    m[name] = (m[name] ?? 0) + 1;
  };
  const seen = (evs: Ev[]) => {
    for (const e of evs) {
      if (e.type === 'month') {
        run.months += 1;
        lastBiz = e.rec.sales - e.rec.cost;
        pitched = 0;
        if (s.eco.indep >= 0 && run.indep < 0) run.indep = run.months;
      } else if (e.type === 'bankrupt' && run.broke < 0) run.broke = run.months;
    }
  };
  // その場所へ行って（移動に 15分）、行動する。できなければ false
  const go = (p: { x: number; y: number; id: number }, act: string, name = act): boolean => {
    if (!poiActions(Object.assign(s, { x: p.x, y: p.y }), city, city.pois[p.id], b).find((a) => a.id === act)?.ok) return false;
    if (at !== p.id) seen(passTime(s, city, 15, b));
    at = p.id;
    s.x = p.x;
    s.y = p.y;
    if (!poiActions(s, city, city.pois[p.id], b).find((a) => a.id === act)?.ok) return false;
    seen(apply(s, city, { type: 'poi', id: p.id, act }, b));
    pick(name);
    return true;
  };
  const sleep = () => {
    const d = s.clock;
    go(P.home, 'sleep', 'sleep');
    if (s.clock === d) {
      seen(passTime(s, city, 60, b)); // 寝られないとき（見られている）は、1時間 待つ
      if (s.clock === d) run.stuck = true;
    }
  };
  const money = () => s.cash + Math.max(0, s.bank);
  const stockN = () => Math.min(s.tr.stock.craftSmall ?? 0, left(s.tr, 'craftSmall')) + Math.min(s.tr.stock.craftOrder ?? 0, left(s.tr, 'craftOrder')); // いま売れる品の数

  let guard = 0;
  while (run.months < months && run.broke < 0 && !run.stuck && guard++ < months * 200) {
    const h = hourOf(s);
    if (h >= 21 || h < 6 || s.eco.fatigue > 80) {
      sleep();
      continue;
    }
    if (model === 'random') {
      // でたらめ：行ける場所の、できる行動（法を破らないもの）から、でたらめに1つ選ぶ
      const spots = [P.home, P.job, P.tool, P.market, P.office, kind('lot'), kind('bike'), kind('apart'), kind('warehouse')];
      const all = spots.flatMap((p) => poiActions(Object.assign(s, { x: p.x, y: p.y }), city, p, b).filter((a) => a.ok && !a.crime && a.id !== 'loan').map((a) => [p, a.id] as const));
      if (!all.length) {
        sleep();
        continue;
      }
      const [p, act] = all[Math.floor(rnd() * all.length)];
      const t = s.clock;
      go(p, act);
      if (s.clock === t && guard % 6 === 0) seen(passTime(s, city, 60, b)); // 時間の進まない行動ばかりのときも、時計は進む
      continue;
    }
    // ふつうの人：先月の商売のもうけが生活費の 1.2倍 を超え、2か月ぶんの蓄えがあれば、アルバイトを辞める。蓄えが尽きかけたら戻る
    if (!quit && lastBiz >= living * 1.2 && money() >= living * 2) quit = true;
    if (model === 'soft' && !quit && fameOf(s.tr, 'soft') >= 20 && money() >= living * 5) quit = true;
    if (quit && money() < living) quit = false;
    const tr = s.tr;
    let did = false;
    if (model === 'craft') {
      const need = left(tr, 'craftSmall') - (tr.stock.craftSmall ?? 0);
      const order = fameOf(tr, 'craft') >= b.jobs.craftOrder.fame ? left(tr, 'craftOrder') - (tr.stock.craftOrder ?? 0) : 0;
      if (!quit && (run.picks[run.months]?.day ?? -1) !== Math.floor(s.clock / 1440) && h < 12) {
        did = go(P.job, 'work', 'baito');
        (run.picks[run.months] ??= {}).day = Math.floor(s.clock / 1440);
      } else if (stockN() >= 8 || (stockN() > 0 && h >= 17)) did = go(P.market, 'sellGoods', 'sell'); // 品がたまったら、または夕方に、売り場へ持って行く
      else if (order > 0 && tr.mats >= 6) did = go(P.home, 'craftOrder');
      else if (need > 0 && tr.mats >= 4) did = go(P.home, 'craftSmall');
      else if ((need > 0 || order > 0) && tr.mats < 6) did = go(P.tool, 'mats', 'buy');
      else if ((tr.stock.craftSmall ?? 0) + (tr.stock.craftOrder ?? 0) > 0) did = go(P.market, 'sellGoods', 'sell');
      else if (pitched < 2 && h < 18) {
        did = go(P.market, 'pitchCraft', 'pitch');
        pitched += did ? 1 : 0;
      }
      if (!did && (tr.stock.craftSmall ?? 0) + (tr.stock.craftOrder ?? 0) > 0) did = go(P.market, 'sellGoods', 'sell');
    } else if (model === 'handy') {
      // 受けるのは、いまからやる1件だけ（受けて守れないと、知名度と信用が下がる）。代金の高い話から受ける
      const g = tr.gigs.find((q) => q.taken) ?? [...tr.gigs].sort((p, q) => b.jobs[q.job].price - b.jobs[p.job].price)[0];
      if (g && !g.taken) apply(s, city, { type: 'gig', id: g.id, take: true }, b);
      if (!tr.washer && fameOf(tr, 'handy') >= b.jobs.handyWash.fame && s.cash >= b.money.washer + living) did = go(P.tool, 'washer', 'buy');
      else if (g) did = go(city.pois[g.poi], 'gig', g.job);
      else if (pitched < 3 && h < 18) {
        did = go(P.market, 'pitchHandy', 'pitch');
        pitched += did ? 1 : 0;
      }
    } else {
      if (!s.laptop) {
        if (s.cash >= b.money.laptopOld) did = go(P.tool, 'laptopOld', 'buy'); // まず中古で始める
      } else if (tr.oldPc && s.cash >= b.money.laptop + living * 2) did = go(P.tool, 'laptop', 'buy');
      else {
        // 会社から受ける開発の仕事は、いまからやる1件だけ受ける。作品は、作る → 半分で体験版 → 宣伝 → 終わりに不具合を直す
        const g = tr.gigs.find((q) => q.taken && q.job === 'softWork') ?? tr.gigs.find((q) => q.job === 'softWork');
        if (g && !g.taken) apply(s, city, { type: 'gig', id: g.id, take: true }, b);
        const pj = tr.proj;
        const need = pj ? Math.round(b.jobs[pj.job].hours * b.time.quotaScale) : 0;
        const today = quit || (run.picks[run.months]?.[`d${Math.floor(s.clock / 1440)}`] ?? 0) >= 1; // 勤めている間は、先にアルバイトを1回
        for (const t of tr.titles) if (t.sale === undefined && s.eco.days / b.time.daysPerMonth - t.month >= 2) apply(Object.assign(s, { x: P.home.x, y: P.home.y }), city, { type: 'poi', id: P.home.id, act: 'devSale' }, b);
        if (!pj) did = go(P.home, fameOf(tr, 'soft') >= 20 ? 'devMid' : 'devSmall', 'start');
        else if (!pj.out && s.cash >= b.money.devOut + living * 3) did = go(P.home, 'devOut', 'buy');
        else if (!today) did = false;
        else if (g) did = go(P.home, 'deskGig', 'softWork');
        else if (!pj.demo && pj.hours >= need * b.soft.demoAt) did = go(P.home, 'demo', 'demo');
        else if (pj.hours >= need * 0.6 && (pj.hype ?? 0) < 30 + (pj.demo ? b.soft.demoHype : 0)) did = go(P.home, 'promo', 'promo');
        else if (pj.hours >= need * 0.8 && (pj.q ?? 50) < b.soft.qBase + b.soft.fixGain * 3) did = go(P.home, 'fix', 'fix');
        else if (tr.titles.some((t) => (t.upd ?? 0) < 1) && (run.picks[run.months]?.update ?? 0) < 1) did = go(P.home, 'devUpdate', 'update');
        else if (pitched < 1 && h < 18 && !quit) {
          did = go(P.market, 'pitchSoft', 'pitch');
          pitched += did ? 1 : 0;
        } else did = go(P.home, 'dev', pj.job);
      }
    }
    if (!did && !quit && h < 16) {
      did = go(P.job, 'work', 'baito');
      if (did && model === 'soft') (run.picks[run.months] ??= {})[`d${Math.floor(s.clock / 1440)}`] = 1;
    }
    if (!did) {
      // することがなければ、休むか寝る
      if (h >= 18 || !go(P.home, 'rest', 'rest')) sleep();
    }
  }
  run.money = money();
  if (guard >= months * 200) run.stuck = true;
  return run;
}

// 手の偏り：月ごとに、いちばん選ばれた手の割合（寝る・買う・始めるは、手に数えない）
const HANDS = ['baito', 'craftSmall', 'craftOrder', 'sell', 'pitch', 'handyTidy', 'handyClean', 'handyWash', 'softSmall', 'softMid', 'softWork', 'demo', 'promo', 'fix', 'update', 'rest'];
export function topShare(runs: Run[], months: number): number {
  let worst = 0;
  for (let m = 0; m < months; m++) {
    const sum: Record<string, number> = {};
    for (const r of runs) for (const k of HANDS) sum[k] = (sum[k] ?? 0) + (r.picks[m]?.[k] ?? 0);
    const all = Object.values(sum).reduce((a, v) => a + v, 0);
    if (all > 0) worst = Math.max(worst, Math.max(...Object.values(sum)) / all);
  }
  return worst;
}
const many = (model: Model, months: number, n = RUNS) => Array.from({ length: n }, (_, i) => play(model, 1000 + i * 7919, months));
const rate = (runs: Run[], f: (r: Run) => boolean) => runs.filter(f).length / runs.length;
const med = (a: number[]) => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)] ?? 0;

describe('受け入れ条件のシミュレーター', () => {
  it('同じ種と同じ模型なら、同じ結果になる', () => {
    for (const m of ['craft', 'handy', 'soft', 'random'] as const) expect(play(m, 4242, 6)).toEqual(play(m, 4242, 6));
  });
  it('止まらない：でたらめに遊んでも、進めなくなる回が 0', () => {
    const runs = many('random', 12);
    expect(runs.filter((r) => r.stuck).length).toBe(0);
    expect(runs.every((r) => r.months === 12 || r.broke >= 0)).toBe(true);
  });
  it('ふつうに遊ぶ模型は、どの商売でも止まらずに最後まで進む', () => {
    for (const m of ['craft', 'handy', 'soft'] as const) {
      const runs = many(m, 12, Math.min(RUNS, 40));
      expect(runs.filter((r) => r.stuck).length).toBe(0);
    }
  });
  it.skipIf(!FULL)('受け入れ条件の表（各 1,000回）', () => {
    const craft = many('craft', 12);
    const handy = many('handy', 12);
    const soft = many('soft', 24);
    const random = many('random', 12);
    const row = (name: string, got: string, want: string, ok: boolean) => console.log(`${ok ? '○' : '×'} ${name}　${got}（合格の線：${want}）`);
    const ind = (runs: Run[]) => rate(runs, (r) => r.indep >= 0);
    console.log('--- 受け入れ条件（各 ' + RUNS + '回） ---');
    row('独立までの速さ・手作りの品（12か月以内）', `${Math.round(ind(craft) * 100)}%・中央値 ${med(craft.filter((r) => r.indep >= 0).map((r) => r.indep))}か月目`, '6割以上', ind(craft) >= 0.6);
    row('独立までの速さ・便利屋（12か月以内）', `${Math.round(ind(handy) * 100)}%・中央値 ${med(handy.filter((r) => r.indep >= 0).map((r) => r.indep))}か月目`, '6割以上', ind(handy) >= 0.6);
    row('独立までの速さ・個人開発（24か月以内）', `${Math.round(ind(soft) * 100)}%・中央値 ${med(soft.filter((r) => r.indep >= 0).map((r) => r.indep))}か月目`, '6割以上', ind(soft) >= 0.6);
    const br = rate(random, (r) => r.broke >= 0);
    row('でたらめへの厳しさ（12か月以内にやり直し）', `${Math.round(br * 100)}%`, '8割以上', br >= 0.8);
    for (const [n, runs, mo] of [['手作りの品', craft, 12], ['便利屋', handy, 12], ['個人開発', soft, 24]] as const) {
      const t = topShare(runs, mo);
      row(`手の偏り・${n}（いちばん選ばれる手）`, `${Math.round(t * 100)}%`, '6割以下', t <= 0.6);
    }
    const tAll = topShare([...craft, ...handy, ...soft], 12);
    row('手の偏り・3つの商売を合わせて', `${Math.round(tAll * 100)}%`, '6割以下', tAll <= 0.6);
    const stuck = [craft, handy, soft, random].flat().filter((r) => r.stuck).length;
    row('止まらない', `進めなくなった回 ${stuck}`, '0', stuck === 0);
    console.log(`参考：12か月目のお金（中央値）　手作り ${med(craft.map((r) => r.money))}・便利屋 ${med(handy.map((r) => r.money))}・でたらめ ${med(random.map((r) => r.money))}　／　倒産　手作り ${Math.round(rate(craft, (r) => r.broke >= 0) * 100)}%・便利屋 ${Math.round(rate(handy, (r) => r.broke >= 0) * 100)}%・個人開発 ${Math.round(rate(soft, (r) => r.broke >= 0) * 100)}%`);
    expect(stuck).toBe(0);
  }, 600000);
});
