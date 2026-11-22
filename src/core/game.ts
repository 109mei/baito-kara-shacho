// ルール本体。画面・DOM・PixiJS・React を一切知らない。
// 状態（GameState）を持つのはここだけで、書き換えは「命令」と「1日進める」だけで行う。
import type { Balance } from '../data/schema';
import type {
  Biz, BizState, Command, GameEvent, GameState, Helper, JobKey, MonthAcc, MonthReport, Order, OrderBiz, Quality, Slot,
} from './types';

export const SAVE_VERSION = 1;
export const BIZ_LIST: Biz[] = ['craft', 'handy', 'dev'];
export const JOB_BIZ: Record<JobKey, OrderBiz> = { small: 'craft', order: 'craft', tidy: 'handy', clean: 'handy' };

// ---- 乱数（種つき。状態の中に持つので、同じ種と同じ操作なら同じ結果になる） ----
function rand(s: GameState): number {
  s.rng = (s.rng + 0x6d2b79f5) | 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function randInt(s: GameState, a: number, b: number): number {
  return a + Math.floor(rand(s) * (b - a + 1));
}

// ---- 日付 ----
export function dayInfo(day: number, b: Balance) {
  const dim = b.time.daysPerMonth;
  const dayInMonth = day % dim;
  const month = Math.floor(day / dim);
  return { month, year: Math.floor(month / 12), monthInYear: month % 12, dayInMonth, dow: dayInMonth % 7, weekday: dayInMonth % 7 < 5 };
}

function emptyAcc(): MonthAcc {
  return {
    jobH: 0, salesCraft: 0, salesHandy: 0, devRevenue: 0, materials: 0, tools: 0,
    delivered: { small: 0, order: 0, tidy: 0, clean: 0 },
    failed: { craft: 0, handy: 0 }, great: { craft: 0, handy: 0 }, sellTrips: 0,
  };
}

function jobBlock(b: Balance): [number, number] {
  return [b.job.startSlot, b.job.startSlot + b.job.hours];
}

export function baseTemplate(kind: 'weekday' | 'holiday', employed: boolean, b: Balance): Slot[] {
  const t: Slot[] = Array.from({ length: b.time.slotsPerDay }, () => 'rest' as Slot);
  if (kind === 'weekday' && employed) {
    const [a, z] = jobBlock(b);
    for (let i = a; i < z; i++) t[i] = 'job';
  }
  return t;
}

export function createGame(seed: number, b: Balance): GameState {
  const biz = (): BizState => ({ started: false, fame: 0, tool: false });
  return {
    v: SAVE_VERSION, seed, rng: seed | 0, day: 0, phase: 'pick', employed: true,
    cash: b.player.startCash, mats: 0, shopTarget: b.mats.startTarget, sellTarget: 'craft', sellProgress: 0,
    biz: { craft: biz(), handy: biz(), dev: biz() },
    templates: { weekday: baseTemplate('weekday', true, b), holiday: baseTemplate('holiday', true, b) },
    orders: [], nextId: 1, project: null, titles: [], devSold: 0, receivable: 0,
    helpers: [], candidates: [], acc: emptyAcc(), reports: [],
    unpaidStreak: 0, goodStreak: 0, achieved: false, restarts: 0, endedShown: false,
    lastOutflow: b.player.living, autoQuality: false,
  };
}

// ---- 仕事の時間 ----
/** 1つ仕上げるのにかかる時間（分）。work は人で変わる分、fixed は移動など変わらない分。 */
export function unitStd(s: GameState, job: JobKey, b: Balance): { work: number; fixed: number; mat: number } {
  if (job === 'small' || job === 'order') {
    const d = b.craft[job];
    const asm = d.assemble * (s.biz.craft.tool ? b.craft.tool.assembleFactor : 1);
    return { work: d.cut + asm + d.finish, fixed: 0, mat: d.mat };
  }
  const d = b.handy[job];
  return { work: d.work, fixed: d.move, mat: d.mat };
}

export function helperFactor(h: Helper, biz: Biz, b: Balance): number {
  return b.helper.slowFactor - (b.helper.slowFactor - 1) * h.habit[biz];
}

/** 自分でやったときに、その話を全部終えるのに残っている時間（分） */
export function orderMinutesLeft(s: GameState, o: Order, b: Balance): number {
  const u = unitStd(s, o.job, b);
  const per = u.work * b.quality[o.quality] + u.fixed;
  return (o.qty - o.doneUnits - o.progress) * per;
}

function pushOnce(ev: GameEvent[], e: GameEvent) {
  if (e.type === 'short' && ev.some((x) => x.type === 'short' && x.what === e.what)) return;
  ev.push(e);
}

function deliver(s: GameState, o: Order, ev: GameEvent[]) {
  o.status = 'done';
  const amount = o.qty * o.unitPrice;
  s.cash += amount;
  if (o.biz === 'craft') s.acc.salesCraft += amount;
  else s.acc.salesHandy += amount;
  s.acc.delivered[o.job] += o.qty;
  if (o.quality === 'great') s.acc.great[o.biz] += 1;
  ev.push({ type: 'delivered', id: o.id, amount });
}

/** minutes 分だけ、その商売の受けた話を進める。使った分を返す。 */
function workOn(s: GameState, biz: OrderBiz, minutes: number, helper: Helper | null, b: Balance, ev: GameEvent[]): number {
  let left = minutes;
  const blocked = new Set<number>();
  const factor = helper ? helperFactor(helper, biz, b) : 1;
  for (let guard = 0; guard < 500 && left > 0.01; guard++) {
    const list = s.orders
      .filter((o) => o.status === 'active' && o.biz === biz && !blocked.has(o.id))
      .filter((o) => !(helper && o.job === 'clean' && helper.habit.handy < 1))
      .sort((x, y) => x.deadline - y.deadline || x.id - y.id);
    const o = list[0];
    if (!o) break;
    const u = unitStd(s, o.job, b);
    if (!o.matPaid) {
      if (u.mat > 0 && s.mats < u.mat) {
        pushOnce(ev, { type: 'short', what: 'mats' });
        blocked.add(o.id);
        continue;
      }
      s.mats -= u.mat;
      o.matPaid = true;
    }
    const need = u.work * factor * b.quality[o.quality] + u.fixed;
    const remain = (1 - o.progress) * need;
    const use = Math.min(left, remain);
    o.progress += use / need;
    left -= use;
    if (o.progress >= 1 - 1e-9) {
      o.doneUnits += 1;
      o.progress = 0;
      o.matPaid = false;
      if (o.doneUnits >= o.qty) deliver(s, o, ev);
    }
  }
  return minutes - left;
}

export function devFirstSales(s: GameState, kind: 'small' | 'normal', outsource: boolean, hit: number, b: Balance): number {
  const d = b.dev[kind];
  const fame = Math.min(s.biz.dev.fame, b.dev.fameCap);
  return Math.round((d.base + d.perFame * fame) * (outsource ? b.dev.outsource.salesFactor : 1) * hit);
}

function devWork(s: GameState, hours: number, b: Balance, ev: GameEvent[]): number {
  const p = s.project;
  if (!p || hours <= 0) return 0;
  const use = Math.min(hours, p.leftH);
  p.leftH -= use;
  if (p.leftH <= 1e-9) {
    const d = b.dev[p.kind];
    const first = p.totalH < 10 ? 5 : devFirstSales(s, p.kind, p.outsource, p.hit, b);
    const id = s.nextId++;
    s.titles.push({ id, kind: p.kind, monthSales: first, net: Math.round(d.price * (1 - b.dev.fee)), tail: d.tail, sold: 0, releasedDay: s.day });
    s.project = null;
    ev.push({ type: 'released', titleId: id, first });
  }
  return use;
}

// ---- 届く話を作る ----
function addOrder(s: GameState, job: JobKey, qty: number, arriveDay: number, b: Balance, status: Order['status'] = 'pending'): Order {
  const biz = JOB_BIZ[job];
  const def = biz === 'craft' ? b.craft[job as 'small' | 'order'] : b.handy[job as 'tidy' | 'clean'];
  const u = unitStd(s, job, b);
  const extra = Math.floor((qty * (u.work + u.fixed)) / 240);
  const o: Order = {
    id: s.nextId++, biz, job, qty, unitPrice: def.price, arriveDay,
    answerBy: arriveDay + b.offer.answerDays - 1,
    deadline: arriveDay + randInt(s, def.dueMin, def.dueMax) + extra,
    status, doneUnits: 0, progress: 0, matPaid: false, quality: 'ok',
  };
  s.orders.push(o);
  return o;
}

export function jobCap(s: GameState, job: JobKey, b: Balance): number {
  const biz = JOB_BIZ[job];
  const st = s.biz[biz];
  if (!st.started) return 0;
  const def = biz === 'craft' ? b.craft[job as 'small' | 'order'] : b.handy[job as 'tidy' | 'clean'];
  const from = def.fameFrom ?? 0;
  if (st.fame < from) return 0;
  if (job === 'clean' && !st.tool) return 0;
  const cap = def.capBase + def.capFame * (st.fame - from);
  return def.capMax ? Math.min(def.capMax, cap) : cap;
}

/** fromDay から月末までの話を作る。月の途中なら、残りの日数の分だけ。 */
function genOffers(s: GameState, fromDay: number, b: Balance, jobs: JobKey[] = ['small', 'order', 'tidy', 'clean']) {
  const dim = b.time.daysPerMonth;
  const monthEnd = (Math.floor(fromDay / dim) + 1) * dim;
  const share = (monthEnd - fromDay) / dim;
  if (monthEnd - fromDay < 1) return;
  for (const job of jobs) {
    const cap = jobCap(s, job, b);
    if (cap <= 0) continue;
    const f = 1 - b.offer.fluct + rand(s) * b.offer.fluct * 2;
    let units = Math.round(cap * f * share);
    const def = JOB_BIZ[job] === 'craft' ? b.craft[job as 'small' | 'order'] : null;
    const qMin = def ? def.qtyMin : 1;
    const qMax = def ? def.qtyMax : 1;
    const scale = Math.max(1, (cap * share) / (8 * ((qMin + qMax) / 2)));
    for (let guard = 0; guard < 60 && units > 0; guard++) {
      const q = Math.max(1, Math.min(units, Math.round(randInt(s, qMin, qMax) * scale)));
      addOrder(s, job, q, randInt(s, fromDay, monthEnd - 1), b);
      units -= q;
    }
  }
}

function genCandidates(s: GameState, b: Balance) {
  s.candidates = [];
  for (let i = 0; i < b.helper.candidatesPerMonth; i++) {
    s.candidates.push({
      id: s.nextId++, face: randInt(s, 0, 5), speed: Math.round((0.6 + rand(s)) * 10) / 10,
      habit: { craft: 0, handy: 0, dev: 0 }, biz: null, hours: 4, workedH: 0,
    });
  }
}

function reveal(s: GameState, ev: GameEvent[]) {
  for (const o of s.orders) {
    if (o.status === 'pending' && o.arriveDay <= s.day) {
      o.status = 'offer';
      ev.push({ type: 'offer', id: o.id });
    }
  }
}

// ---- 時間割の決まり ----
export function workSlots(t: Slot[]): number {
  return t.filter((x) => x !== 'rest').length;
}

export function canSetSlot(s: GameState, kind: 'weekday' | 'holiday', index: number, slot: Slot, b: Balance): boolean {
  const t = s.templates[kind];
  if (index < 0 || index >= t.length) return false;
  if (slot === 'job') return false; // アルバイトの枠は自分では置けない
  if (t[index] === 'job') return false; // アルバイトの枠は動かせない
  if ((slot === 'craft' || slot === 'handy' || slot === 'dev') && !s.biz[slot].started) return false;
  if (slot === 'sell' && !s.biz.craft.started && !s.biz.handy.started) return false;
  if (slot === 'shop' && !s.biz.craft.started && !s.biz.handy.started) return false;
  if (slot !== 'rest' && t[index] === 'rest' && workSlots(t) >= b.time.maxWorkSlots) return false;
  return true;
}

function defaultSlots(s: GameState, biz: Biz, b: Balance) {
  // 始めたばかりの商売に、平日3時間・休日6時間を置く（空いているところだけ）
  const put = (kind: 'weekday' | 'holiday', from: number, n: number) => {
    const t = s.templates[kind];
    for (let i = from, c = 0; i < t.length && c < n; i++) {
      if (t[i] === 'rest' && workSlots(t) < b.time.maxWorkSlots) {
        t[i] = biz;
        c++;
      }
    }
  };
  put('weekday', b.job.startSlot + b.job.hours + 1, 3);
  put('holiday', 3, 6);
}

function startBiz(s: GameState, biz: Biz, b: Balance, ev: GameEvent[]) {
  const st = s.biz[biz];
  if (st.started) return;
  st.started = true;
  defaultSlots(s, biz, b);
  if (biz === 'craft') {
    s.sellTarget = s.biz.handy.started ? s.sellTarget : 'craft';
    s.mats += 10;
    addOrder(s, 'small', 1, s.day, b, 'offer').deadline = s.day + 2;
    genOffers(s, s.day + 1, b, ['small', 'order']);
  } else if (biz === 'handy') {
    s.sellTarget = s.biz.craft.started ? s.sellTarget : 'handy';
    addOrder(s, 'tidy', 1, s.day, b, 'offer').deadline = s.day + 2;
    genOffers(s, s.day + 1, b, ['tidy', 'clean']);
  } else if (!s.project && s.titles.length === 0) {
    // 最初だけ、仕上げが残った小さな作品から始まる
    s.project = { kind: 'small', totalH: 3, leftH: 3, outsource: false, hit: 1, quality: 'ok' };
  }
  reveal(s, ev);
}

// ---- 命令 ----
export function apply(s: GameState, cmd: Command, b: Balance): GameEvent[] {
  const ev: GameEvent[] = [];
  switch (cmd.type) {
    case 'pick':
      if (s.phase !== 'pick') break;
      s.phase = 'play';
      startBiz(s, cmd.biz, b, ev);
      genCandidates(s, b);
      break;
    case 'startBiz':
      if (s.phase === 'play') startBiz(s, cmd.biz, b, ev);
      break;
    case 'accept': {
      const o = s.orders.find((x) => x.id === cmd.id);
      if (o && o.status === 'offer') {
        o.status = 'active';
        o.quality = cmd.quality;
      }
      break;
    }
    case 'decline': {
      const o = s.orders.find((x) => x.id === cmd.id);
      if (o && o.status === 'offer') o.status = 'gone';
      break;
    }
    case 'setSlot':
      if (canSetSlot(s, cmd.kind, cmd.index, cmd.slot, b)) s.templates[cmd.kind][cmd.index] = cmd.slot;
      break;
    case 'setTemplate': {
      const t = s.templates[cmd.kind];
      for (let i = 0; i < t.length; i++) if (t[i] !== 'job') t[i] = 'rest';
      cmd.slots.forEach((slot, i) => {
        if (canSetSlot(s, cmd.kind, i, slot, b)) t[i] = slot;
      });
      break;
    }
    case 'setShopTarget':
      s.shopTarget = Math.max(0, Math.min(400, Math.round(cmd.value)));
      break;
    case 'setSellTarget':
      if (s.biz[cmd.biz].started) s.sellTarget = cmd.biz;
      break;
    case 'buyTool': {
      const st = s.biz[cmd.biz];
      const price = b[cmd.biz].tool.price;
      if (st.started && !st.tool && s.cash >= price) {
        s.cash -= price;
        s.acc.tools += price;
        st.tool = true;
        if (cmd.biz === 'handy') genOffers(s, s.day + 1, b, ['clean']);
      }
      break;
    }
    case 'startProject': {
      if (!s.biz.dev.started || s.project) break;
      const out = cmd.outsource && cmd.kind === 'normal';
      if (out && s.cash < b.dev.outsource.price) break;
      if (out) {
        s.cash -= b.dev.outsource.price;
        s.acc.tools += b.dev.outsource.price;
      }
      const hours = b.dev[cmd.kind].hours * (out ? b.dev.outsource.timeFactor : 1) * b.quality[cmd.quality];
      const hit = b.dev.hitMin + rand(s) * (b.dev.hitMax - b.dev.hitMin);
      s.project = { kind: cmd.kind, totalH: hours, leftH: hours, outsource: out, hit, quality: cmd.quality };
      break;
    }
    case 'hire': {
      const i = s.candidates.findIndex((c) => c.id === cmd.id);
      if (i >= 0 && s.helpers.length < b.helper.max) {
        const [h] = s.candidates.splice(i, 1);
        h.biz = BIZ_LIST.find((x) => s.biz[x].started) ?? null;
        s.helpers.push(h);
      }
      break;
    }
    case 'dismiss':
      s.helpers = s.helpers.filter((h) => h.id !== cmd.id);
      break;
    case 'assign': {
      const h = s.helpers.find((x) => x.id === cmd.id);
      if (h) {
        h.biz = cmd.biz && s.biz[cmd.biz].started ? cmd.biz : null;
        h.hours = Math.max(0, Math.min(8, Math.round(cmd.hours)));
      }
      break;
    }
    case 'quitJob':
      if (s.employed) {
        s.employed = false;
        s.templates.weekday = s.templates.weekday.map((x) => (x === 'job' ? 'rest' : x));
      }
      break;
    case 'returnJob':
      if (!s.employed) {
        s.employed = true;
        const t = s.templates.weekday;
        const [a, z] = jobBlock(b);
        for (let i = a; i < z; i++) t[i] = 'job';
        for (let i = t.length - 1; i >= 0 && workSlots(t) > b.time.maxWorkSlots; i--) if (t[i] !== 'job' && t[i] !== 'rest') t[i] = 'rest';
      }
      break;
    case 'setAuto':
      s.autoQuality = cmd.value;
      break;
    case 'closeMonth':
      if (s.phase === 'monthEnd') {
        const month = Math.floor(s.day / b.time.daysPerMonth);
        if (month >= b.time.endMonth && !s.endedShown) {
          s.endedShown = true;
          s.phase = 'ended';
        } else s.phase = 'play';
      }
      break;
    case 'continue':
      if (s.phase === 'ended') s.phase = 'play';
      break;
  }
  return ev;
}

// ---- 1日進める ----
function sellTrip(s: GameState, b: Balance) {
  let target: OrderBiz | null = s.biz[s.sellTarget].started ? s.sellTarget : null;
  if (!target) target = s.biz.craft.started ? 'craft' : s.biz.handy.started ? 'handy' : null;
  if (!target) return;
  s.acc.sellTrips += 1;
  if (target === 'craft') addOrder(s, 'small', b.craft.sellBonus, s.day + 1, b);
  else for (let i = 0; i < b.handy.sellBonus; i++) addOrder(s, 'tidy', 1, s.day + 1, b);
}

function shop(s: GameState, b: Balance, ev: GameEvent[]) {
  const need = s.shopTarget - s.mats;
  if (need <= 0) return;
  const buy = Math.max(0, Math.min(need, b.mats.perTrip, Math.floor(s.cash / b.mats.unitPrice)));
  if (buy <= 0) {
    pushOnce(ev, { type: 'short', what: 'cash' });
    return;
  }
  s.cash -= buy * b.mats.unitPrice;
  s.acc.materials += buy * b.mats.unitPrice;
  s.mats += buy;
}

export function advanceDay(s: GameState, b: Balance): GameEvent[] {
  const ev: GameEvent[] = [];
  if (s.phase !== 'play') return ev;
  const info = dayInfo(s.day, b);
  const t = info.weekday ? s.templates.weekday : s.templates.holiday;
  for (const slot of t) {
    if (slot === 'job') {
      if (s.employed && info.weekday) s.acc.jobH += 1;
    } else if (slot === 'craft' || slot === 'handy') workOn(s, slot, 60, null, b, ev);
    else if (slot === 'dev') devWork(s, 1, b, ev);
    else if (slot === 'sell') {
      s.sellProgress += 0.5;
      if (s.sellProgress >= 1) {
        s.sellProgress -= 1;
        sellTrip(s, b);
      }
    } else if (slot === 'shop') shop(s, b, ev);
  }
  if (info.weekday) {
    for (const h of s.helpers) {
      if (!h.biz || h.hours <= 0 || !s.biz[h.biz].started) continue;
      let usedH = 0;
      if (h.biz === 'dev') usedH = devWork(s, h.hours / helperFactor(h, 'dev', b), b, ev) * helperFactor(h, 'dev', b);
      else usedH = workOn(s, h.biz, h.hours * 60, h, b, ev) / 60;
      h.workedH += h.hours; // 入れたシフトの分は、仕事がなくても払う
      h.habit[h.biz] = Math.min(1, h.habit[h.biz] + (usedH * h.speed) / b.helper.habitHours);
    }
  }
  // 1日の終わり
  for (const o of s.orders) {
    if (o.status === 'offer' && o.answerBy <= s.day) o.status = 'gone';
    else if (o.status === 'active' && o.deadline <= s.day) {
      o.status = 'failed';
      s.acc.failed[o.biz] += 1;
      ev.push({ type: 'failed', id: o.id });
    }
  }
  s.day += 1;
  s.orders = s.orders.filter((o) => o.status === 'pending' || o.status === 'offer' || o.status === 'active' || s.day - o.deadline < 10);
  if (s.day % b.time.daysPerMonth === 0) {
    monthEnd(s, b);
    ev.push({ type: 'monthEnd' });
  }
  reveal(s, ev);
  return ev;
}

function monthEnd(s: GameState, b: Balance) {
  const a = s.acc;
  const q = b.quality;
  // 知名度
  const fameStep = (st: BizState, gain: number, delivered: number, great: number, failed: number) => {
    if (!st.started) return;
    let g = gain + great * q.greatFame - failed * q.failFame;
    if (delivered === 0) g -= q.idleFame;
    st.fame = Math.max(0, Math.round((st.fame + g) * 100) / 100);
  };
  fameStep(s.biz.craft, (a.delivered.small * b.craft.small.fameWeight + a.delivered.order * b.craft.order.fameWeight) / b.craft.fameDiv,
    a.delivered.small + a.delivered.order, a.great.craft, a.failed.craft);
  fameStep(s.biz.handy, (a.delivered.tidy * b.handy.tidy.fameWeight + a.delivered.clean * b.handy.clean.fameWeight) / b.handy.fameDiv,
    a.delivered.tidy + a.delivered.clean, a.great.handy, a.failed.handy);
  // 作品の売れ行き
  let devEarned = 0;
  for (const t of s.titles) {
    const n = Math.floor(t.monthSales);
    t.sold += n;
    s.devSold += n;
    devEarned += n * t.net;
    t.monthSales *= t.tail;
  }
  if (s.biz.dev.started) s.biz.dev.fame = Math.floor(s.devSold / b.dev.soldPerFame);
  // お金
  const month = Math.floor(s.day / b.time.daysPerMonth);
  const jobPay = a.jobH * b.job.wage;
  const devPaid = s.receivable;
  s.receivable = devEarned;
  const wages = s.helpers.reduce((sum, h) => sum + h.workedH * b.helper.wage, 0);
  const living = b.player.living;
  const prevEnd = s.reports.length ? s.reports[s.reports.length - 1].cashEnd : b.player.startCash;
  s.cash += jobPay + devPaid - wages - living;
  const unpaid = s.cash < 0;
  s.unpaidStreak = unpaid ? s.unpaidStreak + 1 : 0;
  const restarted = s.unpaidStreak >= 2;
  let achievedNow = false;
  if (!s.employed && !restarted && s.cash >= prevEnd && !unpaid) s.goodStreak += 1;
  else s.goodStreak = 0;
  if (s.goodStreak >= 3 && !s.achieved) {
    s.achieved = true;
    achievedNow = true;
  }
  const rep: MonthReport = {
    month, jobPay, salesCraft: a.salesCraft, salesHandy: a.salesHandy, devPaid, devEarned,
    materials: a.materials, wages, tools: a.tools, living,
    bizProfit: a.salesCraft + a.salesHandy + devEarned - a.materials - wages,
    cashStart: prevEnd, cashEnd: s.cash,
    fame: { craft: s.biz.craft.fame, handy: s.biz.handy.fame, dev: s.biz.dev.fame },
    employed: s.employed, unpaid, restarted, achievedNow,
  };
  s.lastOutflow = a.materials + wages + living;
  s.reports.push(rep);
  s.acc = emptyAcc();
  for (const h of s.helpers) h.workedH = 0;
  if (restarted) restart(s, b);
  genCandidates(s, b);
  genOffers(s, s.day, b);
  s.phase = 'monthEnd';
}

function restart(s: GameState, b: Balance) {
  s.cash = b.player.restartCash;
  s.employed = true;
  s.unpaidStreak = 0;
  s.goodStreak = 0;
  s.restarts += 1;
  s.helpers = [];
  s.orders = [];
  s.sellProgress = 0;
  for (const k of BIZ_LIST) s.biz[k].fame = Math.floor(s.biz[k].fame / 2);
  s.templates = { weekday: baseTemplate('weekday', true, b), holiday: baseTemplate('holiday', true, b) };
  for (const k of BIZ_LIST) if (s.biz[k].started) defaultSlots(s, k, b);
}

// ---- 画面とボットが使う、状態の読み取り ----
export function daysOfCash(s: GameState, b: Balance): number {
  const perDay = Math.max(1, s.lastOutflow) / b.time.daysPerMonth;
  return Math.max(0, Math.floor(s.cash / perDay));
}

export function plannedMinutes(s: GameState, biz: Biz, b: Balance): { weekday: number; holiday: number } {
  const count = (t: Slot[]) => t.filter((x) => x === biz).length * 60;
  const helper = s.helpers.filter((h) => h.biz === biz).reduce((sum, h) => sum + (h.hours * 60) / helperFactor(h, biz, b), 0);
  return { weekday: count(s.templates.weekday) + helper, holiday: count(s.templates.holiday) };
}

/** 今日から deadline の日までに、いまの時間割で使える分 */
export function minutesUntil(s: GameState, biz: Biz, deadline: number, b: Balance): number {
  const p = plannedMinutes(s, biz, b);
  let m = 0;
  for (let d = s.day; d <= deadline; d++) m += dayInfo(d, b).weekday ? p.weekday : p.holiday;
  return m;
}

export type Need = { kind: 'cash'; days: number } | { kind: 'deadline'; id: number } | { kind: 'mats' } | { kind: 'time'; biz: Biz } | null;

/** いまいちばん足りないもの（1つだけ） */
export function needOf(s: GameState, b: Balance): Need {
  if (s.phase === 'pick') return null;
  const days = daysOfCash(s, b);
  if (days < 14) return { kind: 'cash', days };
  for (const biz of ['craft', 'handy'] as OrderBiz[]) {
    const act = s.orders.filter((o) => o.status === 'active' && o.biz === biz).sort((x, y) => x.deadline - y.deadline);
    let load = 0;
    for (const o of act) {
      load += orderMinutesLeft(s, o, b);
      if (o.deadline - s.day <= 3 && load > minutesUntil(s, biz, o.deadline, b) + 1) return { kind: 'deadline', id: o.id };
    }
  }
  const matNeed = s.orders
    .filter((o) => o.status === 'active')
    .reduce((sum, o) => sum + (o.qty - o.doneUnits - (o.matPaid ? 1 : 0)) * unitStd(s, o.job, b).mat, 0);
  if (matNeed > s.mats) return { kind: 'mats' };
  for (const biz of BIZ_LIST) {
    if (!s.biz[biz].started) continue;
    const hasWork = biz === 'dev' ? !!s.project : s.orders.some((o) => o.status === 'active' && o.biz === biz);
    const p = plannedMinutes(s, biz, b);
    if (hasWork && p.weekday + p.holiday === 0) return { kind: 'time', biz };
  }
  return null;
}

/** 発売した月に売れる本数の見込み（幅） */
export function devForecast(s: GameState, kind: 'small' | 'normal', outsource: boolean, b: Balance): [number, number] {
  return [devFirstSales(s, kind, outsource, b.dev.hitMin, b), devFirstSales(s, kind, outsource, b.dev.hitMax, b)];
}

export function qualityOrAuto(s: GameState, q: Quality): Quality {
  return s.autoQuality ? 'ok' : q;
}

export function clone(s: GameState): GameState {
  return JSON.parse(JSON.stringify(s)) as GameState;
}
