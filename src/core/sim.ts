// ルール本体：状態を持ち、決まった刻み（1/30秒）で進める。画面のことは知らない。
// 書き換えは「命令」（apply）と「1コマ進める」（step）だけで行う。乱数は種つき。
import type { Balance } from '../data/schema';
import { blocked, camSees, roomOf, type Room } from './rooms';
import { addCredit, auditChance, capCredit, closeMonth, custK, EVENTS, learn, phaseOf, turnMonth, monthOf, newEco, rankIndex, rankOf, takeLoan, type Eco, type MonthRec } from './eco';
import { apartFill, apartIncome, apartPrice, arriveRate, askOne, dayShop, dayWorks, hire, lineDay, PROC_NAMES, procCaps, perfOf, monthStaff, newFirm, newShop, openConds, recruit, repairCost, rivalsReact, serve, wagesOf, type Firm, type Shop } from './shop';
import { endMonth, fameOf, firstUnits, left, newTr, offerBids, pitch, quality, record, settleDeals, startMonth, workMins, type Tr } from './trade';
import { edgeArterial, findPath, GANGS, nearestNode, neighbors, nodeXY, roadAt, solid, turfOf, type City, type Poi, type PoiKind } from './city';

export const STEP = 1 / 30;
export const SAVE_VERSION = 2;

export type CarKind = 'npc' | 'parked' | 'police' | 'hunter' | 'mine' | 'stolen';
export interface Car { id: number; kind: CarKind; bike: boolean; x: number; y: number; a: number; v: number; color: number; from: number; to: number; s: number; chase: boolean; think: number; path: number[]; stuck: number; value: number }
export interface Ped { x: number; y: number; from: number; to: number; s: number; side: number; speed: number; color: number }
export interface Thug { id: number; x: number; y: number; hx: number; hy: number; hp: number; gang: number; base: number; cd: number; a: number; flash: number }
export interface Shot { x0: number; y0: number; x1: number; y1: number; t: number }
export type Biz = Shop; // 来店型の店（屋台・店）
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
  cased: Record<number, number>; // 下見をした家と、その日
  eco: Eco; // 経営のお金（月末の締め・信用・借入・税）
  tr: Tr; // 商売（仕事の枠・知名度・届いた話・作品）
  firm: Firm; // 人・物件・資格
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
  | { type: 'day'; profit: number; washed: number; turf: number; lost: string; news: string }
  | { type: 'month'; rec: MonthRec } // 月末の締め（月次レポート）
  | { type: 'bankrupt' }
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
  | { type: 'gig'; id: number; take: boolean } // 届いた話を受ける・断る
  | { type: 'line'; act: 'a' | 'b' | 'fareUp' | 'fareDown' | 'add' } // バスの路線：停まる場所・運賃・台数
  | { type: 'bid'; id: number; act: 'low' | 'mid' | 'high' | 'call' } // 契約の話：見積を変える・通う
  | { type: 'staff'; id: number; act: 'ask' | 'hire' | 'fire' | 'raise' | 'talk' | 'assign' | 'boss' | 'proc' | 'wageUp' | 'wageDown'; k?: 0 | 1 | 2 } // 人のこと
  | { type: 'loan'; id: number; kind: 'start' | 'bank'; amount: number; plan?: number }
  | { type: 'shoot'; x: number; y: number } // 決まった点へ撃つ（ほかの人と遊ぶとき）
  | { type: 'hurt'; amount: number; x: number; y: number }; // ほかの人に撃たれた
export interface Act { id: string; label: string; sub?: string; ok: boolean; why?: string; mini?: boolean; crime?: boolean }

