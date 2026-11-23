// ルール本体：状態を持ち、決まった刻み（1/30秒）で進める。画面のことは知らない。
// 書き換えは「命令」（apply）と「1コマ進める」（step）だけで行う。乱数は種つき。
import type { Balance } from '../data/schema';
import { blocked, camSees, roomOf, type Room } from './rooms';
import { edgeArterial, findPath, GANGS, nearestNode, neighbors, nodeXY, roadAt, solid, turfOf, type City, type Poi, type PoiKind } from './city';

export const STEP = 1 / 30;
export const SAVE_VERSION = 1;

export type CarKind = 'npc' | 'parked' | 'police' | 'hunter' | 'mine' | 'stolen';
export interface Car { id: number; kind: CarKind; bike: boolean; x: number; y: number; a: number; v: number; color: number; from: number; to: number; s: number; chase: boolean; think: number; path: number[]; stuck: number; value: number }
export interface Ped { x: number; y: number; from: number; to: number; s: number; side: number; speed: number; color: number }
export interface Thug { id: number; x: number; y: number; hx: number; hy: number; hp: number; gang: number; base: number; cd: number; a: number; flash: number }
export interface Shot { x0: number; y0: number; x1: number; y1: number; t: number }
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
  // 建物の中にいるとき：どの場所か、部屋の中の位置、通報までの秒（-1 は通報なし）、もう取った物
  // 組織との争い：体力、銃、アジトと金庫、縄張りの持ち主（-1＝自分、0〜2＝組織）、敵対の残り秒
  hp: number; gun: boolean; hide: number | null; stash: number; turf: number[]; hostile: number; fireCd: number; warnCd: number;
  thugs: Thug[]; shots: Shot[];
  // 強盗の道具：ピッキング道具、ドリル、手に入れた鍵（場所の番号）
  lockpick: boolean; drill: boolean; keys: number[];
  inside: Inside | null;
}
// 建物の中にいるときの様子
export interface Inside {
  poi: number; x: number; y: number; a: number;
  alarm: number; // 通報までの秒（-1＝鳴っていない、0＝通報された）
  taken: number[]; // もう取った物（場所の番号）
  t: number; // 中に入ってからの秒（カメラの首振りに使う）
  staff: boolean; // 店員がいるか（営業中）
  fresh: boolean; // 盗める物が残っているか（警戒中でない）
  held: boolean; guardDown: boolean; camsOff: boolean; // 店員を脅した／警備員を脅した／カメラを止めた
  open: number[]; // 開けた扉
  drill: number; drillAt: number; // 金庫のドリル：残りの秒と、その場所
  filmed: boolean; crime: boolean; did: boolean; // カメラに映った／怪しい（侵入・銃）／脅した・盗んだ
  seenT: number; // 見られている度合い（0〜1。1で見つかる）
}
export type Ev =
  | { type: 'toast'; text: string; tone: 'good' | 'bad' | '' }
  | { type: 'busted'; fine: number; hours: number; lost: number }
  | { type: 'star'; stars: number }
  | { type: 'day'; living: number; profit: number; washed: number; turf: number; lost: string; news: string }
  | { type: 'down'; lost: number }
  | { type: 'skip' }
  | { type: 'sfx'; name: 'coin' | 'bigcoin' | 'crash' | 'door' | 'fail' | 'ok' | 'shot' | 'hurt' };
export type Cmd =
  | { type: 'ride' }
  | { type: 'poi'; id: number; act: string; hits?: number }
  | { type: 'way'; x: number; y: number }
  | { type: 'noway' }
  | { type: 'enter'; id: number; hits?: number; route?: 'front' | 'back' }
  | { type: 'heist'; i: number; hits?: number }
  | { type: 'leave' }
  | { type: 'loot'; i: number }
  | { type: 'fire' }
  | { type: 'shoot'; x: number; y: number } // 決まった点へ撃つ（ほかの人と遊ぶとき）
  | { type: 'hurt'; amount: number; x: number; y: number }; // ほかの人に撃たれた
export interface Act { id: string; label: string; sub?: string; ok: boolean; why?: string; mini?: boolean; crime?: boolean }

export const POI_NAME: Record<PoiKind, string> = { home: '自宅', conbini: 'コンビニ', warehouse: '倉庫', bike: '自転車屋', car: '中古車屋', tool: '道具屋', pawn: '質屋', chop: '解体屋', bank: '銀行', police: '警察署', lot: '空き店舗', atm: 'ATM', house: '留守の家', hideout: '空き倉庫', gang: '敵のアジト', jewel: '宝石店' };
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
    cars: [], peds: [], nextId: 1, seen: false, catchT: 0, hitCd: 0, spawnT: 0, earned: 0, crimes: 0, inside: null,
    hp: 100, gun: false, hide: null, stash: 0, turf: [0, 1, 2, 1, 2, 0], hostile: 0, fireCd: 0, warnCd: 0, thugs: [], shots: [], lockpick: false, drill: false, keys: [],
  };
}

