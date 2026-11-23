// 商売の共通の形（仕様書 6章）：仕事は数値の表の1行。知名度が届く話の数（月の枠）を決める。
// ここは入口の商売3つ（手作りの品・便利屋・個人開発）の決まり。画面のことは知らない。
import type { Balance } from '../data/schema';

export type Job = Balance['jobs'][string];
export interface Gig { id: number; job: string; poi: number; due: number; taken: boolean } // 届いた話（due＝期限の月）
export interface Title { job: string; month: number; first: number } // 発売した作品（発売した月と、その月の本数）
export interface Tr {
  fame: Record<string, number>; // 業種ごとの知名度
  quota: Record<string, number>; // 今月の枠（仕事ごと）
  used: Record<string, number>; // 今月こなした数（仕事ごと）
  mats: number; // 手作りの材料
  stock: Record<string, number>; // 作って、まだ売っていない品
  gigs: Gig[]; nextGig: number;
  pitch: Record<string, number>; // 今月の売り込みの回数（業種ごと）
  power: boolean; washer: boolean; // 電動の道具、洗浄の道具
  proj: { job: string; hours: number; out: boolean } | null; // 作っている作品
  titles: Title[];
  recv: { amount: number; due: number; what: string }[]; // あとで入るお金（翌月末）
  q: { sum: number; n: number }; // 今月の品質
  broken: number; // 今月、受けたのに守れなかった話
  jobs: number; // これまでにこなした便利屋の仕事の数（契約の「実績」）
  bids: Bid[]; deals: Deal[]; nextBid: number;
  rel: Record<number, number>; // 相手（場所）ごとの関係（0〜100）
  pro: Record<string, number>; // 許認可の要る仕事（建設・運送・警備）を、やり終えた月の数（入札の「実績」）
}
export const newTr = (): Tr => ({ fame: {}, quota: {}, used: {}, mats: 0, stock: {}, gigs: [], nextGig: 1, pitch: {}, power: false, washer: false, proj: null, titles: [], recv: [], q: { sum: 0, n: 0 }, broken: 0, jobs: 0, bids: [], deals: [], nextBid: 1, rel: {}, pro: {} });

export const fameOf = (tr: Tr, trade: string) => tr.fame[trade] ?? 0;
// 今月の枠（ゆらぐ前）。仕様書 6章の表
// 月が短い（1か月＝3日）ので、月の枠は仕様書の式に scale（数値の表の quotaScale）を掛ける
export function baseQuota(tr: Tr, job: Job, scale = 1): number {
  const f = fameOf(tr, job.trade);
  const p = tr.pitch[job.trade] ?? 0;
  if (job.tool === 'washer' && !tr.washer) return 0;
  if (f < job.fame) return 0;
  if (job.high) return Math.min(job.cap, job.slots + (f - job.fame) * job.perFame) * scale; // 高い仕事：知名度が届いてから
  return (job.slots + f * job.perFame + p * job.perPitch) * scale;
}
export const left = (tr: Tr, id: string) => Math.max(0, Math.floor((tr.quota[id] ?? 0) - (tr.used[id] ?? 0)));