export const POI_NAME: Record<PoiKind, string> = { home: '自宅', conbini: 'コンビニ', warehouse: '倉庫', bike: '自転車屋', car: '中古車屋', tool: '道具屋', pawn: '質屋', chop: '解体屋', bank: '銀行', police: '警察署', lot: '空き店舗', atm: 'ATM', house: '留守の家', hideout: '空き倉庫', gang: '敵のアジト', jewel: '宝石店', market: '売り場', office: '窓口', apart: 'アパート' };
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
  const s: GameState = {
    seed, rng: (seed ^ 0x9e3779b9) >>> 0, t: 0, clock: bal.time.startHour * 60,
    x: city.home.x, y: city.home.y + 4, a: Math.PI / 2, ride: null,
    cash: bal.money.startCash, dirty: 0, bank: 0, loot: 0, heat: 0, record: 0,
    crowbar: false, laptop: false, biz: [], cool: {}, way: null, route: [],
    cars: [], peds: [], nextId: 1, seen: false, catchT: 0, hitCd: 0, spawnT: 0, earned: 0, crimes: 0, inside: null,
    hp: 100, gun: false, hide: null, stash: 0, turf: [0, 1, 2, 1, 2, 0], hostile: 0, fireCd: 0, warnCd: 0, thugs: [], shots: [], lockpick: false, drill: false, keys: [], cased: {}, eco: newEco(bal), tr: newTr(), firm: newFirm(),
  };
  startMonth(s.tr, 0, clientsOf(city), monthRng(seed, 0), bal); // 最初の月の枠と、届く話
  return s;
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
  if (q.kind === 'apart') return s.firm.aparts.some((a) => a.poi === q.id);
  return s.biz.some((z) => z.poi === q.id);
}
// 表のお金で払う（現金、足りなければ預金から）
function payClean(s: GameState, amount: number): boolean {
  if (s.cash + Math.max(0, s.bank) < amount) return false;
  const a = Math.min(s.cash, amount);
  s.cash -= a;
  s.bank -= amount - a;
  return true;
}
// 数字の見え方：知識が低い業種では、幅で見える。幅は ±（100 − 知識）÷ 4 %
export const fuzz = (v: number, know: number): [number, number] => [v * (1 - (100 - know) / 400), v * (1 + (100 - know) / 400)];

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
// 場所でできること。契約の相手の場所では、いちばん上に「契約の仕事」が出る
export function poiActions(s: GameState, city: City, p: Poi, bal: Balance): Act[] {
  const acts = baseActions(s, city, p, bal);
  const dl = s.tr.deals.find((x) => x.poi === p.id && x.done < x.visits);
  if (dl) acts.unshift({ id: 'deal', label: '契約の仕事をする', sub: `${bal.deal.visitMins}分・今月 ${dl.done}/${dl.visits}回`, ok: true });
  return acts;
}
function baseActions(s: GameState, city: City, p: Poi, bal: Balance): Act[] {
  const m = bal.money;
  const st = stars(s, bal);
  const h = hourOf(s);
  const cd = (s.cool[p.id] ?? 0) - dayOf(s);
  const car = riding(s);
  const tr = s.tr;
  // 夜の仕事のために、夜まで時間を進める
  const NAP: Act = { id: 'nap', label: '夜まで休む', sub: '22時に起きる', ok: !s.seen && h >= 5 && h < 21, why: s.seen ? '警察に見られている' : 'もう夜' };
  switch (p.kind) {
    case 'home':
      return [{ id: 'sleep', label: '朝まで寝る', sub: '手配度が下がる・疲れが取れる', ok: !s.seen, why: '警察に見られている' }, NAP, ...homeActs(s, bal)];
    case 'market': {
      const n = ['craftSmall', 'craftOrder'].reduce((a, id) => a + Math.min(tr.stock[id] ?? 0, left(tr, id)), 0);
      const have = (tr.stock.craftSmall ?? 0) + (tr.stock.craftOrder ?? 0);
      return [
        { id: 'sellGoods', label: '作った品を納める', sub: have ? `${n}個 売れる（今月の枠の残り ${left(tr, 'craftSmall')}）` : '品を持っていない', ok: n > 0, why: have ? '今月の枠がいっぱい' : '品を持っていない' },
        { id: 'wholesale', label: '余った品を卸に売る', sub: have > n ? `${have - n}個・半値・代金は翌月末` : '余っていない', ok: have > n && rankIndex(s.eco.credit) >= 1, why: have > n ? '卸との取引は、信用のランク D から' : '余っていない' },
        { id: 'pitchCraft', label: '品を売り込む', sub: '2時間・今月の枠が増える', ok: h >= 8 && h < 20, why: '8時〜20時だけ' },
        { id: 'pitchHandy', label: '便利屋のチラシを置く', sub: '2時間・話が届く', ok: h >= 8 && h < 20, why: '8時〜20時だけ' },
      ];
    }
    case 'office': {
      const P = bal.permit;
      const T = bal.staff;
      const post = s.firm.post;
      const open = h >= 9 && h < 17;
      const food = s.firm.permits.includes('food');
      return [
        { id: 'lecture', label: '食品衛生の講習を受ける', sub: food ? '受けてある' : `${yen(P.foodFee)}・${P.foodHours}時間／屋台や飲食店に要る`, ok: !food && open && s.cash + Math.max(0, s.bank) >= P.foodFee, why: food ? '受けてある' : open ? 'お金が足りない' : '9時〜17時だけ' },
        { id: 'postPaper', label: '求人の張り紙を出す', sub: post && !post.site ? '出している' : '無料・届く人は少ない', ok: !post || post.site, why: '出している' },
        { id: 'postSite', label: '求人サイトに載せる', sub: post?.site ? '載せている' : `月 ${yen(T.siteFee)}・多くの人に届く`, ok: !post?.site, why: '載せている' },
        { id: 'postOff', label: '求人をやめる', sub: post ? `日給 ${yen(post.wage)} で出している` : '出していない', ok: !!post, why: '出していない' },
        { id: 'lawyer', label: '弁護士を頼んでおく', sub: s.firm.lawyer ? '頼んである' : `${yen(bal.law.lawyer)}（表のお金）／捕まったとき、出られるまでが7割の長さ`, ok: !s.firm.lawyer && s.cash + Math.max(0, s.bank) >= bal.law.lawyer, why: s.firm.lawyer ? '頼んである' : 'お金が足りない' },
        { id: 'hide', label: 'もうけを少なく申告する', sub: `いま ${Math.round(s.eco.hide * 100)}%を隠す／税務調査の見込み ${Math.round(auditChance(s.eco, bal) * 100)}%・見つかると隠した税の${bal.law.penalty}倍`, ok: true, crime: true },
        { id: 'busLecture', label: '運行管理者の講習を受ける', sub: s.firm.permits.includes('transit') ? '受けてある' : `${yen(bal.bus.lecture)}・${bal.bus.lectureHours}時間／バスの路線に要る`, ok: !s.firm.permits.includes('transit') && open && s.cash + Math.max(0, s.bank) >= bal.bus.lecture, why: s.firm.permits.includes('transit') ? '受けてある' : open ? 'お金が足りない' : '9時〜17時だけ' },
        { id: 'busStart', label: 'バスの路線を始める', sub: s.firm.line ? '走らせている' : `バス${bal.bus.min}台 ${yen(bal.bus.price * bal.bus.min)}（営業所ごとに${bal.bus.min}台から）`, ok: !s.firm.line && s.firm.permits.includes('transit') && s.cash + Math.max(0, s.bank) >= bal.bus.price * bal.bus.min, why: s.firm.line ? '走らせている' : !s.firm.permits.includes('transit') ? '運行管理者の講習が要る' : 'お金が足りない' },
        { id: 'insure', label: s.eco.insured ? '保険をやめる' : '保険に入る', sub: `月 ${yen(bal.town.insure)}／台風や工事で減った売上の半分が戻る`, ok: true },
        { id: 'advice', label: '聞きに行く', sub: '1時間', ok: open, why: '9時〜17時だけ' },
      ];
    }
    case 'apart': {
      const A = bal.apart;
      const a = s.firm.aparts.find((x) => x.poi === p.id);
      const price = apartPrice(p.traffic, bal, phaseOf(s.eco).estate);
      if (!a) return [{ id: 'buyApart', label: 'このアパートを買う', sub: `${yen(price)}／満室で月 ${yen(A.rooms * A.unit - A.upkeep)}`, ok: s.cash + Math.max(0, s.bank) >= price, why: '表のお金が足りない（銀行の融資も使える）' }];
      const fill = Math.round(apartFill(a, p.traffic) * A.rooms);
      return [
        { id: 'rentUp', label: '家賃を上げる', sub: `いま 相場の ${Math.round(a.rent * 100)}%・${fill}/${A.rooms}室・月 ${yen(apartIncome(a, p.traffic, bal))}`, ok: a.rent < 1.45, why: 'これ以上は上げられない' },
        { id: 'rentDown', label: '家賃を下げる', sub: `いま 相場の ${Math.round(a.rent * 100)}%`, ok: a.rent > 0.75, why: 'これ以上は下げられない' },
        { id: 'repair', label: '修繕する', sub: a.state >= 0.99 ? '傷んでいない' : `${yen(repairCost(a, bal))}／状態 ${Math.round(a.state * 100)}%`, ok: a.state < 0.99 && s.cash + Math.max(0, s.bank) >= repairCost(a, bal), why: a.state >= 0.99 ? '傷んでいない' : 'お金が足りない' },
      ];
    }
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
        { id: 'mats', label: '材料を10個買う', sub: `${yen(matCost(s, bal))}／手作りの品（いま ${tr.mats}個）`, ok: s.cash + s.dirty >= matCost(s, bal), why: 'お金が足りない' },
        { id: 'matsBulk', label: `材料を${bal.works.bulk}個 仕入れる`, sub: rankIndex(s.eco.credit) >= 1 ? `${yen(matCost(s, bal) * (bal.works.bulk / 10) * bal.works.bulkOff)}／卸の値段（1割安い）` : '卸との取引は、信用のランク D から', ok: rankIndex(s.eco.credit) >= 1 && s.cash + Math.max(0, s.bank) >= matCost(s, bal) * (bal.works.bulk / 10) * bal.works.bulkOff, why: rankIndex(s.eco.credit) >= 1 ? 'お金が足りない' : '信用のランク D から' },
        { id: 'power', label: '電動の道具を買う', sub: tr.power ? '持っている' : `${yen(m.power)}／作るのが速くなる・品質が上がる`, ok: !tr.power && s.cash + s.dirty >= m.power, why: tr.power ? '持っている' : 'お金が足りない' },
        { id: 'washer', label: '洗浄の道具を買う', sub: tr.washer ? '持っている' : `${yen(m.washer)}／便利屋の高い仕事`, ok: !tr.washer && s.cash + s.dirty >= m.washer, why: tr.washer ? '持っている' : 'お金が足りない' },
        { id: 'crowbar', label: 'バールを買う', sub: s.crowbar ? '持っている' : `${yen(m.crowbar)}／こじ開ける（音が出る）`, ok: !s.crowbar && s.cash + s.dirty >= m.crowbar, why: s.crowbar ? '持っている' : 'お金が足りない' },
        { id: 'laptop', label: 'ノートPCを買う', sub: s.laptop ? '持っている' : `${yen(m.laptop)}／ATM・監視カメラ`, ok: !s.laptop && s.cash + s.dirty >= m.laptop, why: s.laptop ? '持っている' : 'お金が足りない' },
        { id: 'lockpick', label: 'ピッキング道具を買う', sub: s.lockpick ? '持っている' : `${yen(m.lockpick)}／鍵を静かに開ける`, ok: !s.lockpick && s.cash + s.dirty >= m.lockpick, why: s.lockpick ? '持っている' : 'お金が足りない' },
        { id: 'drill', label: 'ドリルを買う', sub: s.drill ? '持っている' : `${yen(m.drill)}／金庫を破る`, ok: !s.drill && s.cash + s.dirty >= m.drill, why: s.drill ? '持っている' : 'お金が足りない' },
      ];
    case 'pawn':
      return [
        { id: 'sell', label: '盗んだ物を売る', sub: s.loot > 0 ? `+${yen(s.loot * m.pawnRate)}（汚れたお金）` : '何も持っていない', ok: s.loot > 0, why: '何も持っていない', crime: true },
        { id: 'wash', label: 'お金を洗う', sub: `汚れたお金 → きれいなお金（手数料${Math.round((1 - m.washRate) * 100)}%・1日 ${yen(m.washCap)}まで）`, ok: s.dirty > 0 && cd <= 0, why: s.dirty <= 0 ? '汚れたお金がない' : '今日はもう洗った', crime: true },
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
        { id: 'loan', label: '融資の相談', sub: `信用のランク ${rankOf(s.eco.credit)}`, ok: true },
      ];
    case 'police': {
      const fine = Math.round(s.heat * bal.heat.fine);
      if (st > 3) return [{ id: 'surrender', label: '自首する', sub: `罰金と、出られるまでの時間が半分になる（罰金 ${yen(fine * bal.law.surrender)}）`, ok: true, crime: true }];
      return [{ id: 'fine', label: '罰金を払って出頭する', sub: st > 0 ? yen(fine) : '手配されていない', ok: st >= 1 && st <= 3 && s.cash >= fine, why: st === 0 ? '手配されていない' : st > 3 ? '罪が重すぎる' : 'きれいなお金が足りない' }];
    }
    case 'lot': {
      const z = s.biz.find((x) => x.poi === p.id);
      const S = bal.shop;
      const money = s.cash + Math.max(0, s.bank);
      if (z && z.type === 'works') {
        const caps = procCaps(z, s.firm, perfOf(z, s.firm, dayOf(s), bal), bal);
        const crewN = s.firm.staff.filter((q) => q.at === p.id).length;
        return [
          { id: 'manage', label: '工房を見る（1時間）', sub: !crewN ? '人がいない' : z.boss ? '工場長に任せてある' : z.seen >= dayOf(s) ? 'きょうは見た' : 'きょうは、まだ見ていない', ok: crewN > 0 && !z.boss && z.seen < dayOf(s), why: !crewN ? '人がいない' : z.boss ? '任せてある' : 'きょうは見た' },
          ...PROC_NAMES.map((n, i) => ({ id: `mach${i}`, label: `「${n}」の機械を買う`, sub: z.mach[i] ? '入れてある' : `${yen(bal.works.machine)}／1日 ${caps[i]}個（いちばん少ない工程が、作れる数になる）`, ok: !z.mach[i] && money >= bal.works.machine, why: z.mach[i] ? '入れてある' : 'お金が足りない' })),
          { id: 'closeShop', label: '工房をたたむ', sub: `保証金 ${yen(z.deposit)} が戻る`, ok: true },
        ];
      }
      if (z) {
        const crew = s.firm.staff.filter((q) => q.at === p.id).length;
        const [lo, hi] = fuzz(arriveRate(z, trafficAt(s, city, p, bal), bal), s.eco.know[z.type === 'stall' ? 'food' : 'retail'] ?? 0);
        return [
          { id: 'tend', label: '店に立つ（4時間）', sub: `客は1時間に ${lo.toFixed(1)}〜${hi.toFixed(1)}人ほど`, ok: h >= 7 && h < 21, why: '7時〜21時だけ' },
          { id: 'manage', label: '店を見る（1時間）', sub: !crew ? '人がいない' : z.boss ? '店長に任せてある' : z.seen >= dayOf(s) ? 'きょうは見た' : 'きょうは、まだ見ていない', ok: crew > 0 && !z.boss && z.seen < dayOf(s), why: !crew ? '人がいない' : z.boss ? '店長に任せてある' : 'きょうは見た' },
          { id: 'priceUp', label: '値段を上げる', sub: `いま 相場の ${Math.round(z.price * 100)}%`, ok: z.price < 1.45, why: 'これ以上は上げられない' },
          { id: 'priceDown', label: '値段を下げる', sub: `いま 相場の ${Math.round(z.price * 100)}%`, ok: z.price > 0.75, why: 'これ以上は下げられない' },
          { id: 'ad', label: '広告を出す', sub: `${yen(S.ad)}／認知 ${Math.round(z.aware)}（評判 ${Math.round(z.repute)}）`, ok: money >= S.ad, why: 'お金が足りない' },
          { id: 'mix', label: s.eco.mix ? '汚れたお金を混ぜるのをやめる' : '売上に汚れたお金を混ぜる', sub: `売上の2割まで、きれいになる／税務調査の見込み ${Math.round(auditChance(s.eco, bal) * 100)}%・見つかると没収`, ok: true, crime: true },
          { id: 'closeShop', label: '店をたたむ', sub: z.deposit ? `保証金 ${yen(z.deposit)} が戻る` : `道具が ${yen(bal.biz.stall / 2)} で売れる`, ok: true },
        ];
      }
      const st = openConds('stall', p.traffic, rankIndex(s.eco.credit), money, s.firm, bal);
      const sh = openConds('shop', p.traffic, rankIndex(s.eco.credit), money, s.firm, bal);
      const wk = openConds('works', p.traffic, rankIndex(s.eco.credit), money, s.firm, bal);
      const ng = (c: typeof st) => c.conds.find((x) => !x.ok)?.label;
      return [
        { id: 'stall', label: '屋台を出す', sub: ng(st) ?? `${yen(st.setup)}／家賃なし`, ok: !ng(st), why: ng(st) },
        { id: 'shop', label: '店を借りて開く', sub: ng(sh) ?? `保証金 ${yen(sh.deposit)}＋内装 ${yen(sh.setup)}／家賃 1日 ${yen(sh.rent)}`, ok: !ng(sh), why: ng(sh) },
        { id: 'works', label: '工房を開く', sub: ng(wk) ?? `保証金 ${yen(wk.deposit)}＋準備 ${yen(wk.setup)}／人が小物を作る`, ok: !ng(wk), why: ng(wk) },
      ];
    }
    case 'atm':
      return [{ id: 'hack', label: 'ハッキングする', sub: !s.laptop ? 'ノートPCが要る' : cd > 0 ? `対策中（あと${cd}日）` : 'うまくいけば大金', ok: s.laptop && cd <= 0, why: !s.laptop ? 'ノートPCが要る' : '対策中', mini: true, crime: true }];
    case 'house': {
      const g = tr.gigs.find((x) => x.taken && x.poi === p.id);
      const out: Act[] = [];
      if (g) {
        const job = bal.jobs[g.job];
        out.push({ id: 'gig', label: `${job.name}をする`, sub: `${workMins(job, s.eco.know.handy ?? 0, tr, s.eco.fatigue)}分・+${yen(job.price - job.mat)}`, ok: true });
      }
      const cased = (s.cased[p.id] ?? -99) >= dayOf(s) - bal.law.caseDays;
      if (s.crowbar) out.push({ id: 'case', label: '下見をする', sub: cased ? '下見してある' : `${bal.law.caseHours}時間／通報までの時間が${bal.law.caseAlarm}倍に延びる`, ok: !cased && cd <= 0, why: cased ? '下見してある' : '用心している', crime: true });
      out.push({ id: 'break', label: 'こじ開けて入る', sub: cd > 0 ? `用心している（あと${cd}日）` : `通報まで ${Math.round(bal.crime.alarmQuiet * (cased ? bal.law.caseAlarm : 1))}秒（音を立てると ${Math.round(bal.crime.alarmLoud * (cased ? bal.law.caseAlarm : 1))}秒）・${isNight(s) ? '夜は見つかりにくい' : '昼は見つかりやすい'}`, ok: s.crowbar && cd <= 0, why: !s.crowbar ? 'バールが要る' : '用心している', mini: true, crime: true });
      return out;
    }
  }
}

