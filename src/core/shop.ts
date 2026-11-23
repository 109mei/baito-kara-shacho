// 来店型の店（屋台・店）、人を雇う、物件を持つ（仕様書 7章・8章）。画面のことは知らない。
import type { Balance } from '../data/schema';

export interface Tally { cust: number; lost: number; sales: number; cost: number }
const zero = (): Tally => ({ cust: 0, lost: 0, sales: 0, cost: 0 });
export interface Shop {
  poi: number; type: 'stall' | 'shop';
  price: number; // 値段（相場を 1 として 0.7〜1.5）
  aware: number; // 認知（0〜100）。開店のときは 5。広告と口コミで上がる
  repute: number; // 評判（0〜100）。50 から始まる
  rent: number; deposit: number; // 1日の家賃、預けた保証金（たたむと戻る）
  boss: number; // 任せた店長（人の番号。0＝自分で見る）
  seen: number; // 最後に自分で店を見た日
  d: Tally; m: Tally; // きのう（最後に開けた日）と、今月の数字
}
export interface Staff {
  id: number; name: string; bio: string;
  skill: number; service: number; honest: number; lead: number; grow: number; // 技能、接客、まじめさ、まとめる力、育つ速さ
  ask: number; wage: number; // 希望の日給、いまの日給
  mood: number; // 不満（0〜100）
  exp: number; // 慣れ（0〜1）。40時間で 1
  at: number; // 働いている店（場所の番号。-1＝まだ決めていない）
  see: [number, number, number]; // 見えている度合い（技能・接客・まじめさ：0＝見えない、1＝±10、2＝±3、3＝正しく見える）
  months: number; quiet: number; // 働いた月、昇給も面談もない月
}
export interface Apart { poi: number; rent: number; state: number; paid: number } // 家賃（相場を 1 として）、建物の状態（0.5〜1）、買った値段
export interface Firm {
  staff: Staff[]; pool: Staff[]; nextStaff: number;
  post: { site: boolean; wage: number } | null; // 出している求人（張り紙か求人サイト、出した日給）
  asked: Record<number, number>; // 面接で使った質問の数（人ごと。3つまで）
  aparts: Apart[];
  permits: string[]; // 持っている資格・許可
}
export const newFirm = (): Firm => ({ staff: [], pool: [], nextStaff: 1, post: null, asked: {}, aparts: [], permits: [] });
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`;

// ---- 来店型：1時間の客数 ＝ 前を通る人 × 気づく割合 × 入る割合。さばけない分は帰る
export interface Hand { cap: number; service: number } // 1時間にさばける客の数と、接客
export const arriveRate = (z: Shop, traffic: number, bal: Balance) => {
  const S = bal.shop;
  const flow = (z.type === 'stall' ? S.stallFlow : S.shopFlow) / S.hours; // 1時間に前を通る人
  const notice = z.aware / 100; // 気づく割合
  const enter = clamp(0.1 * (1 / z.price) * (z.repute / 50), 0, 0.6); // 入る割合 ＝ 10% ×（相場 ÷ 値段）×（評判 ÷ 50）
  return flow * traffic * notice * enter;
};
// 店を hours 時間 開ける。perf＝店の回り具合（自分で見ていれば 1）
export function serve(z: Shop, hours: number, hands: Hand[], traffic: number, perf: number, bal: Balance): Tally {
  const S = bal.shop;
  const unit = z.type === 'stall' ? S.stallUnit : S.shopUnit;
  const rate = z.type === 'stall' ? S.stallCost : S.shopCost;
  const arrive = arriveRate(z, traffic, bal) * hours;
  const cap = hands.reduce((a, h) => a + h.cap, 0) * hours * perf;
  const cust = Math.floor(Math.min(arrive, cap));
  const lost = Math.max(0, Math.round(arrive - cust));
  const service = hands.length ? hands.reduce((a, h) => a + h.service, 0) / hands.length : 0;
  // 不満：待たされて帰った客と、接客が良くないときの一部
  const unhappy = lost + Math.round((cust * Math.max(0, 50 - service * perf)) / 100);
  z.repute = clamp(z.repute + (cust - unhappy) * S.happy - unhappy * S.unhappy, 0, 100);
  z.aware = clamp(z.aware + cust * S.mouth, 0, 100);
  const t: Tally = { cust, lost, sales: Math.round(cust * unit * z.price), cost: Math.round(cust * unit * rate) };
  for (const k of ['cust', 'lost', 'sales', 'cost'] as const) z.m[k] += t[k];
  return t;
}
// 人がいる店の1日。店長に任せた店の出来 ＝ 60 + まとめる力 × 0.6（%）。任せていない店は、その日に見ていないと回りが落ちる
export function dayShop(z: Shop, firm: Firm, traffic: number, day: number, bal: Balance): Tally {
  const S = bal.shop;
  const crew = firm.staff.filter((p) => p.at === z.poi);
  if (!crew.length) return (z.d = zero());
  const boss = crew.find((p) => p.id === z.boss);
  const perf = boss ? (60 + boss.lead * 0.6) / 100 : z.seen >= day ? 1 : S.unseen;
  const capHour = z.type === 'stall' ? S.stallCap : S.shopCap;
  const hands = crew.map((p) => ({ cap: capHour * (0.5 + 0.5 * p.exp) * (0.6 + p.skill / 250), service: p.service }));
  for (const p of crew) p.exp = Math.min(1, p.exp + (S.hours / bal.staff.expHours) * p.grow);
  return (z.d = serve(z, S.hours, hands, traffic, perf, bal));
}
// 開くための条件（審査に運はない）
export interface Cond { label: string; ok: boolean }
export function openConds(type: 'stall' | 'shop', traffic: number, rankIdx: number, cash: number, firm: Firm, bal: Balance): { conds: Cond[]; setup: number; deposit: number; rent: number } {
  const S = bal.shop;
  if (type === 'stall') {
    return { setup: bal.biz.stall, deposit: 0, rent: 0, conds: [{ label: '食品衛生の責任者の講習を受けている（窓口で1日）', ok: firm.permits.includes('food') }, { label: `道具と屋台の代金 ${yen(bal.biz.stall)}（表のお金）`, ok: cash >= bal.biz.stall }] };
  }
  const rent = Math.round((S.shopRent * traffic) / 100) * 100;
  const months = rankIdx >= 1 ? S.depositMonths : S.depositMonthsE; // 入居の審査：ランク D 以上。E でも保証金を増やせば通る
  const deposit = rent * bal.time.daysPerMonth * months;
  return { setup: bal.biz.shop, deposit, rent, conds: [{ label: `保証金 家賃の${months}か月分 ${yen(deposit)}${rankIdx >= 1 ? '' : '（信用が D になると6か月分）'}`, ok: cash >= deposit + bal.biz.shop }, { label: `内装の代金 ${yen(bal.biz.shop)}（表のお金）`, ok: cash >= deposit + bal.biz.shop }] };
}
export const newShop = (type: 'stall' | 'shop', poi: number, rent: number, deposit: number, day: number, bal: Balance): Shop => ({ poi, type, price: 1, aware: bal.shop.awareStart, repute: 50, rent, deposit, boss: 0, seen: day, d: zero(), m: zero() });

// ---- 人：集まらない・見抜けない・辞める。どれも、起きる前に兆しが見える
const NAMES = ['佐藤', '鈴木', '高橋', '田中', '伊藤', '渡辺', '山本', '中村', '小林', '加藤', '吉田', '山田', '松本', '井上', '木村', '林', '清水', '山口'];
export function makeStaff(id: number, rnd: () => number, bal: Balance): Staff {
  const r = (lo: number, hi: number) => Math.round(lo + (hi - lo) * rnd());
  const skill = r(15, 90);
  const service = r(20, 90);
  const bio = skill > 65 ? '同じ仕事を5年' : skill > 40 ? '似た仕事を1年' : '未経験';
  const ask = Math.round((bal.staff.market * (0.85 + skill / 300 + rnd() * 0.15)) / 100) * 100;
  return { id, name: `${NAMES[Math.floor(rnd() * NAMES.length)]}さん`, bio, skill, service, honest: r(15, 95), lead: r(10, 95), grow: Math.round((0.5 + 1.5 * rnd()) * 10) / 10, ask, wage: ask, mood: 0, exp: 0, at: -1, see: [0, 0, 0], months: 0, quiet: 0 };
}
// 月の応募の数 ＝ 仕事を探している人 × 手段の届く割合 ×（出した日給 ÷ 相場）の2乗。相場より低いと、さらに5分の1
export const applyCount = (post: NonNullable<Firm['post']>, bal: Balance) => {
  const T = bal.staff;
  const k = post.wage / T.market;
  return Math.min(6, Math.round(T.seekers * (post.site ? T.site : T.paper) * k * k * (k < 1 ? 0.2 : 1)));
};
export function recruit(firm: Firm, rnd: () => number, bal: Balance) {
  firm.pool = [];
  firm.asked = {};
  if (!firm.post) return;
  const n = applyCount(firm.post, bal);
  for (let i = 0; i < n; i++) firm.pool.push(makeStaff(firm.nextStaff++, rnd, bal));
}
// 面接：質問は3つ。1つ使うと ±10 の幅で見え、同じ項目に2つ使うと ±3 まで狭まる。聞かなかった項目は見えない
export function askOne(firm: Firm, id: number, k: 0 | 1 | 2): boolean {
  const p = firm.pool.find((x) => x.id === id);
  if (!p || (firm.asked[id] ?? 0) >= 3 || p.see[k] >= 2) return false;
  firm.asked[id] = (firm.asked[id] ?? 0) + 1;
  p.see[k] += 1;
  return true;
}
// 見えている幅（[下, 上]）。見えていなければ null。幅は必ず本当の値を含むが、まん中とは限らない
export function seen(p: Staff, k: 0 | 1 | 2): [number, number] | null {
  const v = [p.skill, p.service, p.honest][k];
  const lv = p.see[k];
  if (lv <= 0) return null;
  if (lv >= 3) return [v, v];
  const w = lv === 1 ? 10 : 3;
  const off = ((p.id * 7 + k * 13) % (w + 1)) - Math.floor(w / 2);
  return [clamp(v + off - w, 0, 100), clamp(v + off + w, 0, 100)];
}
export function hire(firm: Firm, id: number, wage: number): Staff | null {
  const p = firm.pool.find((x) => x.id === id);
  if (!p) return null;
  firm.pool = firm.pool.filter((x) => x !== p);
  p.wage = wage;
  firm.staff.push(p);
  return p;
}
// 月末：不満がたまる。60 を超えると兆しが出て、80 を超えた翌月末に辞める。1か月働くと、数字がすべて正しく見える
export function monthStaff(firm: Firm, shops: Shop[], rnd: () => number, bal: Balance): { notes: string[]; quit: Staff[] } {
  const T = bal.staff;
  const notes: string[] = [];
  const quit = firm.staff.filter((p) => p.mood >= T.quit);
  for (const p of quit) {
    notes.push(`${p.name}が辞めた`);
    for (const z of shops) if (z.boss === p.id) z.boss = 0;
  }
  firm.staff = firm.staff.filter((p) => !quit.includes(p));
  for (const p of firm.staff) {
    p.months += 1;
    p.quiet += 1;
    p.see = [3, 3, 3];
    const low = Math.max(0, Math.round((1 - p.wage / T.market) * 100)); // 日給が相場より低い割合 1% につき +1
    p.mood = clamp(p.mood + low + (p.quiet >= 3 ? T.quiet : 0) + (p.at < 0 ? 5 : 0), 0, 100);
    if (p.mood >= T.quit) notes.push(`${p.name}：「話があります」`);
    else if (p.mood >= T.sign) notes.push(`${p.name}の遅刻が増えた`);
    else if (p.mood >= 40 && rnd() < 0.3) notes.push(`${p.name}に、ほかの会社から声がかかっている`);
  }
  return { notes, quit };
}
export const wagesOf = (firm: Firm, bal: Balance) => firm.staff.reduce((a, p) => a + p.wage, 0) * bal.time.daysPerMonth;

// ---- 資産型：月の収入 ＝ 単価 × 埋まっている割合 − 維持費
export const apartPrice = (traffic: number, bal: Balance) => Math.round((bal.apart.price * (0.6 + 0.4 * traffic)) / 10000) * 10000;
export const apartFill = (a: Apart, traffic: number) => clamp((Math.min(100, 55 * traffic) / 100) * (1 / a.rent) * a.state * 1.4, 0, 1); // 立地 ×（相場 ÷ 値段）× 状態
export const apartIncome = (a: Apart, traffic: number, bal: Balance) => Math.round(bal.apart.rooms * bal.apart.unit * a.rent * apartFill(a, traffic) - bal.apart.upkeep);
export const repairCost = (a: Apart, bal: Balance) => Math.round(((1 - a.state) * a.paid * bal.apart.repair) / 1000) * 1000;
