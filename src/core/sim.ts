// ルール本体：状態を持ち、決まった刻み（1/30秒）で進める。画面のことは知らない。
// 書き換えは「命令」（apply）と「1コマ進める」（step）だけで行う。乱数は種つき。
import type { Balance } from '../data/schema';
import { edgeArterial, findPath, nearestNode, neighbors, nodeXY, roadAt, solid, type City, type Poi, type PoiKind } from './city';

export const STEP = 1 / 30;
export const SAVE_VERSION = 1;

export type CarKind = 'npc' | 'parked' | 'police' | 'hunter' | 'mine' | 'stolen';
export interface Car { id: number; kind: CarKind; bike: boolean; x: number; y: number; a: number; v: number; color: number; from: number; to: number; s: number; chase: boolean; think: number; path: number[]; stuck: number; value: number }
export interface Ped { x: number; y: number; from: number; to: number; s: number; side: number; speed: number; color: number }
export interface Biz { poi: number; type: 'stall' | 'shop'; level: number }
export interface GameState {
  seed: number; rng: number; t: number;
  clock: number; // 始めてからの分（1日＝1440）
  x: number; y: number; a: number; ride: number | null;
  cash: number; dirty: number; bank: number; loot: number;
  heat: number; record: number;
  crowbar: boolean; laptop: boolean;
  biz: Biz[]; cool: Record<number, number>;
  way: [number, number] | null; route: number[];
  cars: Car[]; peds: Ped[]; nextId: number;
  seen: boolean; catchT: number; hitCd: number; spawnT: number;
  earned: number; crimes: number;
}
export type Ev =
  | { type: 'toast'; text: string; tone: 'good' | 'bad' | '' }
  | { type: 'busted'; fine: number; hours: number; lost: number }
  | { type: 'star'; stars: number }
  | { type: 'day'; living: number; profit: number; washed: number }
  | { type: 'skip' }
  | { type: 'sfx'; name: 'coin' | 'bigcoin' | 'crash' | 'door' | 'fail' | 'ok' };
export type Cmd =
  | { type: 'ride' }
  | { type: 'poi'; id: number; act: string; hits?: number }
  | { type: 'way'; x: number; y: number }
  | { type: 'noway' };
export interface Act { id: string; label: string; sub?: string; ok: boolean; why?: string; mini?: boolean; crime?: boolean }

export const POI_NAME: Record<PoiKind, string> = { home: '自宅', conbini: 'コンビニ', warehouse: '倉庫', bike: '自転車屋', car: '中古車屋', tool: '道具屋', pawn: '質屋', chop: '解体屋', bank: '銀行', police: '警察署', lot: '空き店舗', atm: 'ATM', house: '留守の家' };
const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const COLORS = [0xe2574c, 0xf2c14e, 0x4a94d2, 0xffffff, 0x8e9aa8, 0x3c4656, 0x6fae62, 0xd9822b];