// ---- 建物の中
// 聞きに行く：いまの数字の中から、気にしたほうがいい1つを、現実で使う言葉で一言だけ言う。どう直すかは言わない
export function adviceOf(s: GameState, bal: Balance): string {
  const e = s.eco;
  const money = s.cash + Math.max(0, s.bank);
  if (e.owed.length) return '「支払いが遅れていますね」';
  if (money < monthLiving(s, bal)) return '「手元資金が、月の固定費を下回っていますね」';
  if (e.fatigue > 70) return '「働きすぎですね。体が資本ですよ」';
  if (e.loans.length && e.hist.length && e.loans.reduce((a, l) => a + l.pay, 0) > Math.max(1, e.hist[e.hist.length - 1].profit) * 0.5) return '「返済負担が重いですね」';
  if (e.m.sales > 0 && e.m.cost / e.m.sales > 0.6) return '「原価率が高いね」';
  if (e.credit < 200) return '「信用がまだ足りませんね。続けることです」';
  if (s.tr.titles.length === 0 && Object.values(s.tr.used).every((n) => !n) && s.biz.length === 0) return '「まずは小さく始めてみては」';
  return '「順調ですね。数字は毎月見ましょう」';
}

// 自宅でできる商売：手作りの品（作業台）、個人開発（机とPC）、休む
function homeActs(s: GameState, bal: Balance): Act[] {
  const tr = s.tr;
  const m = bal.money;
  const J = bal.jobs;
  const kc = s.eco.know.craft ?? 0;
  const mins = (id: string, n: number) => workMins(J[id], id.startsWith('craft') ? kc : s.eco.know.soft ?? 0, tr, s.eco.fatigue) * n;
  const out: Act[] = [
    { id: 'craftSmall', label: '小物を4つ作る', sub: `材料4個・${mins('craftSmall', 4)}分（材料 ${tr.mats}個）`, ok: tr.mats >= 4, why: '材料が足りない。道具屋で買える' },
    { id: 'craftOrder', label: '注文品を1つ作る', sub: fameOf(tr, 'craft') < J.craftOrder.fame ? `知名度 ${J.craftOrder.fame} から注文が届く（いま ${fameOf(tr, 'craft')}）` : `材料6個・${mins('craftOrder', 1)}分`, ok: fameOf(tr, 'craft') >= J.craftOrder.fame && tr.mats >= 6, why: fameOf(tr, 'craft') < J.craftOrder.fame ? 'まだ注文が届かない' : '材料が足りない' },
    { id: 'rest', label: '2時間 休む', sub: `疲れ ${Math.round(s.eco.fatigue)}`, ok: s.eco.fatigue > 0, why: '疲れていない' },
  ];
  if (!tr.proj) {
    for (const id of ['softSmall', 'softMid']) out.push({ id: id === 'softSmall' ? 'devSmall' : 'devMid', label: `${J[id].name}を作り始める`, sub: s.laptop ? `${J[id].hours}時間・1本 ${yen(J[id].price)}・見込み ${firstUnits(J[id], fameOf(tr, 'soft'), false)}本` : 'ノートPCが要る', ok: s.laptop, why: 'ノートPCが要る。道具屋で買える' });
  } else {
    const job = J[tr.proj.job];
    out.push({ id: 'dev', label: '4時間 作る', sub: `${job.name}　${Math.floor(tr.proj.hours)} / ${job.hours}時間`, ok: true });
    out.push({ id: 'devOut', label: '絵と音を外に頼む', sub: tr.proj.out ? '頼んである' : `${yen(m.devOut)}／作る時間が4分の3・本数が1.3倍`, ok: !tr.proj.out && s.cash + s.dirty >= m.devOut, why: tr.proj.out ? '頼んである' : 'お金が足りない' });
  }
  return out;
}

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
    // 銃がなくても場所は見せる（押すと「銃が要る」と分かる）
    case 'threat': return ins.staff && !ins.held;
    case 'guard': return !ins.guardDown;
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
    case 'guard': return c(s.gun ? sp.label : sp.h === 'guard' ? '警備員（銃があれば脅せる）' : '店員（銃があれば脅せる）', s.gun, '銃が要る。質屋で買える');
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
  // 人がいる店は、きょう1日 開いていた。売上に混ぜられる汚れたお金は、本当の売上の2割まで
  let sales = 0;
  let cost = 0;
  for (const z of s.biz) {
    if (z.type === 'works') {
      const w = dayWorks(z, s.firm, s.tr.mats, s.eco.days, bal);
      s.tr.mats -= w.used;
      s.tr.stock.craftSmall = (s.tr.stock.craftSmall ?? 0) + w.made;
      continue;
    }
    const t = dayShop(z, s.firm, trafficAt(s, city, city.pois[z.poi], bal), s.eco.days, bal, s.eco.fx.includes('matUp') ? 1.15 : 1);
    sales += t.sales;
    cost += t.cost;
  }
  if (s.firm.line) {
    const ln = s.firm.line;
    const [pa, pb] = [city.pois[ln.a], city.pois[ln.b]];
    const t = lineDay(ln, pa.traffic, pb.traffic, Math.hypot(pa.x - pb.x, pa.y - pb.y), bal);
    sales += t.sales;
    cost += t.cost;
  }
  const profit = sales - cost;
  const washed = s.eco.mix ? Math.min(s.dirty, Math.round(sales * bal.shop.mix)) : 0;
  s.eco.mixed += washed;
  s.dirty -= washed;
  s.bank += profit + washed;
  s.earned += profit;
  s.eco.m.sales += sales;
  s.eco.m.cost += cost;
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
  ev.push({ type: 'day', profit, washed, turf, lost, news });
  // 月末の締め：給料 → 家賃 → 返済 → 生活費 → 税 の順に払う。払えない物は来月へ回り、2か月続くと倒産
  s.eco.days += 1;
  if (s.eco.days % bal.time.daysPerMonth === 0) {
    const ended = monthOf(s.eco, bal) - 1;
    const active = s.biz.length > 0 || !!s.firm.line || s.firm.aparts.length > 0 || s.tr.deals.length > 0 || s.tr.titles.length > 0 || Object.values(s.tr.used).some((n) => n > 0);
    // 物件の家賃収入（資産型）。年末に、建物が少し傷む
    let estate = 0;
    for (const a of s.firm.aparts) estate += apartIncome(a, city.pois[a.poi].traffic, bal);
    s.bank += Math.max(0, estate);
    s.eco.m.sales += Math.max(0, estate);
    s.eco.m.cost += Math.max(0, -estate);
    if ((ended + 1) % bal.time.monthsPerYear === 0) for (const a of s.firm.aparts) a.state = Math.max(0.5, a.state - bal.apart.decay);
    // 人：給料は月末に払う。求人サイトの掲載料。任せた店長がまじめでないと、横領が起きることがある（数字にだけ出る）
    const wages = wagesOf(s.firm, bal);
    // 家賃と光熱費の中に、求人サイトの掲載料と保険料も入れて払う
    const rent = s.biz.reduce((a, z) => a + z.rent, 0) * bal.time.daysPerMonth + (s.firm.post?.site ? bal.staff.siteFee : 0) + (s.eco.insured ? bal.town.insure : 0);
    const mr = monthRng(s.seed, 5000 + ended);
    for (const z of s.biz) {
      const boss = s.firm.staff.find((q) => q.id === z.boss);
      if (boss && boss.honest < 30 && mr() < bal.staff.skim) {
        const loss = Math.min(Math.max(0, s.bank), Math.round(z.m.sales * bal.staff.skimRate));
        s.bank -= loss;
        s.eco.m.cost += loss;
      }
    }
    const dealNotes = settleDeals(s.tr, ended, rankIndex(s.eco.credit), bal);
    const me = endMonth(s.tr, ended, bal);
    me.notes.push(...dealNotes);
    s.bank += me.income;
    s.earned += me.income;
    s.eco.m.sales += me.income;
    if (s.tr.broken) addCredit(s.eco, -10 * s.tr.broken, bal); // 受けて守れなかった話は、信用も下げる
    const out = closeMonth(s.eco, { cash: s.cash, bank: s.bank, living: monthLiving(s, bal), wages, rent, hasBiz: active, audit: mr() }, bal);
    if (out.caught > 0) {
      // 混ぜたお金が見つかった：没収され、手配される
      out.bank -= Math.min(Math.max(0, out.bank), out.caught);
      addHeat(s, 60, bal, ev);
    }
    out.rec.notes.push(...me.notes);
    // 保険：台風や工事で減った売上の半分が戻る。入っていなければ、入っていた場合との差を見せる
    const hit = s.eco.fx.filter((k) => k === 'road' || k === 'typhoon');
    if (hit.length && s.biz.length) {
      const k = (s.eco.fx.includes('road') ? 0.75 : 1) * (s.eco.fx.includes('typhoon') ? 0.6 : 1);
      const back = Math.round(s.biz.reduce((a, z) => a + z.m.sales, 0) * (1 / k - 1) * bal.town.refund);
      if (s.eco.insured) {
        out.bank += back;
        out.rec.money += back;
        out.rec.notes.push(`保険で ${yen(back)} 戻った（入っていなければ 0）`);
      } else if (back > 0) out.rec.notes.push(`${EVENTS[hit[0]].name}で売上が減った。保険に入っていれば ${yen(back)} 戻っていた`);
    }
    for (const z of s.biz) if (z.type !== 'works') out.rec.notes.push(...rivalsReact(z, mr, bal));
    out.rec.notes.push(...turnMonth(s.eco, ended + 1, mr, bal));
    const ms = monthStaff(s.firm, s.biz, mr, bal);
    out.rec.notes.push(...ms.notes);
    recruit(s.firm, mr, bal, phaseOf(s.eco).hire);
    offerBids(s.tr, firmsOf(city), mr, bal);
    if (s.firm.pool.length) out.rec.notes.push(`求人に ${s.firm.pool.length}人 の応募が来た`);
    for (const z of s.biz) {
      z.aware = Math.max(0, z.aware - bal.shop.awareDecay);
      z.m = { cust: 0, lost: 0, sales: 0, cost: 0 };
    }
    startMonth(s.tr, ended + 1, clientsOf(city), monthRng(s.seed, ended + 1), bal, { all: phaseOf(s.eco).cust, craft: s.eco.fx.includes('boom') ? 1.5 : 1, handyTidy: s.eco.fx.includes('typhoon') ? 3 : 0 });
    s.cash = out.cash;
    s.bank = out.bank;
    if (out.bankrupt) {
      // 倒産：事業・乗り物・借入をすべて失い、アルバイトからやり直す。知識・道具・鍵は残る
      s.biz = [];
      s.firm.staff = [];
      s.firm.aparts = [];
      s.firm.line = null;
      s.firm.post = null;
      const mine = s.cars.find((c) => c.kind === 'mine');
      if (mine && s.ride === mine.id) s.ride = null;
      s.cars = s.cars.filter((c) => c.kind !== 'mine');
      s.eco.loans = [];
      s.eco.tax = [];
      s.cash = bal.credit.restartCash;
      s.bank = 0;
      s.eco.credit = 0;
      capCredit(s.eco, bal.credit.bankruptCap, bal);
      out.rec.notes.push('払えない月が 2回 続いて、倒産した');
      ev.push({ type: 'bankrupt' });
    }
    ev.push({ type: 'month', rec: out.rec });
  }
}

