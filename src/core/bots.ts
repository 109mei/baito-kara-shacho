// 遊ぶ人の模型（ボット）。ルール本体と同じ命令だけを使って遊ぶ。数値の調整とテストに使う。
import type { Balance } from '../data/schema';
import { advanceDay, apply, dayInfo, minutesUntil, orderMinutesLeft, unitStd } from './game';
import type { Biz, GameState, OrderBiz, Slot } from './types';

export type BotKind = 'normal' | 'outsource' | 'smallOnly' | 'noTool' | 'rash' | 'random';

function mulberry(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fill(s: GameState, kind: 'weekday' | 'holiday', want: Slot[], b: Balance) {
  // want を、空いている枠に前から順に置く
  const t = s.templates[kind];
  const slots: Slot[] = t.map((x) => (x === 'job' ? 'job' : 'rest'));
  let k = 0;
  const start = kind === 'weekday' && s.employed ? b.job.startSlot + b.job.hours : 2;
  for (let i = start; i < slots.length && k < want.length; i++) if (slots[i] === 'rest') slots[i] = want[k++];
  for (let i = 0; i < start && k < want.length; i++) if (slots[i] === 'rest') slots[i] = want[k++];
  apply(s, { type: 'setTemplate', kind, slots }, b);
}

function planDay(s: GameState, biz: Biz, kind: BotKind, b: Balance) {
  const info = dayInfo(s.day, b);
  const key = info.weekday ? 'weekday' : 'holiday';
  const hours = info.weekday ? (s.employed ? 3 : 9) : 6;
  const want: Slot[] = [];
  if (biz !== 'dev') {
    const ob = biz as OrderBiz;
    const need = s.orders
      .filter((o) => o.status === 'active')
      .reduce((sum, o) => sum + (o.qty - o.doneUnits - (o.matPaid ? 1 : 0)) * unitStd(s, o.job, b).mat, 0);
    if (need > s.mats) {
      apply(s, { type: 'setShopTarget', value: need + 10 }, b);
      want.push('shop');
    }
    const fameGoal = ob === 'craft' ? b.craft.order.fameFrom ?? 20 : b.handy.clean.fameFrom ?? 10;
    const sellDay = !info.weekday && info.dayInMonth < 14;
    if (kind !== 'rash' && sellDay && s.biz[ob].fame < fameGoal) want.push('sell', 'sell');
  }
  for (let i = 0; i < hours; i++) want.push(biz);
  fill(s, key, want, b);
}

function takeOffers(s: GameState, biz: OrderBiz, b: Balance) {
  const worth = (job: string) => (job === 'order' || job === 'clean' ? 0 : 1);
  const offers = s.orders.filter((o) => o.status === 'offer' && o.biz === biz).sort((x, y) => worth(x.job) - worth(y.job) || x.deadline - y.deadline);
  for (const o of offers) {
    const active = s.orders.filter((x) => x.status === 'active' && x.biz === biz && x.deadline <= o.deadline);
    const load = active.reduce((sum, x) => sum + orderMinutesLeft(s, x, b), 0) + orderMinutesLeft(s, o, b);
    // 今日の予定は planDay のあとなので、時間割から使える時間を見積もれる
    if (load <= minutesUntil(s, biz, o.deadline, b) * 0.9) apply(s, { type: 'accept', id: o.id, quality: 'ok' }, b);
    else if (o.answerBy <= s.day) apply(s, { type: 'decline', id: o.id }, b);
  }
}

/** 1日ぶん遊ぶ（朝に決めて、1日進める） */
export function botDay(s: GameState, biz: Biz, kind: BotKind, b: Balance, r: () => number) {
  if (s.phase === 'pick') apply(s, { type: 'pick', biz }, b);
  if (s.phase === 'monthEnd') {
    const rep = s.reports[s.reports.length - 1];
    const last3 = s.reports.slice(-3);
    const avg = last3.reduce((sum, x) => sum + x.bizProfit, 0) / Math.max(1, last3.length);
    const profit = biz === 'dev' ? avg : rep.bizProfit;
    if (s.employed && kind !== 'random') {
      if (kind === 'rash' || profit >= b.player.living * 1.1) apply(s, { type: 'quitJob' }, b);
    }
    apply(s, { type: 'closeMonth' }, b);
  }
  if (s.phase === 'ended') apply(s, { type: 'continue' }, b);

  if (kind === 'random') {
    randomMoves(s, b, r);
  } else {
    planDay(s, biz, kind, b);
    if (biz === 'dev') {
      if (!s.project) {
        const first = s.titles.length <= 1;
        const k = kind === 'smallOnly' || (first && kind !== 'rash') ? 'small' : 'normal';
        const out = kind === 'outsource' && k === 'normal' && s.cash >= 150000;
        apply(s, { type: 'startProject', kind: k, outsource: out, quality: 'ok' }, b);
      }
    } else {
      takeOffers(s, biz, b);
      const st = s.biz[biz];
      if (kind !== 'noTool' && kind !== 'rash' && !st.tool && s.cash >= 110000 && (biz === 'craft' || st.fame >= 8)) apply(s, { type: 'buyTool', biz }, b);
    }
  }
  return advanceDay(s, b);
}

function randomMoves(s: GameState, b: Balance, r: () => number) {
  const all: Slot[] = ['rest', 'craft', 'handy', 'dev', 'sell', 'shop'];
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  if (r() < 0.3) for (const biz of ['craft', 'handy', 'dev'] as Biz[]) if (r() < 0.1) apply(s, { type: 'startBiz', biz }, b);
  if (r() < 0.25) {
    const kind = r() < 0.5 ? 'weekday' : 'holiday';
    for (let i = 0; i < 6; i++) apply(s, { type: 'setSlot', kind, index: Math.floor(r() * b.time.slotsPerDay), slot: pick(all) }, b);
  }
  for (const o of s.orders.filter((x) => x.status === 'offer')) {
    const x = r();
    if (x < 0.5) apply(s, { type: 'accept', id: o.id, quality: pick(['great', 'ok', 'redo'] as const) }, b);
    else if (x < 0.7) apply(s, { type: 'decline', id: o.id }, b);
  }
  if (r() < 0.05) apply(s, { type: 'buyTool', biz: pick(['craft', 'handy'] as const) }, b);
  if (r() < 0.1) apply(s, { type: 'startProject', kind: pick(['small', 'normal'] as const), outsource: r() < 0.3, quality: 'ok' }, b);
  if (r() < 0.1) apply(s, { type: 'setShopTarget', value: Math.floor(r() * 120) }, b);
  if (r() < 0.05 && s.candidates.length) apply(s, { type: 'hire', id: s.candidates[0].id }, b);
  if (r() < 0.05 && s.helpers.length) apply(s, { type: 'assign', id: s.helpers[0].id, biz: pick(['craft', 'handy', 'dev', null] as const), hours: Math.floor(r() * 9) }, b);
  if (r() < 0.01 && s.helpers.length) apply(s, { type: 'dismiss', id: s.helpers[0].id }, b);
  if (r() < 0.02) apply(s, { type: s.employed ? 'quitJob' : 'returnJob' }, b);
  if (r() < 0.05) apply(s, { type: 'setSellTarget', biz: pick(['craft', 'handy'] as const) }, b);
}

export interface RunResult {
  quitMonth: number | null; // アルバイトを辞めた月（1から）
  achievedMonth: number | null; // 達成した月
  restartMonth: number | null; // 最初にやり直しになった月
  cashEnd: number;
  lastProfit: number;
}

export function runBot(s: GameState, biz: Biz, kind: BotKind, months: number, b: Balance, seed = 1): RunResult {
  const r = mulberry(seed * 7919 + 13);
  const res: RunResult = { quitMonth: null, achievedMonth: null, restartMonth: null, cashEnd: 0, lastProfit: 0 };
  const total = months * b.time.daysPerMonth;
  for (let guard = 0; guard < total * 3 && s.day < total; guard++) {
    const before = s.employed;
    botDay(s, biz, kind, b, r);
    const m = Math.floor(s.day / b.time.daysPerMonth) + 1;
    if (before && !s.employed && res.quitMonth === null) res.quitMonth = m;
    const rep = s.reports[s.reports.length - 1];
    if (rep && s.phase === 'monthEnd') {
      if (rep.achievedNow && res.achievedMonth === null) res.achievedMonth = rep.month;
      if (rep.restarted && res.restartMonth === null) res.restartMonth = rep.month;
    }
  }
  const rep = s.reports[s.reports.length - 1];
  res.cashEnd = s.cash;
  res.lastProfit = rep ? rep.bizProfit : 0;
  return res;
}
