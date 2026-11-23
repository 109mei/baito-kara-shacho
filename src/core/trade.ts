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
}
export const newTr = (): Tr => ({ fame: {}, quota: {}, used: {}, mats: 0, stock: {}, gigs: [], nextGig: 1, pitch: {}, power: false, washer: false, proj: null, titles: [], recv: [], q: { sum: 0, n: 0 }, broken: 0 });

export const fameOf = (tr: Tr, trade: string) => tr.fame[trade] ?? 0;
// 今月の枠（ゆらぐ前）。仕様書 6章の表
export function baseQuota(tr: Tr, job: Job): number {
  const f = fameOf(tr, job.trade);
  const p = tr.pitch[job.trade] ?? 0;
  if (job.tool === 'washer' && !tr.washer) return 0;
  if (f < job.fame) return 0;
  if (job.high) return Math.min(job.cap, job.slots + (f - job.fame) * job.perFame); // 高い仕事：知名度が届いてから
  return job.slots + f * job.perFame + p * job.perPitch;
}
export const left = (tr: Tr, id: string) => Math.max(0, Math.floor((tr.quota[id] ?? 0) - (tr.used[id] ?? 0)));

// 月の初め：枠を決める（±10% ゆらぐ。ゆらいだあとの数が見える）。客先から届く話を作る
export function startMonth(tr: Tr, month: number, clients: number[], rnd: () => number, bal: Balance) {
  tr.used = {};
  tr.q = { sum: 0, n: 0 };
  tr.broken = 0;
  tr.gigs = tr.gigs.filter((g) => g.taken && g.due >= month);
  for (const [id, job] of Object.entries(bal.jobs)) {
    if (job.kind === 'title') continue;
    tr.quota[id] = Math.round(baseQuota(tr, job) * (0.9 + 0.2 * rnd()));
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
    tr.quota[id] = (tr.quota[id] ?? 0) + job.perPitch;
    if (job.kind === 'visit' && clients.length) for (let k = 0; k < job.perPitch; k++) tr.gigs.push({ id: tr.nextGig++, job: id, poi: clients[Math.floor(rnd() * clients.length)], due: month, taken: false });
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