// 商売の枠と届く話のための乱数（月ごとに決まる。街や警察の乱数とは別にして、互いに影響しないようにする）
const monthRng = (seed: number, k: number) => {
  let x = (Math.imul(seed, 2654435761) + Math.imul(k + 1, 40503) + 12345) >>> 0;
  return () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296;
};
// バスの停まる場所の候補：売り場・窓口・銀行
const STOPS = new WeakMap<City, number[]>();
export function stopsOf(city: City): number[] {
  let c = STOPS.get(city);
  if (!c) {
    c = city.pois.filter((p) => ['market', 'office', 'bank'].includes(p.kind)).map((p) => p.id);
    STOPS.set(city, c);
  }
  return c;
}
// その場所の人通り：景気と出来事、自分のバスの停留所の近くなら増える
export function trafficAt(s: GameState, city: City, p: Poi, bal: Balance): number {
  const ln = s.firm.line;
  const near = !!ln && [ln.a, ln.b].some((id) => Math.hypot(city.pois[id].x - p.x, city.pois[id].y - p.y) < bal.bus.near);
  return p.traffic * custK(s.eco) * (near ? bal.bus.boost : 1);
}
// 契約の相手（会社）：倉庫・自転車屋・中古車屋・売り場・宝石店
const FIRMS = new WeakMap<City, number[]>();
export function firmsOf(city: City): number[] {
  let c = FIRMS.get(city);
  if (!c) {
    c = city.pois.filter((p) => ['warehouse', 'bike', 'car', 'market', 'jewel'].includes(p.kind)).map((p) => p.id);
    FIRMS.set(city, c);
  }
  return c;
}
// 客先（便利屋の話が届く家）：自宅から近い順に 24 軒
const CLIENTS = new WeakMap<City, number[]>();
export function clientsOf(city: City): number[] {
  let c = CLIENTS.get(city);
  if (!c) {
    c = city.pois.filter((p) => p.kind === 'house').sort((a, b2) => Math.hypot(a.x - city.home.x, a.y - city.home.y) - Math.hypot(b2.x - city.home.x, b2.y - city.home.y)).slice(0, 24).map((p) => p.id);
    CLIENTS.set(city, c);
  }
  return c;
}
// 働いた分だけ時間が進み、疲れがたまり、その業種の知識がつく。疲れ切ると、1日 休むことになる
function labor(s: GameState, city: City, mins: number, field: string, bal: Balance, ev: Ev[]) {
  skip(s, city, mins, bal, ev);
  const e = s.eco;
  const before = e.fatigue;
  e.fatigue = Math.min(100, e.fatigue + (bal.self.tirePerHour * mins) / 60);
  if (field) learn(e, field, mins / 240);
  if (e.fatigue >= 100) {
    skip(s, city, 1440, bal, ev);
    e.fatigue = 60;
    ev.push({ type: 'toast', text: '疲れて倒れた。1日 寝こんだ', tone: 'bad' });
  } else if (e.fatigue >= bal.self.warn && before < bal.self.warn) ev.push({ type: 'toast', text: '疲れている。休まないと倒れる', tone: 'bad' });
}
// 材料10個の値段（原料の値上がりの月は3割高い）
const matCost = (s: GameState, bal: Balance) => Math.round(bal.money.matPrice * 10 * (s.eco.fx.includes('matUp') ? 1.3 : 1));
// 月の生活費（家賃と食費など。物価で上がる）
export const monthLiving = (s: GameState, bal: Balance) => Math.round(bal.money.living * bal.time.daysPerMonth * s.eco.infl);

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