function rnd(s: GameState): number {
  s.rng = (s.rng + 0x6d2b79f5) >>> 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function createGame(seed: number, city: City, bal: Balance): GameState {
  return {
    seed, rng: (seed ^ 0x9e3779b9) >>> 0, t: 0, clock: bal.time.startHour * 60,
    x: city.home.x, y: city.home.y + 4, a: Math.PI / 2, ride: null,
    cash: bal.money.startCash, dirty: 0, bank: 0, loot: 0, heat: 0, record: 0,
    crowbar: false, laptop: false, biz: [], cool: {}, way: null, route: [],
    cars: [], peds: [], nextId: 1, seen: false, catchT: 0, hitCd: 0, spawnT: 0, earned: 0, crimes: 0,
  };
}

export const stars = (s: GameState, bal: Balance) => (s.heat <= 0 ? 0 : Math.min(5, Math.ceil(s.heat / bal.heat.perStar)));
export const dayOf = (s: GameState) => Math.floor(s.clock / 1440);
export const hourOf = (s: GameState) => (s.clock % 1440) / 60;
export const isNight = (s: GameState) => hourOf(s) >= 20 || hourOf(s) < 5;
export const riding = (s: GameState) => (s.ride === null ? undefined : s.cars.find((c) => c.id === s.ride));
export function rank(s: GameState): string {
  const n = s.biz.length;
  return n >= 6 ? '大社長' : n >= 3 ? '社長' : n >= 1 ? '個人事業主' : 'アルバイト';
}
export function bizProfit(city: City, z: Biz, bal: Balance): number {
  const base = z.type === 'stall' ? bal.biz.stallProfit : bal.biz.shopProfit;
  return Math.round(base * city.pois[z.poi].traffic * (1 + (z.level - 1) * bal.biz.levelProfit));
}
const bizCost = (z: Biz, bal: Balance) => Math.round((z.type === 'stall' ? bal.biz.stall : bal.biz.shop) * bal.biz.upgradeFactor * z.level);

function addHeat(s: GameState, amount: number, bal: Balance, ev: Ev[]) {
  const before = stars(s, bal);
  s.heat = clamp(s.heat + amount, 0, 100);
  const after = stars(s, bal);
  if (after > before) ev.push({ type: 'star', stars: after });
}
// 払う。大きな買い物（cleanOnly）は、きれいなお金だけ
function pay(s: GameState, amount: number, cleanOnly: boolean): boolean {
  if (cleanOnly) {
    if (s.cash < amount) return false;
    s.cash -= amount;
    return true;
  }
  if (s.cash + s.dirty < amount) return false;
  const d = Math.min(s.dirty, amount);
  s.dirty -= d;
  s.cash -= amount - d;
  return true;
}

// ---- 近くにある物（乗れる車・入れる場所）
export function nearby(s: GameState, city: City): { car?: Car; poi?: Poi } {
  const out: { car?: Car; poi?: Poi } = {};
  if (s.ride === null) {
    let bd = 9;
    for (const c of s.cars) {
      if (c.kind === 'police' || c.kind === 'hunter') continue;
      if (c.kind === 'npc' && Math.abs(c.v) > 4) continue;
      const d = Math.hypot(c.x - s.x, c.y - s.y);
      if (d < bd) {
        bd = d;
        out.car = c;
      }
    }
  }
  let pd = 20;
  for (const p of city.pois) {
    if (p.kind === 'house' && !s.crowbar) continue;
    const d = Math.hypot(p.x - s.x, p.y - s.y);
    if (d < pd) {
      pd = d;
      out.poi = p;
    }
  }
  return out;
}

// ---- 場所でできること
export function poiTitle(s: GameState, p: Poi): string {
  const mine = s.biz.find((z) => z.poi === p.id);
  return mine ? (mine.type === 'stall' ? '自分の屋台' : '自分の店') : POI_NAME[p.kind];
}
export function poiActions(s: GameState, city: City, p: Poi, bal: Balance): Act[] {
  const m = bal.money;
  const st = stars(s, bal);
  const h = hourOf(s);
  const cd = (s.cool[p.id] ?? 0) - dayOf(s);
  const car = riding(s);
  switch (p.kind) {
    case 'home':
      return [{ id: 'sleep', label: '朝まで寝る', sub: '手配度が下がる', ok: !s.seen, why: '警察に見られている' }];
    case 'conbini':
    case 'warehouse': {
      const wage = p.kind === 'conbini' ? m.wageConbini : m.wageWarehouse;
      return [{ id: 'work', label: `${m.shiftHours}時間はたらく`, sub: `+${yen(wage * m.shiftHours)}`, ok: st === 0 && h >= 6 && h < 20, why: st > 0 ? '手配されている' : '6時〜20時だけ' }];
    }
    case 'bike':
      return [{ id: 'buyBike', label: '自転車を買う', sub: yen(m.bike), ok: s.cash + s.dirty >= m.bike, why: 'お金が足りない' }];
    case 'car':
      return [{ id: 'buyCar', label: '中古車を買う', sub: `${yen(m.car)}（きれいなお金）`, ok: s.cash >= m.car, why: 'きれいなお金が足りない' }];
    case 'tool':
      return [
        { id: 'crowbar', label: 'バールを買う', sub: s.crowbar ? '持っている' : yen(m.crowbar), ok: !s.crowbar && s.cash + s.dirty >= m.crowbar, why: s.crowbar ? '持っている' : 'お金が足りない' },
        { id: 'laptop', label: 'ノートPCを買う', sub: s.laptop ? '持っている' : yen(m.laptop), ok: !s.laptop && s.cash + s.dirty >= m.laptop, why: s.laptop ? '持っている' : 'お金が足りない' },
      ];
    case 'pawn':
      return [{ id: 'sell', label: '盗んだ物を売る', sub: s.loot > 0 ? `+${yen(s.loot * m.pawnRate)}（汚れたお金）` : '何も持っていない', ok: s.loot > 0, why: '何も持っていない', crime: true }];
    case 'chop':
      return [{ id: 'chop', label: '乗ってきた車を売る', sub: car?.kind === 'stolen' ? `+${yen(car.value)}（汚れたお金）` : '盗んだ車で来る', ok: car?.kind === 'stolen', why: '盗んだ車で来る', crime: true }];
    case 'bank':
      return [
        { id: 'deposit', label: '全部あずける', sub: yen(s.cash), ok: s.cash > 0, why: '現金がない' },
        { id: 'withdraw', label: '5万円おろす', sub: `預金 ${yen(s.bank)}`, ok: s.bank >= 50000, why: '預金が足りない' },
        { id: 'rob', label: '強盗する', sub: cd > 0 ? `警戒中（あと${cd}日）` : '大金・手配度は最大近く', ok: cd <= 0, why: '警戒中', crime: true },
      ];
    case 'police': {
      const fine = Math.round(s.heat * bal.heat.fine);
      return [{ id: 'fine', label: '罰金を払って出頭する', sub: st > 0 ? yen(fine) : '手配されていない', ok: st >= 1 && st <= 3 && s.cash >= fine, why: st === 0 ? '手配されていない' : st > 3 ? '罪が重すぎる' : 'きれいなお金が足りない' }];
    }
    case 'lot': {
      const z = s.biz.find((b) => b.poi === p.id);
      if (z) {
        const cost = bizCost(z, bal);
        return [{ id: 'upgrade', label: `大きくする（いま ${z.level}段）`, sub: `${yen(cost)}／1日の利益 ${yen(bizProfit(city, z, bal))}`, ok: z.level < bal.biz.maxLevel && s.cash >= cost, why: z.level >= bal.biz.maxLevel ? 'これ以上は大きくできない' : 'きれいなお金が足りない' }];
      }
      return [
        { id: 'stall', label: '屋台を出す', sub: `${yen(bal.biz.stall)}／1日 +${yen(bal.biz.stallProfit * p.traffic)}`, ok: s.cash >= bal.biz.stall, why: 'きれいなお金が足りない' },
        { id: 'shop', label: '店を開く', sub: `${yen(bal.biz.shop)}／1日 +${yen(bal.biz.shopProfit * p.traffic)}`, ok: s.cash >= bal.biz.shop, why: 'きれいなお金が足りない' },
      ];
    }
    case 'atm':
      return [{ id: 'hack', label: 'ハッキングする', sub: !s.laptop ? 'ノートPCが要る' : cd > 0 ? `対策中（あと${cd}日）` : 'うまくいけば大金', ok: s.laptop && cd <= 0, why: !s.laptop ? 'ノートPCが要る' : '対策中', mini: true, crime: true }];
    case 'house':
      return [{ id: 'burgle', label: '空き巣に入る', sub: cd > 0 ? `用心している（あと${cd}日）` : isNight(s) ? '夜は見つかりにくい' : '昼は見つかりやすい', ok: s.crowbar && cd <= 0, why: !s.crowbar ? 'バールが要る' : '用心している', mini: true, crime: true }];
  }
}

// ---- 1日の終わり：生活費、事業の利益、汚れたお金が事業を通ってきれいになる
function settle(s: GameState, city: City, bal: Balance, ev: Ev[]) {
  const profit = s.biz.reduce((sum, z) => sum + bizProfit(city, z, bal), 0);
  const washed = Math.min(s.dirty, profit);
  s.dirty -= washed;
  s.bank += profit + washed;
  s.earned += profit;
  const living = bal.money.living;
  const fromCash = Math.min(s.cash, living);
  s.cash -= fromCash;
  s.bank -= living - fromCash; // 足りない分は預金から（預金は借金にもなる）
  ev.push({ type: 'day', living, profit, washed });
}

// 時間を飛ばす（働く・寝る・服役）
function skip(s: GameState, city: City, minutes: number, bal: Balance, ev: Ev[]) {
  const d0 = dayOf(s);
  s.clock += minutes;
  for (let d = d0; d < dayOf(s); d++) settle(s, city, bal, ev);
  s.cars = s.cars.filter((c) => c.kind === 'mine' || c.id === s.ride);
  s.peds = [];
  s.seen = false;
  s.catchT = 0;
  ev.push({ type: 'skip' });
}

function busted(s: GameState, city: City, bal: Balance, ev: Ev[]) {
  const st = stars(s, bal);
  const want = Math.round(s.heat * bal.heat.fine);
  const fine = Math.min(want, Math.max(0, s.cash) + Math.max(0, s.bank));
  const fromCash = Math.min(Math.max(0, s.cash), fine);
  s.cash -= fromCash;
  s.bank -= fine - fromCash;
  const lost = s.dirty + s.loot + Math.round(s.cash * bal.heat.confiscate);
  s.cash -= Math.round(s.cash * bal.heat.confiscate);
  s.dirty = 0;
  s.loot = 0;
  const car = riding(s);
  if (car && car.kind === 'stolen') s.cars = s.cars.filter((c) => c !== car);
  s.ride = null;
  let best: Poi | undefined;
  for (const p of city.pois) if (p.kind === 'police' && (!best || Math.hypot(p.x - s.x, p.y - s.y) < Math.hypot(best.x - s.x, best.y - s.y))) best = p;
  if (best) {
    s.x = best.x;
    s.y = best.y + 5;
  }
  s.heat = 0;
  s.record += 1;
  const hours = st * bal.heat.jailHoursPerStar;
  skip(s, city, hours * 60, bal, ev);
  ev.push({ type: 'busted', fine, hours, lost });
}

// ---- 命令
export function apply(s: GameState, city: City, cmd: Cmd, bal: Balance): Ev[] {
  const ev: Ev[] = [];
  const toast = (text: string, tone: 'good' | 'bad' | '' = '') => ev.push({ type: 'toast', text, tone });
  if (cmd.type === 'way') {
    s.way = [cmd.x, cmd.y];
    s.route = findPath(city, nearestNode(city, s.x, s.y), nearestNode(city, cmd.x, cmd.y));
    return ev;
  }
  if (cmd.type === 'noway') {
    s.way = null;
    s.route = [];
    return ev;
  }
  if (cmd.type === 'ride') {
    const car = riding(s);
    if (car) {
      // 降りる：車の左、だめなら右
      for (const side of [1, -1]) {
        const x = car.x + Math.sin(car.a) * 3 * side;
        const y = car.y - Math.cos(car.a) * 3 * side;
        if (!solid(city, x, y, 1.4)) {
          s.x = x;
          s.y = y;
          car.v = 0;
          s.ride = null;
          ev.push({ type: 'sfx', name: 'door' });
          return ev;
        }
      }
      return ev;
    }
    const near = nearby(s, city).car;
    if (!near) return ev;
    if (near.kind === 'npc' || near.kind === 'parked') {
      addHeat(s, s.seen || s.cars.some((c) => (c.kind === 'police' || c.kind === 'hunter') && Math.hypot(c.x - s.x, c.y - s.y) < bal.police.sight) ? bal.heat.stealSeen : bal.heat.stealUnseen, bal, ev);
      near.kind = 'stolen';
      s.crimes += 1;
    }
    near.v = 0;
    s.ride = near.id;
    ev.push({ type: 'sfx', name: 'door' });
    return ev;
  }
  // 場所での行動
  const p = city.pois[cmd.id];
  if (!p || Math.hypot(p.x - s.x, p.y - s.y) > 26) return ev;
  const act = poiActions(s, city, p, bal).find((a) => a.id === cmd.act);
  if (!act || !act.ok) return ev;
  const m = bal.money;
  const between = (lo: number, hi: number) => Math.round((lo + (hi - lo) * rnd(s)) / 1000) * 1000;
  const spawnMine = (bike: boolean) => {
    s.cars = s.cars.filter((c) => c.kind !== 'mine' || c.id === s.ride);
    const old = s.cars.find((c) => c.kind === 'mine');
    if (old) old.kind = 'parked';
    s.cars.push({ id: s.nextId++, kind: 'mine', bike, x: p.x + 5, y: p.y + (bike ? 3 : 6), a: 0, v: 0, color: bike ? 0x1f8a6f : 0x2f7fc1, from: 0, to: 0, s: 0, chase: false, think: 0, path: [], stuck: 0, value: 0 });
  };
  switch (cmd.act) {
    case 'sleep': {
      const now = s.clock % 1440;
      skip(s, city, (now < 420 ? 420 - now : 1440 - now + 420), bal, ev);
      s.heat = Math.max(0, s.heat - 60);
      toast('よく寝た', 'good');
      break;
    }
    case 'work': {
      const wage = (p.kind === 'conbini' ? m.wageConbini : m.wageWarehouse) * m.shiftHours;
      skip(s, city, m.shiftHours * 60, bal, ev);
      s.cash += wage;
      s.earned += wage;
      toast(`+${yen(wage)}`, 'good');
      ev.push({ type: 'sfx', name: 'coin' });
      break;
    }
    case 'buyBike':
      if (pay(s, m.bike, false)) {
        spawnMine(true);
        toast('自転車を買った。店の前にある', 'good');
      }
      break;
    case 'buyCar':
      if (pay(s, m.car, true)) {
        spawnMine(false);
        toast('車を買った。店の前にある', 'good');
      }
      break;
    case 'crowbar':
      if (pay(s, m.crowbar, false)) {
        s.crowbar = true;
        toast('バールを買った。留守の家が地図に出る');
      }
      break;
    case 'laptop':
      if (pay(s, m.laptop, false)) {
        s.laptop = true;
        toast('ノートPCを買った');
      }
      break;
    case 'sell': {
      const got = Math.round(s.loot * m.pawnRate);
      s.dirty += got;
      s.loot = 0;
      toast(`+${yen(got)}（汚れたお金）`, 'good');
      ev.push({ type: 'sfx', name: 'coin' });
      break;
    }
    case 'chop': {
      const car = riding(s);
      if (!car) break;
      s.dirty += car.value;
      s.cars = s.cars.filter((c) => c !== car);
      s.ride = null;
      toast(`+${yen(car.value)}（汚れたお金）`, 'good');
      ev.push({ type: 'sfx', name: 'coin' });
      break;
    }
    case 'deposit':
      s.bank += s.cash;
      s.cash = 0;
      toast('あずけた');
      break;
    case 'withdraw':
      s.bank -= 50000;
      s.cash += 50000;
      break;
    case 'rob': {
      const got = between(bal.crime.robMin, bal.crime.robMax);
      s.dirty += got;
      s.cool[p.id] = dayOf(s) + bal.crime.bankDays;
      s.crimes += 1;
      addHeat(s, bal.heat.rob, bal, ev);
      toast(`+${yen(got)}（汚れたお金）逃げろ`, 'bad');
      ev.push({ type: 'sfx', name: 'bigcoin' });
      break;
    }
    case 'fine':
      s.cash -= Math.round(s.heat * bal.heat.fine);
      s.heat = 0;
      toast('罰金を払った');
      break;
    case 'stall':
    case 'shop':
      if (pay(s, cmd.act === 'stall' ? bal.biz.stall : bal.biz.shop, true)) {
        s.biz.push({ poi: p.id, type: cmd.act, level: 1 });
        toast(cmd.act === 'stall' ? '屋台を出した' : '店を開いた', 'good');
        ev.push({ type: 'sfx', name: 'ok' });
      }
      break;
    case 'upgrade': {
      const z = s.biz.find((b) => b.poi === p.id);
      if (z && pay(s, bizCost(z, bal), true)) {
        z.level += 1;
        toast('店を大きくした', 'good');
        ev.push({ type: 'sfx', name: 'ok' });
      }
      break;
    }
    case 'hack': {
      s.cool[p.id] = dayOf(s) + bal.crime.atmDays;
      s.crimes += 1;
      if ((cmd.hits ?? 0) >= 2) {
        const got = between(bal.crime.hackMin, bal.crime.hackMax);
        s.dirty += got;
        addHeat(s, bal.heat.hackOk, bal, ev);
        toast(`+${yen(got)}（汚れたお金）`, 'good');
        ev.push({ type: 'sfx', name: 'coin' });
      } else {
        addHeat(s, bal.heat.hackFail, bal, ev);
        toast('見つかった', 'bad');
        ev.push({ type: 'sfx', name: 'fail' });
      }
      break;
    }
    case 'burgle': {
      s.cool[p.id] = dayOf(s) + bal.crime.houseDays;
      s.crimes += 1;
      const quiet = (cmd.hits ?? 0) >= 2;
      const got = between(bal.crime.lootMin, bal.crime.lootMax);
      s.loot += got;
      addHeat(s, (quiet ? bal.heat.burgleQuiet : bal.heat.burgleLoud) + (isNight(s) ? 0 : bal.heat.burgleDay), bal, ev);
      toast(quiet ? `盗んだ（${yen(got)}相当）質屋で売れる` : `警報が鳴った（${yen(got)}相当）`, quiet ? 'good' : 'bad');
      ev.push({ type: 'sfx', name: quiet ? 'ok' : 'fail' });
      break;
    }
  }
  return ev;
}

// ---- 車を動かす（自分・追ってくる車の両方で使う）。倒した向きへ曲がりながら進む
function drive(c: Car, city: City, mx: number, my: number, max: number, bal: Balance, dt: number): boolean {
  const mag = Math.min(1, Math.hypot(mx, my));
  const off = roadAt(city, c.x, c.y) === 0 ? bal.move.offroad : 1;
  if (mag > 0.12) {
    const d = angDiff(Math.atan2(my, mx), c.a);
    const turn = (c.bike ? 4.6 : 3.2) * dt * Math.min(1, 0.4 + Math.abs(c.v) / 7);
    c.a += clamp(d, -turn, turn);
    const target = mag * max * off * (Math.abs(d) > 1.9 ? 0.2 : Math.abs(d) > 0.9 ? 0.6 : 1);
    c.v += clamp(target - c.v, -bal.move.brake * dt, bal.move.accel * dt);
  } else c.v -= clamp(c.v, -bal.move.drag * dt, bal.move.drag * dt);
  const nx = c.x + Math.cos(c.a) * c.v * dt;
  const ny = c.y + Math.sin(c.a) * c.v * dt;
  const r = c.bike ? 1.2 : 2;
  if (!solid(city, nx, ny, r)) {
    c.x = nx;
    c.y = ny;
    return false;
  }
  const hard = Math.abs(c.v) > 8;
  if (!solid(city, nx, c.y, r)) c.x = nx;
  else if (!solid(city, c.x, ny, r)) c.y = ny;
  c.v *= 0.55;
  return hard;
}

function makeCar(s: GameState, city: City, kind: CarKind, node: number, chase = false): Car {
  const nb = neighbors(city, node);
  const to = nb.length ? nb[Math.floor(rnd(s) * nb.length)] : node;
  const [x, y] = nodeXY(city, node);
  const color = kind === 'police' ? 0xffffff : kind === 'hunter' ? 0x20242c : COLORS[Math.floor(rnd(s) * COLORS.length)];
  return { id: s.nextId++, kind, bike: false, x, y, a: 0, v: 0, color, from: node, to, s: 0, chase, think: 0, path: [], stuck: 0, value: 0 };
}

// 自分のまわりの輪の中から、交差点を1つ選ぶ
function ringNode(s: GameState, city: City, rmin: number, rmax: number): number {
  for (let k = 0; k < 6; k++) {
    const a = rnd(s) * Math.PI * 2;
    const d = rmin + rnd(s) * (rmax - rmin);
    const n = nearestNode(city, s.x + Math.cos(a) * d, s.y + Math.sin(a) * d);
    const [x, y] = nodeXY(city, n);
    const dist = Math.hypot(x - s.x, y - s.y);
    if (city.ok[n] && dist > rmin * 0.7 && dist < rmax * 1.5) return n;
  }
  return -1;
}

// 道に沿って走る（左側通行）
function follow(c: Car, s: GameState, city: City, bal: Balance, dt: number, blocked: boolean) {
  const [ax, ay] = nodeXY(city, c.from);
  const [bx, by] = nodeXY(city, c.to);
  const len = Math.hypot(bx - ax, by - ay) || 1;
  const dx = (bx - ax) / len;
  const dy = (by - ay) / len;
  const art = edgeArterial(city, c.from, c.to);
  const target = blocked ? 0 : c.s > len - 14 ? 5 : art ? bal.traffic.arterialSpeed : bal.traffic.minorSpeed;
  c.v += clamp(target - c.v, -bal.move.brake * dt, bal.move.accel * 0.5 * dt);
  c.s += c.v * dt;
  if (c.s >= len) {
    const nb = neighbors(city, c.to).filter((n) => n !== c.from);
    const next = nb.length ? nb[Math.floor(rnd(s) * nb.length)] : c.from;
    c.from = c.to;
    c.to = next;
    c.s = 0;
    return;
  }
  const off = art ? 6.5 : 3;
  const tx = ax + dx * c.s + dy * off;
  const ty = ay + dy * c.s - dx * off;
  const k = Math.min(1, dt * 7);
  c.x += (tx - c.x) * k;
  c.y += (ty - c.y) * k;
  c.a += angDiff(Math.atan2(dy, dx), c.a) * Math.min(1, dt * 8);
}

// ---- 1コマ進める
export function step(s: GameState, city: City, inp: { mx: number; my: number }, bal: Balance): Ev[] {
  const ev: Ev[] = [];
  const dt = STEP;
  s.t += dt;
  const d0 = dayOf(s);
  s.clock += dt * bal.time.minutesPerSecond;
  if (dayOf(s) > d0) settle(s, city, bal, ev);
  s.hitCd = Math.max(0, s.hitCd - dt);
  const st = stars(s, bal);

  // 自分
  const car = riding(s);
  if (car) {
    if (drive(car, city, inp.mx, inp.my, car.bike ? bal.move.bike : bal.move.car, bal, dt) && s.hitCd <= 0) {
      s.hitCd = 0.6;
      ev.push({ type: 'sfx', name: 'crash' });
    }
    s.x = car.x;
    s.y = car.y;
    s.a = car.a;
  } else {
    const mag = Math.hypot(inp.mx, inp.my);
    if (mag > 0.12) {
      const k = (Math.min(1, mag) * bal.move.walk * dt) / mag;
      const nx = s.x + inp.mx * k;
      const ny = s.y + inp.my * k;
      if (!solid(city, nx, s.y, 1.4)) s.x = nx;
      if (!solid(city, s.x, ny, 1.4)) s.y = ny;
      s.a = Math.atan2(inp.my, inp.mx);
    }
  }
  const speed = car ? Math.abs(car.v) : 0;

  // 出したり消したり（0.5秒ごと）
  s.spawnT -= dt;
  if (s.spawnT <= 0) {
    s.spawnT = 0.5;
    const R = bal.traffic.radius;
    s.cars = s.cars.filter((c) => c.kind === 'mine' || c.id === s.ride || Math.hypot(c.x - s.x, c.y - s.y) < R * (c.chase ? 2.2 : 1.45));
    s.peds = s.peds.filter((p) => Math.hypot(p.x - s.x, p.y - s.y) < R);
    const count = (f: (c: Car) => boolean) => s.cars.reduce((n, c) => n + (f(c) ? 1 : 0), 0);
    for (let k = 0; k < 3 && count((c) => c.kind === 'npc') < bal.traffic.cars; k++) {
      const n = ringNode(s, city, R * 0.55, R);
      if (n >= 0) {
        const c = makeCar(s, city, 'npc', n);
        c.value = Math.round((bal.crime.chopMin + (bal.crime.chopMax - bal.crime.chopMin) * rnd(s)) / 1000) * 1000;
        s.cars.push(c);
      }
    }
    if (count((c) => c.kind === 'parked') < bal.traffic.parked) {
      const n = ringNode(s, city, R * 0.3, R);
      if (n >= 0) {
        const c = makeCar(s, city, 'parked', n);
        if (c.to !== c.from && !edgeArterial(city, c.from, c.to)) {
          const [ax, ay] = nodeXY(city, c.from);
          const [bx, by] = nodeXY(city, c.to);
          const len = Math.hypot(bx - ax, by - ay) || 1;
          const f = 0.25 + rnd(s) * 0.5;
          c.x = ax + (bx - ax) * f + ((by - ay) / len) * 7.6;
          c.y = ay + (by - ay) * f - ((bx - ax) / len) * 7.6;
          c.a = Math.atan2(by - ay, bx - ax);
          c.value = Math.round((bal.crime.chopMin + (bal.crime.chopMax - bal.crime.chopMin) * rnd(s)) / 1000) * 1000;
          if (!solid(city, c.x, c.y, 2)) s.cars.push(c);
        }
      }
    }
    if (count((c) => c.kind === 'police' && !c.chase) < bal.police.patrols) {
      const n = ringNode(s, city, R * 0.6, R);
      if (n >= 0) s.cars.push(makeCar(s, city, 'police', n));
    }
    if (st > 0 && count((c) => c.kind === 'police' && c.chase) < bal.police.chasers[st]) {
      const n = ringNode(s, city, 240, 420);
      if (n >= 0) s.cars.push(makeCar(s, city, 'police', n, true));
    }
    if (st >= 5 && count((c) => c.kind === 'hunter') < bal.police.hunters) {
      const n = ringNode(s, city, 300, 480);
      if (n >= 0) s.cars.push(makeCar(s, city, 'hunter', n, true));
    }
    if (s.peds.length < bal.traffic.peds) {
      const n = ringNode(s, city, 60, R * 0.8);
      const nb = n >= 0 ? neighbors(city, n) : [];
      if (nb.length) {
        const [x, y] = nodeXY(city, n);
        s.peds.push({ x, y, from: n, to: nb[Math.floor(rnd(s) * nb.length)], s: 0, side: rnd(s) < 0.5 ? 1 : -1, speed: 1.6 + rnd(s) * 1.4, color: COLORS[Math.floor(rnd(s) * COLORS.length)] });
      }
    }
  }

  // 車
  let seen = false;
  let close = false;
  for (const c of s.cars) {
    if (c.id === s.ride || c.kind === 'parked' || c.kind === 'mine' || c.kind === 'stolen') {
      if (c.id !== s.ride) c.v = 0;
      continue;
    }
    const dist = Math.hypot(c.x - s.x, c.y - s.y);
    const cop = c.kind === 'police' || c.kind === 'hunter';
    if (cop && st > 0 && dist < bal.police.sight) {
      seen = true;
      if (!c.chase) c.chase = true;
    }
    if (cop && c.chase && st > 0) {
      c.think -= dt;
      if (c.think <= 0) {
        c.think = 0.6;
        c.path = dist < 110 ? [] : findPath(city, nearestNode(city, c.x, c.y), nearestNode(city, s.x, s.y));
      }
      let tx = s.x;
      let ty = s.y;
      if (c.path.length > 1) {
        // 道のりの最初の交差点へ向かう。もうその先の道の上にいるなら、次の交差点へ
        const [x0, y0] = nodeXY(city, c.path[0]);
        const [x1, y1] = nodeXY(city, c.path[1]);
        const ex = x1 - x0;
        const ey = y1 - y0;
        const l2 = ex * ex + ey * ey || 1;
        const t = ((c.x - x0) * ex + (c.y - y0) * ey) / l2;
        const lat = Math.abs((c.x - x0) * ey - (c.y - y0) * ex) / Math.sqrt(l2);
        const onNext = Math.hypot(x0 - c.x, y0 - c.y) < 12 || (t > 0 && t < 1 && lat < 12);
        tx = onNext ? x1 : x0;
        ty = onNext ? y1 : y0;
      }
      const d = Math.hypot(tx - c.x, ty - c.y) || 1;
      drive(c, city, (tx - c.x) / d, (ty - c.y) / d, c.kind === 'hunter' ? bal.police.hunterSpeed : bal.police.speed, bal, dt);
      c.stuck = Math.abs(c.v) < 1.5 ? c.stuck + dt : 0;
      if (c.stuck > 1.4) {
        [c.x, c.y] = nodeXY(city, nearestNode(city, c.x, c.y));
        c.stuck = 0;
      }
      if (dist < bal.police.catchDist && (!car || speed < bal.police.catchSpeed)) close = true;
      if (car && dist < 4.2 && s.hitCd <= 0) {
        s.hitCd = 1;
        car.v *= -0.3;
        c.v *= 0.3;
        addHeat(s, bal.heat.hitPolice, bal, ev);
        ev.push({ type: 'sfx', name: 'crash' });
      }
      continue;
    }
    if (cop && c.chase) {
      // 見失ったら、近くの道へ戻って巡回する
      c.chase = false;
      c.from = nearestNode(city, c.x, c.y);
      const nb = neighbors(city, c.from);
      c.to = nb.length ? nb[0] : c.from;
      c.s = 0;
    }
    // ふつうの車：前がふさがっていたら止まる
    let blocked = false;
    const fx = Math.cos(c.a);
    const fy = Math.sin(c.a);
    const ahead = (ox: number, oy: number) => {
      const rx = ox - c.x;
      const ry = oy - c.y;
      const f = rx * fx + ry * fy;
      return f > 0.5 && f < 13 && Math.abs(rx * fy - ry * fx) < 2.6;
    };
    if (dist < 16 && ahead(s.x, s.y)) blocked = true;
    else for (const o of s.cars) if (o !== c && o.kind !== 'parked' && Math.abs(o.x - c.x) < 14 && Math.abs(o.y - c.y) < 14 && ahead(o.x, o.y)) {
      blocked = true;
      break;
    }
    follow(c, s, city, bal, dt, blocked);
    if (car && dist < 3.6 && speed > 5 && s.hitCd <= 0) {
      s.hitCd = 0.8;
      car.v *= -0.3;
      ev.push({ type: 'sfx', name: 'crash' });
      if (cop) addHeat(s, bal.heat.hitPolice, bal, ev);
    }
  }

  // 歩く人
  for (let i = s.peds.length - 1; i >= 0; i--) {
    const p = s.peds[i];
    const [ax, ay] = nodeXY(city, p.from);
    const [bx, by] = nodeXY(city, p.to);
    const len = Math.hypot(bx - ax, by - ay) || 1;
    p.s += p.speed * dt;
    if (p.s >= len) {
      const nb = neighbors(city, p.to).filter((n) => n !== p.from);
      const next = nb.length ? nb[Math.floor(rnd(s) * nb.length)] : p.from;
      p.from = p.to;
      p.to = next;
      p.s = 0;
      continue;
    }
    const off = (city.half(edgeArterial(city, p.from, p.to)) + 3) * p.side;
    const tx = ax + ((bx - ax) / len) * p.s + ((by - ay) / len) * off;
    const ty = ay + ((by - ay) / len) * p.s - ((bx - ax) / len) * off;
    const k = Math.min(1, dt * 5);
    p.x += (tx - p.x) * k;
    p.y += (ty - p.y) * k;
    if (car && speed > 6 && Math.hypot(p.x - s.x, p.y - s.y) < 2.6) {
      s.peds.splice(i, 1);
      addHeat(s, bal.heat.hitPed, bal, ev);
      ev.push({ type: 'sfx', name: 'crash' });
    }
  }

  // 手配度：見られていない間だけ下がる。捕まる判定
  s.seen = seen;
  if (!seen && s.heat > 0) s.heat = Math.max(0, s.heat - bal.heat.decay * dt);
  s.catchT = close ? s.catchT + dt : Math.max(0, s.catchT - dt * 2);
  if (s.catchT >= bal.police.catchTime) busted(s, city, bal, ev);

  // 行き先に着いたら、道案内を消す
  if (s.way && Math.hypot(s.way[0] - s.x, s.way[1] - s.y) < 30) {
    s.way = null;
    s.route = [];
  } else if (s.way && s.route.length > 1) {
    const [nx, ny] = nodeXY(city, s.route[1]);
    if (Math.hypot(nx - s.x, ny - s.y) < 28) s.route.shift();
  }
  return ev;
}

// ---- 保存する形
export function toSave(s: GameState) {
  const mine = s.cars.find((c) => c.kind === 'mine');
  return {
    v: SAVE_VERSION, seed: s.seed, rng: s.rng, clock: s.clock, x: s.x, y: s.y, cash: s.cash, dirty: s.dirty, bank: s.bank, loot: s.loot, heat: s.heat, record: s.record,
    crowbar: s.crowbar, laptop: s.laptop, biz: s.biz, cool: s.cool, earned: s.earned, crimes: s.crimes,
    mine: mine ? { bike: mine.bike, x: mine.x, y: mine.y, a: mine.a, riding: s.ride === mine.id } : null,
  };
}
export type SaveData = ReturnType<typeof toSave>;
export function fromSave(d: SaveData, city: City, bal: Balance): GameState {
  const s = createGame(d.seed, city, bal);
  Object.assign(s, { rng: d.rng, clock: d.clock, x: d.x, y: d.y, cash: d.cash, dirty: d.dirty, bank: d.bank, loot: d.loot, heat: d.heat, record: d.record, crowbar: d.crowbar, laptop: d.laptop, biz: d.biz, cool: d.cool, earned: d.earned, crimes: d.crimes });
  if (d.mine) {
    const c: Car = { id: s.nextId++, kind: 'mine', bike: d.mine.bike, x: d.mine.x, y: d.mine.y, a: d.mine.a, v: 0, color: d.mine.bike ? 0x1f8a6f : 0x2f7fc1, from: 0, to: 0, s: 0, chase: false, think: 0, path: [], stuck: 0, value: 0 };
    s.cars.push(c);
    if (d.mine.riding) s.ride = c.id;
  }
  return s;
}