// 月の初め：枠を決める（±10% ゆらぐ。ゆらいだあとの数が見える）。客先から届く話を作る
export function startMonth(tr: Tr, month: number, clients: number[], rnd: () => number, bal: Balance, k: Record<string, number> = {}) {
  tr.used = {};
  tr.q = { sum: 0, n: 0 };
  tr.broken = 0;
  tr.gigs = tr.gigs.filter((g) => g.taken && g.due >= month);
  for (const [id, job] of Object.entries(bal.jobs)) {
    if (job.kind === 'title') continue;
    const base = baseQuota(tr, job, bal.time.quotaScale);
    tr.quota[id] = (base > 0 ? Math.max(1, Math.round(base * (0.9 + 0.2 * rnd()) * (k.all ?? 1) * (k[job.trade] ?? 1))) : 0) + (k[id] ?? 0); // k＝景気と出来事の倍率
    if (job.kind !== 'visit' || !clients.length) continue;
    // 客先へ行く仕事は、1件ずつ話として届く
    const have = tr.gigs.filter((g) => g.job === id).length;
    for (let k = have; k < tr.quota[id]; k++) tr.gigs.push({ id: tr.nextGig++, job: id, poi: clients[Math.floor(rnd() * clients.length)], due: month, taken: false });
  }
  tr.pitch = {};
}
// 売り込み：その月の枠が増える
export function pitch(tr: Tr, trade: string, month: number, clients: number[], rnd: () => number, bal: Balance) {
  tr.pitch[trade] = (tr.pitch[trade] ?? 0) + 1;
  for (const [id, job] of Object.entries(bal.jobs)) {
    if (job.trade !== trade || job.high || job.kind === 'title' || fameOf(tr, trade) < job.fame) continue;
    const add = Math.max(1, Math.round(job.perPitch * bal.time.quotaScale));
    tr.quota[id] = (tr.quota[id] ?? 0) + add;
    if (job.kind === 'visit' && clients.length) for (let k = 0; k < add; k++) tr.gigs.push({ id: tr.nextGig++, job: id, poi: clients[Math.floor(rnd() * clients.length)], due: month, taken: false });
  }
}
// 作業にかかる分：慣れ（知識が30に満たない業種は遅い）、道具、疲れで変わる
export function workMins(job: Job, know: number, tr: Tr, fatigue: number): number {
  const skill = know < 30 ? 0.5 : 1; // 自分の慣れ
  const tool = job.trade === 'craft' && tr.power ? 0.75 : 1; // 電動の道具で、組む時間が半分
  const tired = fatigue > 80 ? 1.3 : fatigue > 60 ? 1.15 : 1;
  return Math.round(job.mins * (1.5 - 0.5 * skill) * tool * tired);
}
// 品質（0〜100）：材料4割・技能4割・道具2割。手でやる操作が上出来なら +5
export const quality = (know: number, tool: boolean, great: boolean) => Math.min(100, Math.round(0.4 * 50 + 0.4 * know + 0.2 * (tool ? 100 : 0) + (great ? 5 : 0)));
export function record(tr: Tr, id: string, n: number, q: number) {
  tr.used[id] = (tr.used[id] ?? 0) + n;
  tr.q.sum += q * n;
  tr.q.n += n;
}

// 作品（個人開発）：発売した月の本数 ＝ 基本 + 知名度 × 係数（知名度は40まで効く）。翌月からは決まった割合で減る
export const firstUnits = (job: Job, fame: number, out: boolean) => Math.round((job.slots + job.perFame * Math.min(40, fame)) * (out ? 1.3 : 1));
export const unitsAt = (job: Job, t: Title, month: number) => Math.round(t.first * Math.pow(job.decay, month - t.month));

export interface MonthEnd { income: number; notes: string[]; sold: number }
// 月末：作品の売上を数え（入金は翌月末）、届いていた入金を受け取り、知名度を更新する
export function endMonth(tr: Tr, month: number, bal: Balance): MonthEnd {
  const notes: string[] = [];
  let sold = 0;
  for (const t of tr.titles) {
    const job = bal.jobs[t.job];
    const u = unitsAt(job, t, month);
    if (u <= 0) continue;
    sold += u;
    tr.recv.push({ amount: u * job.price, due: month + 1, what: `${job.name}の売上` });
  }
  tr.titles = tr.titles.filter((t) => unitsAt(bal.jobs[t.job], t, month + 1) > 0);
  let income = 0;
  for (const r of tr.recv) if (r.due <= month) income += r.amount;
  tr.recv = tr.recv.filter((r) => r.due > month);
  // 受けたのに期限までにしなかった話
  const late = tr.gigs.filter((g) => g.taken && g.due <= month).length;
  tr.broken += late;
  tr.gigs = tr.gigs.filter((g) => !(g.due <= month));
  // 知名度：その月に納めた仕事から計算する。品質が良いと +1、悪いと −2、何も納めないと −1
  const trades = new Set(Object.values(bal.jobs).map((j) => j.trade));
  for (const trade of trades) {
    let pts = 0;
    let any = false;
    for (const [id, job] of Object.entries(bal.jobs)) {
      if (job.trade !== trade) continue;
      const n = job.kind === 'title' ? 0 : tr.used[id] ?? 0;
      if (n > 0) any = true;
      pts += n * job.famePts;
    }
    const div = trade === 'craft' ? 10 : trade === 'handy' ? 3 : 1;
    let up = trade === 'soft' ? sold / 40 : pts / div;
    if (trade === 'soft') any = sold > 0;
    const before = fameOf(tr, trade);
    if (any && trade !== 'soft' && tr.q.n > 0) {
      const avg = tr.q.sum / tr.q.n;
      if (avg >= 60) up += 1;
      else if (avg < 20) up -= 2;
    }
    if (!any && before > 0) up -= 1;
    if (trade !== 'soft') up -= late * 2;
    tr.fame[trade] = Math.max(0, Math.min(100, Math.round((before + up) * 10) / 10));
    if (tr.fame[trade] !== before) notes.push(`知名度（${TRADE_NAME[trade] ?? trade}） ${before} → ${tr.fame[trade]}`);
  }
  if (late) notes.push(`受けた話を ${late}件、期限までにできなかった`);
  return { income, notes, sold };
}
export const TRADE_NAME: Record<string, string> = { craft: '手作りの品', handy: '便利屋', soft: '個人開発', food: '屋台・飲食', retail: '店', logi: '倉庫・運送', estate: '大家', build: '請負' };