function busted(s: GameState, city: City, bal: Balance, ev: Ev[], self = false) {
  const st = stars(s, bal);
  const want = Math.round(s.heat * bal.heat.fine * (self ? bal.law.surrender : 1)); // 自首すると、罰金と出られるまでの時間が半分
  const fine = Math.min(want, Math.max(0, s.cash) + Math.max(0, s.bank));
  const fromCash = Math.min(Math.max(0, s.cash), fine);
  s.cash -= fromCash;
  s.bank -= fine - fromCash;
  const lost = s.dirty + s.loot + Math.round(s.cash * bal.heat.confiscate);
  s.cash -= Math.round(s.cash * bal.heat.confiscate);
  s.dirty = 0;
  s.loot = 0;
  addCredit(s.eco, bal.credit.arrest, bal); // 逮捕：信用が大きく下がり、しばらく上限がつく
  capCredit(s.eco, bal.credit.arrestCap, bal);
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
  const hours = Math.round(st * bal.heat.jailHoursPerStar * (self ? bal.law.surrender : 1) * (s.firm.lawyer ? bal.law.lawyerCut : 1)); // 弁護士がいると、7割の長さ
  s.firm.lawyer = false;
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
  if (cmd.type === 'gig') {
    const g = s.tr.gigs.find((x) => x.id === cmd.id);
    if (g) g.taken = cmd.take;
    return ev;
  }
  if (cmd.type === 'line') {
    const ln = s.firm.line;
    if (!ln) return ev;
    const stops = stopsOf(city);
    if (cmd.act === 'a' || cmd.act === 'b') {
      let i = (stops.indexOf(ln[cmd.act]) + 1) % stops.length;
      if (stops[i] === (cmd.act === 'a' ? ln.b : ln.a)) i = (i + 1) % stops.length;
      ln[cmd.act] = stops[i];
    } else if (cmd.act === 'add') {
      if (payClean(s, bal.bus.price)) {
        ln.buses += 1;
        s.eco.m.cost += bal.bus.price;
      }
    } else ln.fare = Math.max(0.6, Math.min(1.6, Math.round((ln.fare + (cmd.act === 'fareUp' ? 0.1 : -0.1)) * 10) / 10));
    return ev;
  }
  if (cmd.type === 'bid') {
    const b2 = s.tr.bids.find((x) => x.id === cmd.id);
    if (!b2) return ev;
    if (cmd.act === 'call') {
      // 通う：1時間。関係が上がる。3回通うと、相手が何を重く見るかが分かる
      labor(s, city, 60, 'handy', bal, ev);
      b2.calls += 1;
      s.tr.rel[b2.poi] = Math.min(100, (s.tr.rel[b2.poi] ?? 0) + bal.deal.relPerVisit);
      toast(b2.calls === 3 ? '相手の考えが分かってきた' : '顔を出してきた');
    } else b2.quote = cmd.act === 'low' ? 0.9 : cmd.act === 'high' ? 1.1 : 1;
    return ev;
  }
  if (cmd.type === 'staff') {
    const f = s.firm;
    const T = bal.staff;
    const q = f.staff.find((x) => x.id === cmd.id);
    if (cmd.act === 'wageUp' || cmd.act === 'wageDown') {
      if (f.post) f.post.wage = Math.max(T.market * 0.7, Math.min(T.market * 1.5, Math.round((f.post.wage + (cmd.act === 'wageUp' ? 1 : -1) * T.market * 0.1) / 100) * 100));
    } else if (cmd.act === 'ask') {
      if (askOne(f, cmd.id, cmd.k ?? 0)) labor(s, city, 20, '', bal, ev); // 面接は1人1時間（質問3つ）
    } else if (cmd.act === 'hire') {
      const p2 = f.pool.find((x) => x.id === cmd.id);
      const got = hire(f, cmd.id, Math.max(p2?.ask ?? 0, f.post?.wage ?? 0));
      if (got) {
        if (s.biz.length === 1) got.at = s.biz[0].poi;
        toast(`${got.name}を雇った（日給 ${yen(got.wage)}）`, 'good');
      }
    } else if (q && cmd.act === 'fire') {
      f.staff = f.staff.filter((x) => x !== q);
      for (const z of s.biz) if (z.boss === q.id) z.boss = 0;
    } else if (q && cmd.act === 'raise') {
      q.wage = Math.round((q.wage * 1.05) / 100) * 100;
      q.mood = Math.max(0, q.mood - T.raise);
      q.quiet = 0;
    } else if (q && cmd.act === 'talk') {
      labor(s, city, 60, '', bal, ev);
      q.mood = Math.max(0, q.mood - T.talk);
      q.quiet = 0;
      toast(`${q.name}と話した`);
    } else if (q && cmd.act === 'assign') {
      const spots = [-1, ...s.biz.map((z) => z.poi)];
      q.at = spots[(spots.indexOf(q.at) + 1) % spots.length];
      for (const z of s.biz) if (z.boss === q.id && z.poi !== q.at) z.boss = 0;
    } else if (q && cmd.act === 'proc') {
      q.proc = (q.proc + 1) % 3;
    } else if (q && cmd.act === 'boss') {
      const z = s.biz.find((x) => x.poi === q.at);
      if (z) z.boss = z.boss === q.id ? 0 : q.id;
    }
    return ev;
  }
  if (cmd.type === 'loan') {
    const q = city.pois[cmd.id];
    if (!q || q.kind !== 'bank' || Math.hypot(q.x - s.x, q.y - s.y) > 26) return ev;
    if (cmd.kind === 'start' && !((cmd.plan ?? 0) > 0)) {
      toast('計画（月の売上の見込み）が要る');
      return ev;
    }
    const loan = takeLoan(s.eco, cmd.kind, cmd.amount, Math.max(0, s.cash) + Math.max(0, s.bank), false, bal);
    if (!loan) {
      toast('審査に通らなかった');
      return ev;
    }
    if (cmd.kind === 'start') s.eco.plan = cmd.plan ?? 0;
    s.bank += loan.amount;
    toast(`${yen(loan.amount)} を借りた。毎月 ${yen(loan.pay)} ずつ返す`, 'good');
    ev.push({ type: 'sfx', name: 'coin' });
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
        toast('「動くな」　店員は手を上げた');
        ev.push({ type: 'sfx', name: 'door' });
        if (pr.silent > 0) trip(pr.silent, '店員が足元の通報ボタンを押した');
        break;
      case 'guard':
        ins.guardDown = ins.crime = ins.did = true;
        toast('警備員は手を上げた');
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
      if (!poiActions(s, city, q, bal).find((a) => a.id === 'break')?.ok) return ev;
      const quiet = (cmd.hits ?? 0) >= 2;
      s.cool[q.id] = dayOf(s) + bal.crime.houseDays;
      s.crimes += 1;
      addHeat(s, (quiet ? bal.heat.burgleQuiet : bal.heat.burgleLoud * 0.5) + (isNight(s) ? 0 : bal.heat.burgleDay), bal, ev);
      alarm = (quiet ? bal.crime.alarmQuiet : bal.crime.alarmLoud) * ((s.cased[q.id] ?? -99) >= dayOf(s) - bal.law.caseDays ? bal.law.caseAlarm : 1); // 下見してあると、通報までが延びる
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
      s.eco.fatigue = Math.max(0, s.eco.fatigue - bal.self.sleep);
      toast('よく寝た', 'good');
      break;
    }
    case 'nap':
      skip(s, city, 22 * 60 - (s.clock % 1440), bal, ev);
      s.heat = Math.max(0, s.heat - 30);
      s.eco.fatigue = Math.max(0, s.eco.fatigue - bal.self.nap);
      toast('夜になった');
      break;
    case 'work': {
      const wage = (p.kind === 'conbini' ? m.wageConbini : m.wageWarehouse) * m.shiftHours;
      labor(s, city, m.shiftHours * 60, p.kind === 'conbini' ? 'retail' : 'logi', bal, ev); // 働くと、疲れがたまり、その業種の知識がつく
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
    case 'mats':
      if (pay(s, matCost(s, bal), false)) {
        s.tr.mats += 10;
        s.eco.m.cost += matCost(s, bal);
        toast('材料を10個買った');
      }
      break;
    case 'power':
    case 'washer':
      if (pay(s, m[cmd.act], false)) {
        s.tr[cmd.act] = true;
        s.eco.m.cost += m[cmd.act];
        toast(cmd.act === 'power' ? '電動の道具を買った' : '洗浄の道具を買った');
      }
      break;
    case 'craftSmall':
    case 'craftOrder': {
      const job = bal.jobs[cmd.act];
      const n = cmd.act === 'craftSmall' ? 4 : 1;
      const mins = workMins(job, s.eco.know.craft ?? 0, s.tr, s.eco.fatigue) * n;
      s.tr.mats -= job.mat * n;
      s.tr.stock[cmd.act] = (s.tr.stock[cmd.act] ?? 0) + n;
      labor(s, city, mins, 'craft', bal, ev);
      toast(`${job.name}を${n}つ作った。売り場へ持って行く`, 'good');
      break;
    }
    case 'sellGoods': {
      let total = 0;
      for (const id of ['craftSmall', 'craftOrder']) {
        const n = Math.min(s.tr.stock[id] ?? 0, left(s.tr, id));
        if (n <= 0) continue;
        s.tr.stock[id] -= n;
        record(s.tr, id, n, quality(s.eco.know.craft ?? 0, s.tr.power, false));
        total += n * bal.jobs[id].price;
      }
      s.cash += total;
      s.earned += total;
      s.eco.m.sales += total;
      toast(`+${yen(total)}`, 'good');
      ev.push({ type: 'sfx', name: 'coin' });
      break;
    }
    case 'pitchCraft':
    case 'pitchHandy': {
      const trade = cmd.act === 'pitchCraft' ? 'craft' : 'handy';
      labor(s, city, 120, trade, bal, ev);
      pitch(s.tr, trade, monthOf(s.eco, bal), clientsOf(city), monthRng(s.seed, 1000 + s.tr.nextGig), bal);
      toast(trade === 'craft' ? '売り込んだ。今月の枠が増えた' : 'チラシを置いた。話が届く', 'good');
      break;
    }
    case 'gig': {
      const g = s.tr.gigs.find((x) => x.taken && x.poi === p.id);
      if (!g) break;
      const job = bal.jobs[g.job];
      const know = s.eco.know.handy ?? 0;
      labor(s, city, workMins(job, know, s.tr, s.eco.fatigue), 'handy', bal, ev);
      s.tr.gigs = s.tr.gigs.filter((x) => x !== g);
      record(s.tr, g.job, 1, quality(know, s.tr.washer, false));
      s.tr.jobs += 1;
      s.cash += job.price - job.mat;
      s.earned += job.price - job.mat;
      s.eco.m.sales += job.price;
      s.eco.m.cost += job.mat;
      toast(`${job.name}が終わった　+${yen(job.price - job.mat)}`, 'good');
      ev.push({ type: 'sfx', name: 'coin' });
      break;
    }
    case 'rest':
      skip(s, city, 120, bal, ev);
      s.eco.fatigue = Math.max(0, s.eco.fatigue - bal.self.restPerHour * 2);
      toast('ひと休みした');
      break;
    case 'devSmall':
    case 'devMid':
      s.tr.proj = { job: cmd.act === 'devSmall' ? 'softSmall' : 'softMid', hours: 0, out: false };
      toast('作り始めた');
      break;
    case 'devOut':
      if (s.tr.proj && pay(s, m.devOut, false)) {
        s.tr.proj.out = true;
        s.eco.m.cost += m.devOut;
        toast('絵と音を頼んだ');
      }
      break;
    case 'dev': {
      const pj = s.tr.proj;
      if (!pj) break;
      const job = bal.jobs[pj.job];
      const know = s.eco.know.soft ?? 0;
      labor(s, city, 240, 'soft', bal, ev);
      pj.hours += (4 * (know < 30 ? 0.8 : 1) * (s.eco.fatigue > 80 ? 0.77 : s.eco.fatigue > 60 ? 0.87 : 1)) / (pj.out ? 0.75 : 1);
      if (pj.hours >= job.hours) {
        const first = firstUnits(job, fameOf(s.tr, 'soft'), pj.out);
        s.tr.titles.push({ job: pj.job, month: monthOf(s.eco, bal), first });
        s.tr.proj = null;
        toast(`${job.name}を発売した。今月の見込み ${first}本（入金は翌月末）`, 'good');
        ev.push({ type: 'sfx', name: 'ok' });
      }
      break;
    }
    case 'deal': {
      const dl = s.tr.deals.find((x) => x.poi === p.id && x.done < x.visits);
      if (!dl) break;
      labor(s, city, bal.deal.visitMins, 'handy', bal, ev);
      dl.done += 1;
      s.tr.jobs += 1;
      toast(`契約の仕事をした（今月 ${dl.done}/${dl.visits}回）`, 'good');
      break;
    }
    case 'advice':
      labor(s, city, 60, '', bal, ev);
      toast(adviceOf(s, bal));
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
    case 'wash': {
      const amount = Math.min(s.dirty, m.washCap);
      const got = Math.round(amount * m.washRate);
      s.dirty -= amount;
      s.cash += got;
      s.cool[p.id] = dayOf(s) + 1;
      toast(`${yen(amount)} を洗って +${yen(got)}`, 'good');
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
    case 'surrender':
      busted(s, city, bal, ev, true);
      break;
    case 'case':
      labor(s, city, bal.law.caseHours * 60, '', bal, ev);
      s.cased[p.id] = dayOf(s);
      toast('家の出入りと、まわりの目を見ておいた');
      break;
    case 'fine':
      s.cash -= Math.round(s.heat * bal.heat.fine);
      s.heat = 0;
      toast('罰金を払った');
      break;
    case 'stall':
    case 'works':
    case 'shop': {
      const c = openConds(cmd.act, p.traffic, rankIndex(s.eco.credit), s.cash + Math.max(0, s.bank), s.firm, bal);
      if (c.conds.every((x) => x.ok) && payClean(s, c.setup + c.deposit)) {
        s.biz.push(newShop(cmd.act, p.id, c.rent, c.deposit, dayOf(s), bal));
        s.eco.m.cost += c.setup; // 道具・内装は経費。保証金は、たたむと戻る
        toast(cmd.act === 'stall' ? '屋台を出した。店に立つか、人を雇う' : cmd.act === 'works' ? '工房を開いた。人を雇って、工程を決める。材料も要る' : '店を開いた。店に立つか、人を雇う', 'good');
        ev.push({ type: 'sfx', name: 'ok' });
      }
      break;
    }
    case 'tend': {
      const z = s.biz.find((x) => x.poi === p.id);
      if (!z) break;
      const field = z.type === 'stall' ? 'food' : 'retail';
      const t = serve(z, 4, [{ cap: bal.shop.selfCap, service: 40 + (s.eco.know[field] ?? 0) / 2 }], trafficAt(s, city, p, bal), 1, bal, s.eco.fx.includes('matUp') ? 1.15 : 1);
      labor(s, city, 240, field, bal, ev);
      z.seen = dayOf(s);
      const washed = s.eco.mix ? Math.min(s.dirty, Math.round(t.sales * bal.shop.mix)) : 0;
      s.eco.mixed += washed;
      s.dirty -= washed;
      s.cash += t.sales - t.cost + washed;
      s.earned += t.sales - t.cost;
      s.eco.m.sales += t.sales;
      s.eco.m.cost += t.cost;
      toast(`客 ${t.cust}人${t.lost ? `（${t.lost}人は待てずに帰った）` : ''}　+${yen(t.sales - t.cost)}`, t.cust ? 'good' : '');
      if (t.cust) ev.push({ type: 'sfx', name: 'coin' });
      break;
    }
    case 'mach0':
    case 'mach1':
    case 'mach2': {
      const z = s.biz.find((x) => x.poi === p.id);
      if (z && payClean(s, bal.works.machine)) {
        z.mach[Number(cmd.act.slice(4))] = true;
        s.eco.m.cost += bal.works.machine;
        toast('機械を入れた', 'good');
      }
      break;
    }
    case 'matsBulk':
      if (rankIndex(s.eco.credit) >= 1 && payClean(s, Math.round(matCost(s, bal) * (bal.works.bulk / 10) * bal.works.bulkOff))) {
        s.tr.mats += bal.works.bulk;
        s.eco.m.cost += Math.round(matCost(s, bal) * (bal.works.bulk / 10) * bal.works.bulkOff);
        toast(`材料を${bal.works.bulk}個 仕入れた`);
      }
      break;
    case 'wholesale': {
      // 枠を超えて余った小物を、卸に半値でまとめて売る（代金は翌月末）
      const n = Math.max(0, (s.tr.stock.craftSmall ?? 0) - left(s.tr, 'craftSmall'));
      if (n <= 0) break;
      s.tr.stock.craftSmall -= n;
      s.tr.recv.push({ amount: Math.round(n * bal.jobs.craftSmall.price * bal.works.wholesale), due: monthOf(s.eco, bal) + 1, what: '卸の代金' });
      toast(`卸に ${n}個 売った（代金は翌月末）`, 'good');
      break;
    }
    case 'busLecture':
      if (payClean(s, bal.bus.lecture)) {
        labor(s, city, bal.bus.lectureHours * 60, '', bal, ev);
        s.firm.permits.push('transit');
        toast('運行管理者になった', 'good');
      }
      break;
    case 'busStart': {
      const stops = stopsOf(city);
      if (!s.firm.line && s.firm.permits.includes('transit') && stops.length >= 2 && payClean(s, bal.bus.price * bal.bus.min)) {
        s.firm.line = { a: stops[0], b: stops[1], buses: bal.bus.min, fare: 1, d: { riders: 0, sales: 0, cost: 0 } };
        s.eco.m.cost += bal.bus.price * bal.bus.min;
        toast('バスの路線を始めた。停まる場所は「仕事と商売」で決める', 'good');
        ev.push({ type: 'sfx', name: 'ok' });
      }
      break;
    }
    case 'manage': {
      const z = s.biz.find((x) => x.poi === p.id);
      if (!z) break;
      labor(s, city, 60, z.type === 'stall' ? 'food' : 'retail', bal, ev);
      z.seen = dayOf(s);
      toast('発注とシフトを見た');
      break;
    }
    case 'priceUp':
    case 'priceDown': {
      const z = s.biz.find((x) => x.poi === p.id);
      if (z) z.price = Math.round((z.price + (cmd.act === 'priceUp' ? 0.1 : -0.1)) * 10) / 10;
      break;
    }
    case 'ad': {
      const z = s.biz.find((x) => x.poi === p.id);
      if (z && payClean(s, bal.shop.ad)) {
        z.aware = Math.min(100, z.aware + bal.shop.adGain);
        s.eco.m.cost += bal.shop.ad;
        toast(`広告を出した。認知 ${Math.round(z.aware)}`, 'good');
      }
      break;
    }
    case 'closeShop': {
      const z = s.biz.find((x) => x.poi === p.id);
      if (!z) break;
      const back = z.deposit || bal.biz.stall / 2;
      s.cash += back;
      s.biz = s.biz.filter((x) => x !== z);
      for (const q of s.firm.staff) if (q.at === p.id) q.at = -1;
      if (s.inside) s.inside = null;
      toast(`店をたたんだ　+${yen(back)}`);
      ev.push({ type: 'skip' });
      break;
    }
    case 'lecture':
      if (payClean(s, bal.permit.foodFee)) {
        labor(s, city, bal.permit.foodHours * 60, 'food', bal, ev);
        s.firm.permits.push('food');
        toast('食品衛生の責任者になった', 'good');
        ev.push({ type: 'sfx', name: 'ok' });
      }
      break;
    case 'postPaper':
    case 'postSite':
      s.firm.post = { site: cmd.act === 'postSite', wage: s.firm.post?.wage ?? bal.staff.market };
      toast('求人を出した。応募は月の初めに届く');
      break;
    case 'lawyer':
      if (payClean(s, bal.law.lawyer)) {
        s.firm.lawyer = true;
        toast('弁護士を頼んだ');
      }
      break;
    case 'hide':
      s.eco.hide = s.eco.hide >= 0.6 ? 0 : Math.round((s.eco.hide + 0.3) * 10) / 10;
      toast(s.eco.hide > 0 ? `もうけの ${Math.round(s.eco.hide * 100)}% を隠して申告する` : '正しく申告する');
      break;
    case 'mix':
      s.eco.mix = !s.eco.mix;
      toast(s.eco.mix ? '売上に、汚れたお金を混ぜる（売上の2割まで）' : '混ぜるのをやめた');
      break;
    case 'insure':
      s.eco.insured = !s.eco.insured;
      toast(s.eco.insured ? '保険に入った' : '保険をやめた');
      break;
    case 'postOff':
      s.firm.post = null;
      toast('求人をやめた');
      break;
    case 'buyApart': {
      const price = apartPrice(p.traffic, bal, phaseOf(s.eco).estate);
      if (payClean(s, price)) {
        s.firm.aparts.push({ poi: p.id, rent: 1, state: 0.8, paid: price });
        toast('アパートを買った。家賃は月末に入る', 'good');
        ev.push({ type: 'sfx', name: 'ok' }, { type: 'skip' });
        s.inside = null;
      }
      break;
    }
    case 'rentUp':
    case 'rentDown': {
      const a = s.firm.aparts.find((x) => x.poi === p.id);
      if (a) a.rent = Math.round((a.rent + (cmd.act === 'rentUp' ? 0.1 : -0.1)) * 10) / 10;
      break;
    }
    case 'repair': {
      const a = s.firm.aparts.find((x) => x.poi === p.id);
      if (a && payClean(s, repairCost(a, bal))) {
        s.eco.m.cost += repairCost(a, bal);
        a.state = 1;
        toast('修繕した', 'good');
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
    gun: s.gun, hide: s.hide, stash: s.stash, turf: s.turf, lockpick: s.lockpick, drill: s.drill, keys: s.keys, eco: s.eco, tr: s.tr, firm: s.firm, cased: s.cased,
    mine: mine ? { bike: mine.bike, x: mine.x, y: mine.y, a: mine.a, riding: s.ride === mine.id } : null,
  };
}
export type SaveData = ReturnType<typeof toSave>;
export function fromSave(d: SaveData, city: City, bal: Balance): GameState {
  const s = createGame(d.seed, city, bal);
  Object.assign(s, { rng: d.rng, clock: d.clock, x: d.x, y: d.y, cash: d.cash, dirty: d.dirty, bank: d.bank, loot: d.loot, heat: d.heat, record: d.record, crowbar: d.crowbar, laptop: d.laptop, biz: d.biz, cool: d.cool, earned: d.earned, crimes: d.crimes, gun: !!d.gun, hide: d.hide ?? null, stash: d.stash ?? 0, turf: d.turf ?? s.turf, lockpick: !!d.lockpick, drill: !!d.drill, keys: d.keys ?? [] });
  if (d.eco) s.eco = { ...newEco(bal), ...d.eco };
  if (d.tr) s.tr = { ...newTr(), ...d.tr };
  if (d.firm) s.firm = { ...newFirm(), ...d.firm };
  s.cased = d.cased ?? {};
  s.biz = (s.biz as unknown as Partial<Shop>[]).filter((z) => typeof z.aware === 'number') as Shop[]; // 古い形の店は引き継がない
  s.bank = Math.max(0, s.bank); // 預金は借金にならない（借りるのは融資だけ）
  if (d.mine) {
    const c: Car = { id: s.nextId++, kind: 'mine', bike: d.mine.bike, x: d.mine.x, y: d.mine.y, a: d.mine.a, v: 0, color: d.mine.bike ? 0x1f8a6f : 0x2f7fc1, from: 0, to: 0, s: 0, chase: false, think: 0, path: [], stuck: 0, value: 0 };
    s.cars.push(c);
    if (d.mine.riding) s.ride = c.id;
  }
  return s;
}