export const stars = (s: GameState, bal: Balance) => (s.heat <= 0 ? 0 : Math.min(5, Math.ceil(s.heat / bal.heat.perStar)));
export const dayOf = (s: GameState) => Math.floor(s.clock / 1440);
export const hourOf = (s: GameState) => (s.clock % 1440) / 60;
export const isNight = (s: GameState) => hourOf(s) >= 20 || hourOf(s) < 5;
export const riding = (s: GameState) => (s.ride === null ? undefined : s.cars.find((c) => c.id === s.ride));
export function rank(s: GameState): string {
  const n = s.biz.length;
  const mine = s.turf.filter((t) => t === -1).length;
  return mine >= 6 ? '街の支配者' : n >= 6 ? '大社長' : mine >= 3 ? '組長' : n >= 3 ? '社長' : n >= 1 ? '個人事業主' : 'アルバイト';
}
// 縄張り（横3×縦2）のとなり
const TURF_NEXT = [[1, 3], [0, 2, 4], [1, 5], [0, 4], [1, 3, 5], [2, 4]];
// その場所は自分の物か（店・アジト・奪ったアジト）
export function ownedPoi(s: GameState, city: City, q: Poi): boolean {
  if (q.kind === 'hideout') return s.hide === q.id;
  if (q.kind === 'gang') return s.turf[turfOf(city.size, q.x, q.y)] === -1;
  return s.biz.some((z) => z.poi === q.id);
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
    let bd = 12;
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
export function poiTitle(s: GameState, city: City, p: Poi): string {
  if (p.kind === 'hideout' && s.hide === p.id) return '自分のアジト';
  if (p.kind === 'gang') return ownedPoi(s, city, p) ? '奪ったアジト' : `${GANGS[s.turf[turfOf(city.size, p.x, p.y)]].name}のアジト`;
  const mine = s.biz.find((z) => z.poi === p.id);
  return mine ? (mine.type === 'stall' ? '自分の屋台' : '自分の店') : POI_NAME[p.kind];
}
export function poiActions(s: GameState, city: City, p: Poi, bal: Balance): Act[] {
  const m = bal.money;
  const st = stars(s, bal);
  const h = hourOf(s);
  const cd = (s.cool[p.id] ?? 0) - dayOf(s);
  const car = riding(s);
  // 夜の仕事のために、夜まで時間を進める
  const NAP: Act = { id: 'nap', label: '夜まで休む', sub: '22時に起きる', ok: !s.seen && h >= 5 && h < 21, why: s.seen ? '警察に見られている' : 'もう夜' };
  switch (p.kind) {
    case 'home':
      return [{ id: 'sleep', label: '朝まで寝る', sub: '手配度が下がる', ok: !s.seen, why: '警察に見られている' }, NAP];
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
        { id: 'crowbar', label: 'バールを買う', sub: s.crowbar ? '持っている' : `${yen(m.crowbar)}／こじ開ける（音が出る）`, ok: !s.crowbar && s.cash + s.dirty >= m.crowbar, why: s.crowbar ? '持っている' : 'お金が足りない' },
        { id: 'laptop', label: 'ノートPCを買う', sub: s.laptop ? '持っている' : `${yen(m.laptop)}／ATM・監視カメラ`, ok: !s.laptop && s.cash + s.dirty >= m.laptop, why: s.laptop ? '持っている' : 'お金が足りない' },
        { id: 'lockpick', label: 'ピッキング道具を買う', sub: s.lockpick ? '持っている' : `${yen(m.lockpick)}／鍵を静かに開ける`, ok: !s.lockpick && s.cash + s.dirty >= m.lockpick, why: s.lockpick ? '持っている' : 'お金が足りない' },
        { id: 'drill', label: 'ドリルを買う', sub: s.drill ? '持っている' : `${yen(m.drill)}／金庫を破る`, ok: !s.drill && s.cash + s.dirty >= m.drill, why: s.drill ? '持っている' : 'お金が足りない' },
      ];
    case 'pawn':
      return [
        { id: 'sell', label: '盗んだ物を売る', sub: s.loot > 0 ? `+${yen(s.loot * m.pawnRate)}（汚れたお金）` : '何も持っていない', ok: s.loot > 0, why: '何も持っていない', crime: true },
        { id: 'gun', label: '銃を買う', sub: s.gun ? '持っている' : `${yen(bal.gang.gunCost)}／店員や警備員を脅せる`, ok: !s.gun && s.cash + s.dirty >= bal.gang.gunCost, why: s.gun ? '持っている' : 'お金が足りない', crime: true },
      ];
    case 'hideout':
      if (s.hide !== p.id) return [{ id: 'buyHide', label: 'アジトにする', sub: `${yen(bal.gang.hideCost)}／金庫の中身は逮捕されても取られない`, ok: s.cash + s.dirty >= bal.gang.hideCost, why: 'お金が足りない', crime: true }];
      return [
        { id: 'sleep', label: '朝まで寝る', sub: '手配度が下がる', ok: !s.seen, why: '警察に見られている' }, NAP,
        { id: 'stashIn', label: '汚れたお金をしまう', sub: `金庫 ${yen(s.stash)}`, ok: s.dirty > 0, why: '汚れたお金がない', crime: true },
        { id: 'stashOut', label: '金庫から出す', sub: yen(s.stash), ok: s.stash > 0, why: '金庫は空', crime: true },
      ];
    case 'gang': {
      const t = turfOf(city.size, p.x, p.y);
      if (s.turf[t] === -1)
        return [
          { id: 'sleep', label: '朝まで寝る', sub: '手配度が下がる', ok: !s.seen, why: '警察に見られている' }, NAP,
          { id: 'stashIn', label: '汚れたお金をしまう', sub: `金庫 ${yen(s.stash)}`, ok: s.dirty > 0, why: '汚れたお金がない', crime: true },
          { id: 'stashOut', label: '金庫から出す', sub: yen(s.stash), ok: s.stash > 0, why: '金庫は空', crime: true },
        ];
      return [{ id: 'seize', label: '金庫の中身をいただく', sub: '縄張りも手に入る', ok: true, why: '', crime: true }];
    }
    case 'jewel':
      return [];
    case 'chop':
      return [{ id: 'chop', label: '乗ってきた車を売る', sub: car?.kind === 'stolen' ? `+${yen(car.value)}（汚れたお金）` : '盗んだ車で来る', ok: car?.kind === 'stolen', why: '盗んだ車で来る', crime: true }];
    case 'bank':
      return [
        { id: 'deposit', label: '全部あずける', sub: yen(s.cash), ok: s.cash > 0, why: '現金がない' },
        { id: 'withdraw', label: '5万円おろす', sub: `預金 ${yen(s.bank)}`, ok: s.bank >= 50000, why: '預金が足りない' },
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
      return [{ id: 'break', label: 'こじ開けて入る', sub: cd > 0 ? `用心している（あと${cd}日）` : isNight(s) ? '夜は見つかりにくい' : '昼は見つかりやすい', ok: s.crowbar && cd <= 0, why: !s.crowbar ? 'バールが要る' : '用心している', mini: true, crime: true }];
  }
}

// ---- 建物の中
// ---- 強盗（コンビニ・宝石店・銀行）
export type HeistKind = 'conbini' | 'jewel' | 'bank';
// 営業時間：コンビニはいつでも。宝石店は10〜19時、銀行は9〜17時。閉まっている間は店員がいない
export const isOpen = (k: HeistKind, hour: number) => k === 'conbini' || (k === 'jewel' ? hour >= 10 && hour < 19 : hour >= 9 && hour < 17);
export const hasKey = (s: GameState, poi: number) => s.keys.includes(poi);
type LockHow = 'open' | 'key' | 'pick' | 'bar' | 'none';
// 鍵のかかった所の開け方：鍵（静か）→ ピッキング（手でやる・失敗すると警報）→ バール（警報）
const lockHow = (s: GameState, poi: number): LockHow => (hasKey(s, poi) ? 'key' : s.lockpick ? 'pick' : s.crowbar ? 'bar' : 'none');
const LOCK_TEXT: Record<LockHow, string> = { open: '', key: '鍵で静かに開ける', pick: 'ピッキングで開ける（失敗すると警報）', bar: 'バールでこじ開ける（警報が鳴る）', none: '鍵・ピッキング道具・バールのどれかが要る' };
export interface Route { id: 'front' | 'back'; label: string; sub: string; ok: boolean; how: LockHow }
// 入り方の一覧（宝石店と銀行）。正面は営業中だけ開いている。裏口はいつも鍵がかかっている
export function routesOf(s: GameState, p: Poi): Route[] {
  if (p.kind !== 'jewel' && p.kind !== 'bank') return [];
  const open = isOpen(p.kind, hourOf(s));
  const how = lockHow(s, p.id);
  const hours = p.kind === 'jewel' ? '10〜19時' : '9〜17時';
  return [
    open ? { id: 'front', label: '正面から入る', sub: `営業中（${hours}）。店員と警備の目がある`, ok: true, how: 'open' } : { id: 'front', label: '正面から入る', sub: `閉店中。${LOCK_TEXT[how]}`, ok: how !== 'none', how },
    { id: 'back', label: '裏口から入る', sub: `${open ? '営業中は店員に気づかれる。' : '奥の部屋に出る。'}${LOCK_TEXT[how]}`, ok: how !== 'none', how },
  ];
}
// その場所を、いま使えるか（見せるか）
export function spotShown(s: GameState, room: Room, i: number): boolean {
  const sp = room.spots[i];
  const ins = s.inside;
  if (!ins) return false;
  if (sp.exit) return true;
  if (sp.loot) return !ins.taken.includes(i);
  if (sp.acts) return !room.heist || (ins.staff && !ins.held && !ins.crime);
  switch (sp.h) {
    case 'threat': return s.gun && ins.staff && !ins.held;
    case 'guard': return s.gun && !ins.guardDown;
    case 'till': return ins.held && ins.fresh && !ins.taken.includes(i);
    case 'key': return ins.held && !hasKey(s, ins.poi);
    case 'desk': return !ins.taken.includes(i) && !hasKey(s, ins.poi);
    case 'panel': return !ins.camsOff;
    case 'door': return !ins.open.includes(sp.n ?? 0);
    case 'vault':
    case 'case': return ins.fresh && !ins.taken.includes(i);
    default: return true;
  }
}
export interface SpotInfo { label: string; ok: boolean; why: string; mini: boolean; tone: 'crime' | 'exit' | '' }
// その場所のボタン：文字、押せるか、押せない理由、手でやる操作が要るか
export function spotInfo(s: GameState, city: City, room: Room, i: number, bal: Balance): SpotInfo {
  const sp = room.spots[i];
  const ins = s.inside!;
  if (sp.exit) return { label: sp.label, ok: true, why: '', mini: false, tone: 'exit' };
  if (sp.loot) return { label: sp.label, ok: true, why: '', mini: false, tone: 'crime' };
  if (sp.acts) {
    if (sp.acts.length > 1) return { label: sp.label, ok: true, why: '', mini: false, tone: '' };
    const a = poiActions(s, city, city.pois[ins.poi], bal).find((x) => x.id === sp.acts![0]);
    return { label: a && !a.ok ? `${sp.label}（${a.why}）` : sp.label, ok: !!a?.ok, why: a?.why ?? '', mini: false, tone: a?.crime ? 'crime' : '' };
  }
  const c = (label: string, ok = true, why = '', mini = false): SpotInfo => ({ label, ok, why, mini, tone: 'crime' });
  switch (sp.h) {
    case 'threat':
    case 'guard': return c(sp.label, s.gun, '銃が要る');
    case 'panel': return c(s.laptop ? sp.label : '防犯パネル（ノートPCが要る）', s.laptop, 'ノートPCが要る。道具屋で買える', true);
    case 'door': {
      const how = lockHow(s, ins.poi);
      return how === 'key' ? c(`${sp.label}を鍵で開ける`) : how === 'pick' ? c(`${sp.label}をピッキングする`, true, '', true) : how === 'bar' ? c(`${sp.label}をこじ開ける`) : c(`${sp.label}（鍵がかかっている）`, false, LOCK_TEXT.none);
    }
    case 'case': return hasKey(s, ins.poi) ? c('ショーケースを鍵で開ける') : s.crowbar ? c('ショーケースを割る') : c('ショーケース（鍵がかかっている）', false, '鍵かバールが要る');
    case 'vault': return ins.drill >= 0 ? c('ドリルで穴をあけている…') : c(s.drill ? '金庫をドリルで破る' : '金庫（ドリルが要る）', s.drill, 'ドリルが要る。道具屋で買える');
    default: return c(sp.label);
  }
}
const randK = (s: GameState, lo: number, hi: number) => Math.round((lo + (hi - lo) * rnd(s)) / 1000) * 1000;

export function roomFor(s: GameState, city: City): Room | null {
  if (!s.inside) return null;
  const q = city.pois[s.inside.poi];
  return roomOf(q.kind, ownedPoi(s, city, q));
}
// いちばん近い「行動できる場所」（なければ -1）
export function nearSpot(s: GameState, city: City): number {
  const room = roomFor(s, city);
  if (!room || !s.inside) return -1;
  let best = -1;
  let bd = 1.7;
  room.spots.forEach((sp, i) => {
    if (!spotShown(s, room, i)) return;
    const d = Math.hypot(sp.x - s.inside!.x, sp.y - s.inside!.y);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
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
  const mine = s.turf.filter((t) => t === -1).length;
  const turf = mine * bal.gang.turfIncome;
  s.dirty += turf;
  let lost = '';
  s.turf.forEach((t, i) => {
    if (t === -1 && !lost && rnd(s) < bal.gang.retake) {
      // となりの組織が奪い返しに来る（となりが全部自分の物なら、元の持ち主）
      const near = TURF_NEXT[i].map((j) => s.turf[j]).filter((g) => g >= 0);
      const g = near.length ? near[Math.floor(rnd(s) * near.length)] : i % 3;
      s.turf[i] = g;
      lost = `${GANGS[g].name}に縄張りを奪い返された`;
    }
  });
  if (!lost && s.stash > 0 && rnd(s) < bal.gang.raid) {
    const take = Math.round(s.stash * 0.25);
    s.stash -= take;
    lost = `アジトが襲われ、金庫から ${yen(take)} 取られた`;
  }
  // 組織どうしの争い：となりの縄張りを奪い合う（街の勢力図が毎日すこしずつ動く）
  let news = '';
  if (rnd(s) < bal.gang.war) {
    const i = Math.floor(rnd(s) * 6);
    const from = s.turf[i];
    const rivals = TURF_NEXT[i].map((j) => s.turf[j]).filter((g) => g >= 0 && g !== from);
    if (from >= 0 && rivals.length) {
      const g = rivals[Math.floor(rnd(s) * rivals.length)];
      s.turf[i] = g;
      news = `${GANGS[g].name}が${GANGS[from].name}の縄張りを奪った`;
    }
  }
  ev.push({ type: 'day', living, profit, washed, turf, lost, news });
}

// 時間を飛ばす（働く・寝る・服役）
function skip(s: GameState, city: City, minutes: number, bal: Balance, ev: Ev[]) {
  const d0 = dayOf(s);
  s.clock += minutes;
  for (let d = d0; d < dayOf(s); d++) settle(s, city, bal, ev);
  s.cars = s.cars.filter((c) => c.kind === 'mine' || c.id === s.ride);
  s.peds = [];
  s.thugs = [];
  s.shots = [];
  s.hostile = 0;
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
  s.inside = null;
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
        const x = car.x + Math.sin(car.a) * 5 * side;
        const y = car.y - Math.cos(car.a) * 5 * side;
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
  if (cmd.type === 'shoot') {
    if (!s.gun || s.fireCd > 0 || s.inside) return ev;
    s.fireCd = 0.38;
    s.a = Math.atan2(cmd.y - s.y, cmd.x - s.x);
    s.shots.push({ x0: s.x, y0: s.y, x1: cmd.x, y1: cmd.y, t: 0.12 });
    s.crimes += 1;
    const seenNow = s.cars.some((c) => (c.kind === 'police' || c.kind === 'hunter') && Math.hypot(c.x - s.x, c.y - s.y) < bal.police.sight);
    addHeat(s, seenNow ? bal.gang.shotSeen : bal.gang.shotUnseen, bal, ev);
    ev.push({ type: 'sfx', name: 'shot' });
    return ev;
  }
  if (cmd.type === 'hurt') {
    if (s.inside) return ev;
    s.hp -= Math.max(0, Math.min(50, cmd.amount));
    s.shots.push({ x0: cmd.x, y0: cmd.y, x1: s.x, y1: s.y, t: 0.12 });
    ev.push({ type: 'sfx', name: 'hurt' });
    return ev;
  }
  if (cmd.type === 'fire') {
    if (!s.gun || s.fireCd > 0 || s.inside) return ev;
    s.fireCd = 0.38;
    let target: Thug | undefined;
    let bd = bal.gang.gunRange;
    for (const t of s.thugs) {
      const d = Math.hypot(t.x - s.x, t.y - s.y);
      if (d < bd) {
        bd = d;
        target = t;
      }
    }
    if (target) {
      const hit = rnd(s) < bal.gang.gunHit;
      s.shots.push({ x0: s.x, y0: s.y, x1: target.x + (hit ? 0 : 4), y1: target.y + (hit ? 0 : -4), t: 0.12 });
      s.a = Math.atan2(target.y - s.y, target.x - s.x);
      if (hit) {
        target.hp -= bal.gang.gunDamage;
        target.flash = 0.14;
      }
      if (target.hp <= 0) {
        s.thugs = s.thugs.filter((t) => t !== target);
        s.shots.push({ x0: target.x, y0: target.y, x1: target.x, y1: target.y, t: 0.3 }); // 倒れた所の光
        const got = Math.round((4000 + 8000 * rnd(s)) / 1000) * 1000;
        s.dirty += got;
        if (!s.thugs.some((t) => t.base === target!.base)) {
          s.cool[target.base] = dayOf(s) + 3;
          toast('見張りを全員倒した。中へ入れる', 'good');
        }
      }
    } else s.shots.push({ x0: s.x, y0: s.y, x1: s.x + Math.cos(s.a) * 60, y1: s.y + Math.sin(s.a) * 60, t: 0.12 });
    s.hostile = 45;
    s.crimes += 1;
    const seenNow = s.cars.some((c) => (c.kind === 'police' || c.kind === 'hunter') && Math.hypot(c.x - s.x, c.y - s.y) < bal.police.sight);
    addHeat(s, seenNow ? bal.gang.shotSeen : bal.gang.shotUnseen, bal, ev);
    ev.push({ type: 'sfx', name: 'shot' });
    return ev;
  }
  if (cmd.type === 'leave') {
    if (s.inside) {
      const ins = s.inside;
      const hk = roomFor(s, city)?.heist;
      if (hk) {
        const pr = bal.heist[hk];
        if (ins.alarm > 0) addHeat(s, pr.heat * 0.5, bal, ev); // 警報は鳴ったが、警察が来る前に逃げた
        else if (ins.alarm < 0 && (ins.held || ins.guardDown)) addHeat(s, pr.quiet, bal, ev); // 警報は鳴らなかったが、脅された人があとで通報する（だれにも会わなければ 0）
        if (ins.filmed && (ins.did || ins.alarm >= 0)) addHeat(s, pr.cam, bal, ev); // カメラに顔が残った
      }
      s.inside = null;
      ev.push({ type: 'sfx', name: 'door' }, { type: 'skip' });
    }
    return ev;
  }
  if (cmd.type === 'heist') {
    const room = roomFor(s, city);
    const ins = s.inside;
    const sp = room?.spots[cmd.i];
    if (!room || !ins || !sp || !sp.h || !room.heist || !spotShown(s, room, cmd.i) || Math.hypot(sp.x - ins.x, sp.y - ins.y) > 2.2) return ev;
    const info = spotInfo(s, city, room, cmd.i, bal);
    if (!info.ok) {
      toast(info.why);
      return ev;
    }
    const pr = bal.heist[room.heist];
    const poi = ins.poi;
    // 警報を鳴らす（もう鳴っていれば、短いほうに合わせる）
    const trip = (sec: number, text: string) => {
      if (ins.alarm < 0) {
        toast(text, 'bad');
        ev.push({ type: 'sfx', name: 'fail' });
        ins.alarm = sec;
      } else if (ins.alarm > 0) ins.alarm = Math.min(ins.alarm, sec);
    };
    const guardUp = !!room.cams?.some((c) => c.guard) && !ins.guardDown;
    switch (sp.h) {
      case 'threat':
        ins.held = ins.crime = ins.did = true;
        s.crimes += 1;
        toast('「動くな」　店員は手を上げた', 'bad');
        ev.push({ type: 'sfx', name: 'door' });
        if (pr.silent > 0) trip(pr.silent, '店員が足元の通報ボタンを押した');
        break;
      case 'guard':
        ins.guardDown = ins.crime = ins.did = true;
        toast('警備員は手を上げた', 'bad');
        ev.push({ type: 'sfx', name: 'door' });
        break;
      case 'till': {
        const got = randK(s, pr.min, pr.max);
        s.dirty += got;
        ins.taken.push(cmd.i);
        s.cool[poi] = dayOf(s) + pr.days;
        s.crimes += 1;
        toast(`+${yen(got)}（汚れたお金）`, 'good');
        ev.push({ type: 'sfx', name: 'coin' });
        break;
      }
      case 'key':
      case 'desk':
        if (sp.h === 'desk') ins.taken.push(cmd.i);
        ins.crime = ins.did = true;
        s.keys.push(poi);
        toast(sp.h === 'desk' ? '机の中に鍵があった' : '鍵を出させた。扉・ショーケース・裏口に使える', 'good');
        ev.push({ type: 'sfx', name: 'ok' });
        break;
      case 'panel':
        ins.crime = true;
        if ((cmd.hits ?? 0) >= 2) {
          ins.camsOff = true;
          toast('監視カメラを止めた', 'good');
          ev.push({ type: 'sfx', name: 'ok' });
        } else trip(pr.alarm, '失敗した。警報が鳴っている');
        break;
      case 'door': {
        const how = lockHow(s, poi);
        ins.crime = true;
        ins.open.push(sp.n ?? 0);
        ev.push({ type: 'sfx', name: 'door' });
        if (how === 'bar') trip(pr.alarm, 'こじ開けた。警報が鳴っている');
        else if (how === 'pick' && (cmd.hits ?? 0) < 2) trip(pr.alarm, '手こずった。警報が鳴っている');
        break;
      }
      case 'case': {
        const quiet = hasKey(s, poi);
        const got = randK(s, pr.caseMin, pr.caseMax);
        s.loot += got;
        ins.taken.push(cmd.i);
        ins.crime = ins.did = true;
        s.cool[poi] = dayOf(s) + pr.days;
        s.crimes += 1;
        toast(`${yen(got)}相当の宝石を盗んだ`, 'good');
        ev.push({ type: 'sfx', name: 'ok' });
        if (!quiet) trip(pr.alarm, 'ガラスを割った。警報が鳴っている');
        break;
      }
      case 'vault':
        if (ins.drill < 0) {
          ins.drill = pr.drill;
          ins.drillAt = cmd.i;
          ins.crime = ins.did = true;
          toast('ドリルで穴をあけている。そばを離れない');
          if ((ins.staff && !ins.held) || guardUp) trip(pr.alarm, 'ドリルの音で気づかれた');
        }
        break;
    }
    return ev;
  }
  if (cmd.type === 'loot') {
    const room = roomFor(s, city);
    const sp = room?.spots[cmd.i];
    if (!s.inside || !sp?.loot || s.inside.taken.includes(cmd.i) || Math.hypot(sp.x - s.inside.x, sp.y - s.inside.y) > 2) return ev;
    const got = Math.round((bal.crime.lootMin + (bal.crime.lootMax - bal.crime.lootMin) * rnd(s)) / 3000) * 1000;
    s.inside.taken.push(cmd.i);
    s.loot += got;
    toast(`${yen(got)}相当を盗んだ`, 'good');
    ev.push({ type: 'sfx', name: 'ok' });
    return ev;
  }
  if (cmd.type === 'enter') {
    const q = city.pois[cmd.id];
    if (!q || s.ride !== null || s.inside || Math.hypot(q.x - s.x, q.y - s.y) > 26) return ev;
    if (q.kind === 'gang' && s.turf[turfOf(city.size, q.x, q.y)] !== -1 && (s.cool[q.id] ?? 0) <= dayOf(s)) {
      toast('見張りがいる。倒さないと入れない', 'bad');
      return ev;
    }
    const room = roomOf(q.kind, ownedPoi(s, city, q));
    if (!room) return ev;
    let alarm = -1;
    let crime = false;
    let back = false;
    const hk = room.heist;
    if (hk && hk !== 'conbini') {
      const r = routesOf(s, q).find((x) => x.id === (cmd.route ?? 'front'));
      if (!r || !r.ok) {
        toast('鍵がかかっている', 'bad');
        return ev;
      }
      back = r.id === 'back';
      if (r.how !== 'open') {
        crime = true; // 鍵を開けて入った：中ではずっと怪しまれる
        if (r.how === 'bar' || (r.how === 'pick' && (cmd.hits ?? 0) < 2)) {
          alarm = bal.heist[hk].alarm;
          toast(r.how === 'bar' ? 'こじ開けた。警報が鳴っている' : '手こずった。警報が鳴っている', 'bad');
          ev.push({ type: 'sfx', name: 'fail' });
        } else toast(r.how === 'key' ? '鍵で静かに入った' : '静かに開いた');
      }
    }
    if (q.kind === 'house') {
      // 留守の家：こじ開けて入る。静かに開けられたかどうかで、通報までの時間が変わる
      if (!poiActions(s, city, q, bal)[0].ok) return ev;
      const quiet = (cmd.hits ?? 0) >= 2;
      s.cool[q.id] = dayOf(s) + bal.crime.houseDays;
      s.crimes += 1;
      addHeat(s, (quiet ? bal.heat.burgleQuiet : bal.heat.burgleLoud * 0.5) + (isNight(s) ? 0 : bal.heat.burgleDay), bal, ev);
      alarm = quiet ? bal.crime.alarmQuiet : bal.crime.alarmLoud;
      toast(quiet ? '静かに開いた。通報される前に出る' : '音を立てた。急げ', quiet ? '' : 'bad');
    }
    const at = back && room.back ? room.back : { x: room.w / 2, y: room.h - 1.7 };
    const fresh = q.kind === 'house' || (s.cool[q.id] ?? 0) <= dayOf(s);
    s.inside = { poi: q.id, x: at.x, y: at.y, a: back ? Math.PI / 2 : -Math.PI / 2, alarm, taken: [], t: 0, staff: !hk || isOpen(hk, hourOf(s)), fresh, held: false, guardDown: false, camsOff: false, open: [], drill: -1, drillAt: -1, filmed: false, crime, did: false, seenT: 0 };
    ev.push({ type: 'sfx', name: 'door' }, { type: 'skip' });
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
    case 'nap':
      skip(s, city, 22 * 60 - (s.clock % 1440), bal, ev);
      s.heat = Math.max(0, s.heat - 30);
      toast('夜になった');
      break;
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
    case 'lockpick':
      if (pay(s, m.lockpick, false)) {
        s.lockpick = true;
        toast('ピッキング道具を買った');
      }
      break;
    case 'drill':
      if (pay(s, m.drill, false)) {
        s.drill = true;
        toast('ドリルを買った');
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
    case 'gun':
      if (pay(s, bal.gang.gunCost, false)) {
        s.gun = true;
        toast('銃を買った。撃つと、敵の組織と警察を敵に回す', 'bad');
      }
      break;
    case 'buyHide':
      if (pay(s, bal.gang.hideCost, false)) {
        s.hide = p.id;
        toast('アジトを手に入れた', 'good');
        ev.push({ type: 'sfx', name: 'ok' });
      }
      break;
    case 'stashIn':
      s.stash += s.dirty;
      s.dirty = 0;
      toast('金庫にしまった');
      break;
    case 'stashOut':
      s.dirty += s.stash;
      s.stash = 0;
      toast('金庫から出した');
      break;
    case 'seize': {
      const got = between(bal.gang.seizeMin, bal.gang.seizeMax);
      const t = turfOf(city.size, p.x, p.y);
      s.dirty += got;
      s.turf[t] = -1;
      s.crimes += 1;
      s.hostile = 0;
      toast(`+${yen(got)}　縄張りを手に入れた`, 'good');
      ev.push({ type: 'sfx', name: 'bigcoin' });
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
  const off = city.half(art) / 2;
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
  if (s.inside) {
    const room = roomFor(s, city);
    const mag = Math.hypot(inp.mx, inp.my);
    if (room && mag > 0.12) {
      const k = (Math.min(1, mag) * 4.6 * dt) / mag;
      const nx = s.inside.x + inp.mx * k;
      const ny = s.inside.y + inp.my * k;
      if (!blocked(room, nx, s.inside.y, 0.34, s.inside.open)) s.inside.x = nx;
      if (!blocked(room, s.inside.x, ny, 0.34, s.inside.open)) s.inside.y = ny;
      s.inside.a = Math.atan2(inp.my, inp.mx);
    }
    const ins = s.inside;
    ins.t += dt;
    const pr = room?.heist ? bal.heist[room.heist] : null;
    if (room && pr) {
      const say = (text: string) => ev.push({ type: 'toast', text, tone: 'bad' }, { type: 'sfx', name: 'fail' });
      const inZone = !!room.zones?.some((z) => ins.x > z.x && ins.x < z.x + z.w && ins.y > z.y && ins.y < z.y + z.h);
      // 監視カメラと警備員：立入禁止の所にいるか、怪しい動きをしたあとで視界に入ると、見つかる
      let watcher = null;
      for (const c of room.cams ?? []) {
        if (c.guard ? ins.guardDown : ins.camsOff) continue;
        if (camSees(room, ins.open, c, ins.t, ins.x, ins.y)) {
          watcher = c;
          break;
        }
      }
      if (watcher && (inZone || ins.crime)) ins.seenT = Math.min(1, ins.seenT + dt / bal.heist.seeTime);
      else ins.seenT = Math.max(0, ins.seenT - dt * 0.8);
      if (watcher && ins.seenT >= 1) {
        if (!watcher.guard && !ins.filmed) {
          ins.filmed = true;
          if (ins.alarm >= 0) ev.push({ type: 'toast', text: '監視カメラに映った', tone: 'bad' });
        }
        if (ins.alarm < 0) {
          ins.alarm = watcher.guard ? pr.alarm * 0.5 : pr.alarm;
          say(watcher.guard ? '警備員に見つかった' : '監視カメラに映った。警報が鳴っている');
        }
      }
      // 営業中に、脅さないまま奥へ入ると、店員が気づく
      if (ins.staff && !ins.held && inZone && ins.alarm < 0) {
        ins.alarm = pr.alarm;
        say('店員に見つかった');
      }
      // 金庫のドリル：そばにいる間だけ進む
      if (ins.drill > 0) {
        const sp = room.spots[ins.drillAt];
        if (Math.hypot(sp.x - ins.x, sp.y - ins.y) <= 2.2) {
          ins.drill -= dt;
          if (ins.drill <= 0) {
            const got = randK(s, pr.min, pr.max);
            s.dirty += got;
            ins.taken.push(ins.drillAt);
            ins.drill = -1;
            s.cool[ins.poi] = dayOf(s) + pr.days;
            s.crimes += 1;
            ev.push({ type: 'toast', text: `金庫が開いた　+${yen(got)}（汚れたお金）`, tone: 'good' }, { type: 'sfx', name: 'bigcoin' });
          }
        }
      }
    }
    if (ins.alarm > 0) {
      ins.alarm -= dt;
      if (ins.alarm <= 0) {
        ins.alarm = 0;
        addHeat(s, pr ? pr.heat : bal.heat.burgleLoud + 14, bal, ev);
        ev.push({ type: 'toast', text: '通報された', tone: 'bad' }, { type: 'sfx', name: 'fail' });
      }
    }
    return ev;
  }
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
          c.x = ax + (bx - ax) * f + ((by - ay) / len) * (city.half(false) + 2.8);
          c.y = ay + (by - ay) * f - ((bx - ax) / len) * (city.half(false) + 2.8);
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
      if (car && dist < 6.5 && s.hitCd <= 0) {
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
      return f > 0.5 && f < 21 && Math.abs(rx * fy - ry * fx) < 3.4;
    };
    if (dist < 24 && ahead(s.x, s.y)) blocked = true;
    else for (const o of s.cars) if (o !== c && o.kind !== 'parked' && Math.abs(o.x - c.x) < 22 && Math.abs(o.y - c.y) < 22 && ahead(o.x, o.y)) {
      blocked = true;
      break;
    }
    follow(c, s, city, bal, dt, blocked);
    if (car && dist < 6.5 && speed > 5 && s.hitCd <= 0) {
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
    if (car && speed > 6 && Math.hypot(p.x - s.x, p.y - s.y) < 4.5) {
      s.peds.splice(i, 1);
      addHeat(s, bal.heat.hitPed, bal, ev);
      ev.push({ type: 'sfx', name: 'crash' });
    }
  }

  // 敵の組織の見張り：アジトに近づくと出てくる。近づきすぎるか、撃つと、撃ってくる
  s.fireCd = Math.max(0, s.fireCd - dt);
  s.hostile = Math.max(0, s.hostile - dt);
  s.warnCd = Math.max(0, s.warnCd - dt);
  for (let i = s.shots.length - 1; i >= 0; i--) if ((s.shots[i].t -= dt) <= 0) s.shots.splice(i, 1);
  if (s.spawnT === 0.5) {
    const day = dayOf(s);
    s.thugs = s.thugs.filter((t) => Math.hypot(t.x - s.x, t.y - s.y) < 700);
    for (const p of city.pois) {
      if (p.kind !== 'gang' || Math.hypot(p.x - s.x, p.y - s.y) > 450) continue;
      const t = turfOf(city.size, p.x, p.y);
      if (s.turf[t] === -1 || (s.cool[p.id] ?? 0) > day || s.thugs.some((g) => g.base === p.id)) continue;
      for (let k = 0; k < bal.gang.guards; k++) {
        const x = p.x + (k - (bal.gang.guards - 1) / 2) * 7;
        const y = p.y + 1 + (k % 2) * 4;
        if (!solid(city, x, y, 1.2)) s.thugs.push({ id: s.nextId++, x, y, hx: x, hy: y, hp: bal.gang.thugHp, gang: s.turf[t], base: p.id, cd: 0.6 + rnd(s), a: Math.PI / 2, flash: 0 });
      }
    }
  }
  let danger = false;
  for (const t of s.thugs) {
    const d = Math.hypot(t.x - s.x, t.y - s.y);
    const angry = d < 85 && (s.hostile > 0 || d < bal.gang.warnDist);
    if (!angry && d < 85 && s.warnCd <= 0) {
      s.warnCd = 90;
      ev.push({ type: 'toast', text: `${GANGS[t.gang].name}の見張りだ。赤い輪に入ると撃たれる`, tone: 'bad' });
    }
    t.flash = Math.max(0, t.flash - dt);
    // 怒ると、1人ずつ別の向きから囲みに来る（同じ所に固まらない）
    const ring = 13 + (t.id % 3) * 4;
    const tx = angry ? s.x + Math.cos(t.id * 2.4) * ring : t.hx;
    const ty = angry ? s.y + Math.sin(t.id * 2.4) * ring : t.hy;
    const td = Math.hypot(tx - t.x, ty - t.y);
    if (td > (angry ? 2.5 : 1)) {
      const nx = t.x + ((tx - t.x) / td) * 3.4 * dt;
      const ny = t.y + ((ty - t.y) / td) * 3.4 * dt;
      if (!solid(city, nx, t.y, 1.2)) t.x = nx;
      if (!solid(city, t.x, ny, 1.2)) t.y = ny;
      t.a = Math.atan2(ty - t.y, tx - t.x);
    }
    if (!angry) continue;
    danger = true;
    if (s.hostile <= 0) s.hostile = 8;
    t.a = Math.atan2(s.y - t.y, s.x - t.x);
    t.cd -= dt;
    if (t.cd <= 0) {
      t.cd = 1.0 + rnd(s) * 0.8;
      const hit = rnd(s) < bal.gang.thugHit * (car ? 0.6 : 1);
      s.shots.push({ x0: t.x, y0: t.y, x1: s.x + (hit ? 0 : 5), y1: s.y + (hit ? 0 : 4), t: 0.12 });
      if (hit) s.hp -= bal.gang.thugDamage * (car ? 0.6 : 1);
      ev.push({ type: 'sfx', name: hit ? 'hurt' : 'shot' });
    }
  }
  if (!danger && s.hp < 100) s.hp = Math.min(100, s.hp + 4 * dt);
  if (s.hp <= 0) {
    // 倒された：現金の一部を失い、半日後に自宅で目を覚ます
    const lost = Math.round(Math.max(0, s.cash) * bal.gang.downLoss) + s.loot;
    s.cash -= Math.round(Math.max(0, s.cash) * bal.gang.downLoss);
    s.loot = 0;
    const carNow = riding(s);
    if (carNow && carNow.kind === 'stolen') s.cars = s.cars.filter((c) => c !== carNow);
    s.ride = null;
    s.x = city.home.x;
    s.y = city.home.y + 4;
    s.hp = 100;
    skip(s, city, 12 * 60, bal, ev);
    ev.push({ type: 'down', lost });
    return ev;
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
    gun: s.gun, hide: s.hide, stash: s.stash, turf: s.turf, lockpick: s.lockpick, drill: s.drill, keys: s.keys,
    mine: mine ? { bike: mine.bike, x: mine.x, y: mine.y, a: mine.a, riding: s.ride === mine.id } : null,
  };
}
export type SaveData = ReturnType<typeof toSave>;
export function fromSave(d: SaveData, city: City, bal: Balance): GameState {
  const s = createGame(d.seed, city, bal);
  Object.assign(s, { rng: d.rng, clock: d.clock, x: d.x, y: d.y, cash: d.cash, dirty: d.dirty, bank: d.bank, loot: d.loot, heat: d.heat, record: d.record, crowbar: d.crowbar, laptop: d.laptop, biz: d.biz, cool: d.cool, earned: d.earned, crimes: d.crimes, gun: !!d.gun, hide: d.hide ?? null, stash: d.stash ?? 0, turf: d.turf ?? s.turf, lockpick: !!d.lockpick, drill: !!d.drill, keys: d.keys ?? [] });
  if (d.mine) {
    const c: Car = { id: s.nextId++, kind: 'mine', bike: d.mine.bike, x: d.mine.x, y: d.mine.y, a: d.mine.a, v: 0, color: d.mine.bike ? 0x1f8a6f : 0x2f7fc1, from: 0, to: 0, s: 0, chase: false, think: 0, path: [], stuck: 0, value: 0 };
    s.cars.push(c);
    if (d.mine.riding) s.ride = c.id;
  }
  return s;
}