// ---- 契約型（仕様書 7章）：相手ごとに点をつけ、いちばん点の高い会社が受注する。運は入らない
// 契約の種類：clean＝自分が通う仕事（便利屋の実績から）。build・haul・guard＝許認可が要り、人を回してこなす
export type DealKind = 'clean' | 'build' | 'haul' | 'guard';
export const PRO_KINDS = ['build', 'haul', 'guard'] as const;
export const DEAL_NAME: Record<DealKind, string> = { clean: '定期の仕事', build: '建設', haul: '運送', guard: '警備' };
export interface Bid {
  id: number; poi: number; // 相手（場所の番号）
  kind?: DealKind; crew?: number; big?: boolean; // 種類、要る人数、入札（大きな仕事）か
  value: number; visits: number; months: number; // 月の代金、月に通う回数、続く月
  quote: number; // こちらの見積（相場を 1 として 0.9・1・1.1）
  calls: number; // 通った回数（3回通うと、相手が何を重く見るかが分かる）
  heavy: number; light: number; // 満点が 10 多い項目と、10 少ない項目（0 価格・1 実績・2 信用・3 関係・4 納期）
  rival: number; // いちばん強い競合の点
}
export interface Deal { poi: number; value: number; visits: number; left: number; done: number; kind?: DealKind; crew?: number } // left＝残りの月、done＝今月 通った回数
// いま、人を回す契約に取られている人数
export const crewUsed = (tr: Tr) => tr.deals.reduce((a, d) => a + (d.crew ?? 0), 0);
export const SCORE_NAMES = ['価格', '実績', '信用', '関係', '納期'];
const FULL = [30, 20, 20, 20, 10];
// 点の内訳（[価格, 実績, 信用, 関係, 納期]）
export function scoreParts(tr: Tr, bid: Bid, rankIdx: number, bal: Balance, crew = 0): number[] {
  const pro = bid.kind && bid.kind !== 'clean';
  const raw = [
    Math.min(1, 1 / bid.quote), // いちばん安い見積（競合は相場）が満点。高い分だけ減る
    Math.min(1, ((pro ? tr.pro[bid.kind!] ?? 0 : tr.jobs) * 4) / 20), // 同じ種類の仕事 1件で 4点。5件で満点
    rankIdx / 4, // E 0・D 5・C 10・B 15・A 20
    Math.min(1, (tr.rel[bid.poi] ?? 0) / 100), // 相手との関係 ÷ 5
    (pro ? crew - crewUsed(tr) >= (bid.crew ?? 0) : tr.deals.filter((d) => !d.crew).length < bal.deal.maxDeals) ? 1 : 0, // 手がいっぱいだと、納期に間に合わない
  ];
  return raw.map((r, i) => Math.round(r * (FULL[i] + (i === bid.heavy ? 10 : 0) - (i === bid.light ? 10 : 0)) * 10) / 10);
}
export const scoreOf = (tr: Tr, bid: Bid, rankIdx: number, bal: Balance, crew = 0) => Math.round(scoreParts(tr, bid, rankIdx, bal, crew).reduce((a, v) => a + v, 0) * 10) / 10;
// 月の初め：契約の話が届く（便利屋の実績が 3件 から）
// 許認可を持っていると、その種類の話が月に1つ届く。信用のランク B 以上で、同じ種類を 3か月 やり終えていると、入札（3倍の仕事）にも出られる
export function offerBids(tr: Tr, clients: number[], rnd: () => number, bal: Balance, permits: string[] = [], rankIdx = 0) {
  tr.bids = [];
  if (!clients.length) return;
  for (let k = 0; k < 2 && tr.jobs >= bal.deal.minJobs; k++) {
    const heavy = Math.floor(rnd() * 5);
    tr.bids.push({ id: tr.nextBid++, poi: clients[Math.floor(rnd() * clients.length)], value: Math.round((bal.deal.value * (0.8 + 0.6 * rnd())) / 1000) * 1000, visits: bal.deal.visits, months: bal.deal.months, quote: 1, calls: 0, heavy, light: (heavy + 1 + Math.floor(rnd() * 4)) % 5, rival: Math.round(45 + rnd() * 30) });
  }
  const P = bal.pro;
  const spec = { build: [P.buildValue, P.buildCrew, P.buildMonths], haul: [P.haulValue, P.haulCrew, P.haulMonths], guard: [P.guardValue, P.guardCrew, P.guardMonths] };
  for (const kind of PRO_KINDS) {
    if (!permits.includes(kind)) continue;
    const [value, crew, months] = spec[kind];
    const mk = (big: boolean) => {
      const heavy = Math.floor(rnd() * 5);
      const k = big ? P.big : 1;
      tr.bids.push({ id: tr.nextBid++, poi: clients[Math.floor(rnd() * clients.length)], kind, crew: crew * (big ? 2 : 1), big, value: Math.round((value * k * (0.8 + 0.4 * rnd())) / 1000) * 1000, visits: 1, months, quote: 1, calls: 0, heavy, light: (heavy + 1 + Math.floor(rnd() * 4)) % 5, rival: Math.round((big ? 60 : 40) + rnd() * 25) });
    };
    mk(false);
    if (rankIdx >= P.bigRank && (tr.pro[kind] ?? 0) >= P.bigJobs) mk(true);
  }
}
// 月末：通う回数を守れなかった契約は、代金の 10% を違約金として引かれ、関係が下がる。代金は翌月末に入る。話の勝ち負けを決める
// 人を回す契約（建設・運送・警備）は、契約に回した人が足りていれば、その月の仕事が終わる
export function settleDeals(tr: Tr, month: number, rankIdx: number, bal: Balance, crew = 0): string[] {
  const notes: string[] = [];
  let free = crew;
  for (const d of tr.deals) {
    if (d.crew) {
      if (free >= d.crew) {
        free -= d.crew;
        d.done = d.visits;
        tr.pro[d.kind!] = (tr.pro[d.kind!] ?? 0) + 1;
      } else {
        d.done = 0;
        notes.push(`${DEAL_NAME[d.kind!]}の契約に回す人が足りなかった（${d.crew}人 要る）`);
      }
    }
    const late = d.done < d.visits;
    const pay = Math.round(d.value * (late ? 1 - bal.deal.penalty : 1) * (d.done / d.visits >= 0.5 || !late ? 1 : 0.5));
    if (d.done > 0) tr.recv.push({ amount: pay, due: month + 1, what: '契約の代金' });
    if (late) {
      tr.rel[d.poi] = Math.max(0, (tr.rel[d.poi] ?? 0) - bal.deal.relLoss);
      if (!d.crew) notes.push('契約の回数を守れず、違約金を引かれた');
    }
    d.left -= 1;
    d.done = 0;
  }
  tr.deals = tr.deals.filter((d) => d.left > 0);
  for (const b2 of tr.bids) {
    const mine = scoreOf(tr, b2, rankIdx, bal, crew);
    // 同じ点なら、関係の高いほうが取る（競合の関係は 50 とみなす）
    if (mine > b2.rival || (mine === b2.rival && (tr.rel[b2.poi] ?? 0) > 50)) {
      tr.deals.push({ poi: b2.poi, value: Math.round((b2.value * b2.quote) / 1000) * 1000, visits: b2.visits, left: b2.months, done: 0, ...(b2.crew ? { kind: b2.kind, crew: b2.crew } : {}) });
      notes.push(b2.crew ? `${DEAL_NAME[b2.kind!]}の${b2.big ? '入札' : '契約'}が取れた（${mine}点・競合 ${b2.rival}点）。人を ${b2.crew}人 回す` : `契約が取れた（${mine}点・競合 ${b2.rival}点）。月に ${b2.visits}回 通う`);
    } else notes.push(`契約は競合に取られた（${mine}点・競合 ${b2.rival}点）`);
  }
  return notes;
}
