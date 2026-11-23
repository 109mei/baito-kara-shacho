// ルール本体と画面の橋渡し。状態の持ち主はルール本体で、ここは写しを配るだけ。
// ルール本体は 1/30 秒の決まった刻みで進める。画面の数字は 1 秒に 10 回だけ更新する。
import { create } from 'zustand';
import { makeCity, type City, type Poi, type PoiKind } from '../core/city';
import { dateOf, rankOf, type MonthRec } from '../core/eco';
import { blocked } from '../core/rooms';
import { apply, createGame, dayOf, fromSave, hourOf, nearby, nearSpot, ownedPoi, poiActions, poiTitle, rank, riding, roomFor, routesOf, spotInfo, stars, step, STEP, toSave, type Cmd, type Ev, type GameState, needOf, kindOf, HAND, type HandKind } from '../core/sim';
import { balance as b } from '../data/schema';
import { net } from '../net/room';
import { loadPrefs, savePrefs, SaveStore, type Prefs } from '../save/SaveStore';
import { buzz, setSound, sfx } from '../ui/sfx';

export const CITY_SEED = 20261123;
export const city: City = makeCity(CITY_SEED, b);
let core: GameState = createGame(CITY_SEED, city, b);
export const getCore = () => core;
export const input = { mx: 0, my: 0, fire: false };

export interface Hud {
  cash: number; dirty: number; bank: number; loot: number;
  day: number; hour: number; stars: number; seen: boolean;
  ride: 'foot' | 'bike' | 'car'; kmh: number; rank: string; bizN: number;
  nearCar: '' | '乗る' | '盗む'; nearPoi: number | null; nearName: string; way: boolean;
  goal: string; goalKind: PoiKind; // つぎの目標と、その行き先の種類
  hp: number; gun: boolean; stash: number; turfs: number;
  inside: string; spot: number; spotLabel: string; spotTone: '' | 'crime' | 'exit'; alarm: number; // 建物の中にいるとき
  spotOff: boolean; watch: number; drill: number; // 押せないボタン／見られている度合い（0〜1）／ドリルの進み（0〜1、していなければ -1）
  tools: string[]; // 持っている道具
  zone: boolean; // 立入禁止の所にいる
  mates: number; // いっしょに遊んでいる人の数（同じページをいま開いている人）
  date: string; credit: number; grade: string; // 暦、信用の点とランク
  need: string; needKind: string; // いまいちばん足りないもの（1つだけ。なければ空）
  corp: number | null; // 法人：会社の口座
  gigs: number; // 届いていて、まだ受けていない話の数
  aim: boolean; // 撃てる相手が、届く所にいる
  caught: number; // 捕まるまでの度合い（0〜1）
}
export interface Toast { id: number; text: string; tone: string }
interface Store {
  phase: 'title' | 'play';
  hud: Hud;
  panel: number | null; // 開いている場所
  panelActs: string[] | null; // 札に出す行動（部屋の中の1か所ぶん）。null は全部
  spotAction: () => void;
  mini: { poi: number; act: string; i?: number; route?: 'front' | 'back' } | null;
  work: { poi: number; act: string; kind: HandKind; narrow: number } | null; // 手でやる操作（並べる・なぞる・タップ）
  routes: number | null; // 入り方を選んでいる場所
  pickRoute: (id: 'front' | 'back') => void;
  busted: Extract<Ev, { type: 'busted' }> | null;
  down: number | null; // 倒されたとき：失った額
  hurt: number; // 撃たれた回数（画面のふちを赤く光らせる合図）
  report: MonthRec | null; // 月次レポート（月末の締め）
  broke: false | 'me' | 'corp'; // 倒産した（自分／会社）
  ending: boolean; // 自社のロケットが宇宙へ届いた
  loan: number | null; // 融資の相談をしている銀行
  hub: boolean; // 「仕事と商売」の札
  gig: (id: number, take: boolean) => void;
  staff: (id: number, act: Extract<Cmd, { type: 'staff' }>['act'], k?: 0 | 1 | 2) => void;
  bid: (id: number, act: Extract<Cmd, { type: 'bid' }>['act']) => void;
  corp: (act: Extract<Cmd, { type: 'corp' }>['act']) => void;
  line: (act: Extract<Cmd, { type: 'line' }>['act']) => void;
  wayTo: (poi: number) => void;
  borrow: (kind: 'start' | 'bank' | 'land', amount: number, plan: number) => void;
  exportSave: () => string; // セーブを文字にして書き出す
  importSave: (text: string) => boolean; // 文字から読み込む
  rewind: (i: number) => boolean; // 1日の終わりの保存（直近3回分）に戻す
  fire: () => void;
  bigMap: boolean;
  fade: number;
  toasts: Toast[];
  prefs: Prefs;
  hasSave: boolean;
  start: (fresh: boolean) => void;
  send: (cmd: Cmd) => void;
  action: () => void;
  openPoi: () => void;
  act: (poi: number, act: string, mini: boolean) => void;
  miniDone: (hits: number) => void;
  workDone: (grade: 0 | 1 | 2) => void;
  set: (p: Partial<Pick<Store, 'panel' | 'panelActs' | 'bigMap' | 'busted' | 'mini' | 'work' | 'ending' | 'down' | 'routes' | 'report' | 'broke' | 'loan' | 'hub'>>) => void;
  setPrefs: (p: Partial<Prefs>) => void;
  toast: (text: string, tone?: string) => void;
  guide: () => void;
}

const prefs0 = loadPrefs();
setSound(prefs0.sound);
let toastId = 1;
let raf = 0;
let last = 0;
let acc = 0;
let hudT = 0;
let saveT = 0;
let sirenT = 0;
let sirenHi = false;
let beepT = 0;

// つぎの目標：いまの持ち物とお金から、1つだけ出す
function goalOf(s: GameState): [string, PoiKind] {
  const hasRide = s.cars.some((c) => c.kind === 'mine');
  if (s.biz.length === 0 && s.cash < b.money.bike && !hasRide) return ['はたらいて お金をつくる', 'conbini'];
  if (!hasRide && s.biz.length === 0) return ['自転車を買う', 'bike'];
  if (s.biz.length === 0 && s.cash < b.biz.stall && s.dirty >= 50000) return ['質屋で お金を洗う', 'pawn'];
  if (s.biz.length === 0 && !s.firm.permits.includes('food') && s.cash >= b.biz.stall) return ['窓口で 食品衛生の講習', 'office'];
  if (s.biz.length === 0) return [`屋台を出す ¥${b.biz.stall.toLocaleString('ja-JP')}`, s.cash >= b.biz.stall ? 'lot' : 'conbini'];
  if (!s.eco.corp) return [`法人にして 社長になる ¥${(b.corp.fee + b.corp.capital).toLocaleString('ja-JP')}`, 'office'];
  if (s.biz.length < 6) return [`大社長まで 事業 ${s.biz.length}/6`, 'lot'];
  const mine = s.turf.filter((t) => t === -1).length;
  if (mine < 6) return [`街を支配する 縄張り ${mine}/6`, 'gang'];
  return ['この街は、あなたの物', 'home'];
}

function insideHud(s: GameState): Pick<Hud, 'inside' | 'spot' | 'spotLabel' | 'spotTone' | 'alarm' | 'spotOff' | 'watch' | 'drill' | 'zone'> {
  const room = roomFor(s, city);
  if (!room || !s.inside) return { inside: '', spot: -1, spotLabel: '', spotTone: '', alarm: -1, spotOff: false, watch: 0, drill: -1, zone: false };
  const i = nearSpot(s, city);
  const info = i >= 0 ? spotInfo(s, city, room, i, b) : null;
  const pr = room.heist ? b.heist[room.heist] : null;
  return {
    inside: poiTitle(s, city, city.pois[s.inside.poi]), spot: i, spotLabel: info ? (room.spots[i].h === 'vault' && pr && s.inside.drill > 0 ? `ドリル ${Math.round((1 - s.inside.drill / pr.drill) * 100)}%` : info.label) : '', spotTone: info ? info.tone : '', spotOff: !!info && !info.ok, alarm: s.inside.alarm,
    zone: !!room.zones?.some((z) => s.inside!.x > z.x && s.inside!.x < z.x + z.w && s.inside!.y > z.y && s.inside!.y < z.y + z.h),
    watch: Math.round(s.inside.seenT * 10) / 10, drill: pr && s.inside.drill > 0 ? Math.round((1 - s.inside.drill / pr.drill) * 20) / 20 : -1,
  };
}

function snapshot(): Hud {
  const s = core;
  const car = riding(s);
  const near = nearby(s, city);
  return {
    cash: s.cash, dirty: s.dirty, bank: s.bank, loot: s.loot, day: dayOf(s) + 1, hour: hourOf(s), stars: stars(s, b), seen: s.seen,
    ride: car ? (car.bike ? 'bike' : 'car') : 'foot', kmh: car ? Math.round(Math.abs(car.v) * 3.6) : 0, rank: rank(s), bizN: s.biz.length,
    nearCar: near.car ? (near.car.kind === 'mine' || near.car.kind === 'stolen' ? '乗る' : '盗む') : '',
    nearPoi: near.poi ? near.poi.id : null, nearName: near.poi ? poiTitle(s, city, near.poi) : '', way: !!s.way,
    goal: goalOf(s)[0], goalKind: goalOf(s)[1],
    hp: Math.max(0, Math.round(s.hp)), gun: s.gun, stash: s.stash, turfs: s.turf.filter((t) => t === -1).length,
    date: ((d) => `${d.year}年${d.month}月${d.day}日`)(dateOf(s.eco, b)), credit: Math.round(s.eco.credit), grade: rankOf(s.eco.credit),
    need: needOf(s, b)?.text ?? '', needKind: needOf(s, b)?.kind ?? '', corp: s.eco.corp ? s.eco.corp.bank : null,
    gigs: s.tr.gigs.filter((g) => !g.taken).length,
    mates: net.online ? net.mates.size : -1,
    aim: s.gun && !s.inside && (s.thugs.some((t) => Math.hypot(t.x - s.x, t.y - s.y) < b.gang.gunRange) || (net.online && !!net.nearest(s.x, s.y, b.gang.gunRange))),
    caught: Math.min(1, s.catchT / b.police.catchTime),
    tools: [s.crowbar && 'バール', s.lockpick && 'ピッキング道具', s.laptop && 'ノートPC', s.drill && 'ドリル', s.gun && '銃', s.keys.length > 0 && `鍵 ${s.keys.length}本`].filter((x): x is string => !!x),
    ...insideHud(s),
  };
}

let lastWork: { act: string; grade: 0 | 1 | 2; day: number } | null = null;

export const useGame = create<Store>((set, get) => {
  // 撃つ：近くにほかの人（外にいる人）がいて、見張りより近ければ、その人を狙う
  const shootNow = () => {
    const mate = net.online && !core.inside ? net.nearest(core.x, core.y, b.gang.gunRange) : null;
    const thug = Math.min(...core.thugs.map((t) => Math.hypot(t.x - core.x, t.y - core.y)), Infinity);
    if (mate && Math.hypot(mate.x - core.x, mate.y - core.y) < thug) {
      if (!core.gun || core.fireCd > 0) return;
      handle(apply(core, city, { type: 'shoot', x: mate.x, y: mate.y }, b));
      net.fireAt(mate.id);
    } else handle(apply(core, city, { type: 'fire' }, b));
  };
  const handle = (ev: Ev[]) => {
    for (const e of ev) {
      if (e.type === 'toast') get().toast(e.text, e.tone);
      else if (e.type === 'sfx') {
        if (e.name === 'coin') sfx.coin();
        else if (e.name === 'bigcoin') sfx.coin(true);
        else if (e.name === 'crash') {
          sfx.crash();
          buzz(20);
        } else if (e.name === 'door') sfx.tap();
        else if (e.name === 'fail') sfx.fail();
        else if (e.name === 'shot') sfx.shot();
        else if (e.name === 'hurt') {
          sfx.shot();
          buzz(35);
          set({ hurt: get().hurt + 1 });
        }
        else sfx.accept();
      } else if (e.type === 'star') {
        get().toast(`手配 ${'★'.repeat(e.stars)}`, 'bad');
        sfx.fail();
        buzz(30);
      } else if (e.type === 'busted') {
        set({ busted: e, panel: null, mini: null });
        sfx.month(false);
      } else if (e.type === 'down') {
        set({ down: e.lost, panel: null, mini: null });
        sfx.month(false);
      } else if (e.type === 'day') {
        if (e.profit || e.turf) get().toast(`1日の終わり${e.profit ? `　事業 +¥${e.profit.toLocaleString('ja-JP')}` : ''}${e.turf ? `　縄張り +¥${e.turf.toLocaleString('ja-JP')}` : ''}`, 'good');
        SaveStore.snapshot(toSave(core)); // 1日の終わりの保存は、直近3回分を残す
        if (e.lost) get().toast(e.lost, 'bad');
        if (e.news) get().toast(e.news, '');
      } else if (e.type === 'month') {
        set({ report: e.rec, panel: null, loan: null });
        sfx.month(e.rec.unpaid.length === 0);
      } else if (e.type === 'bankrupt') set({ broke: e.corp ? 'corp' : 'me' });
      else if (e.type === 'rocket') set({ ending: true, panel: null });
      else if (e.type === 'skip') set({ fade: get().fade + 1 });
    }
  };
  net.onHit = (from) => {
    if (get().phase !== 'play' || core.inside || from.inside || Math.hypot(from.x - core.x, from.y - core.y) > b.gang.gunRange + 30) return;
    handle(apply(core, city, { type: 'hurt', amount: b.gang.pvpDamage, x: from.x, y: from.y }, b));
  };
  const loop = (now: number) => {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const st = get();
    const paused = st.phase !== 'play' || st.panel !== null || st.mini !== null || st.work !== null || st.ending || st.bigMap || st.busted !== null || st.down !== null || st.routes !== null || st.report !== null || st.loan !== null || st.hub;
    if (!paused) {
      acc += dt;
      let n = 0;
      while (acc >= STEP && n < 5) {
        if (input.fire && core.gun && core.fireCd <= 0 && !core.inside) shootNow(); // 押しっぱなしで撃ち続ける
        handle(step(core, city, input, b));
        acc -= STEP;
        n++;
      }
      if (n === 5) acc = 0;
      // 建物の中：警報が鳴っている間は 1 秒ごとに音、ドリルの間は削る音
      const ins = core.inside;
      const watched = !!ins && ins.alarm < 0 && ins.seenT > 0.05;
      if (ins && (ins.alarm > 0 || ins.drill > 0 || watched)) {
        beepT -= dt;
        if (beepT <= 0) {
          beepT = watched ? 0.16 : ins.drill > 0 ? 0.22 : 1;
          if (watched) sfx.tick(); // 見られている：速い小さな音で知らせる
          else if (ins.drill > 0) sfx.drill();
          else sfx.alarm();
        }
      } else beepT = 0;
      if (core.seen && core.heat > 0) {
        sirenT -= dt;
        if (sirenT <= 0) {
          sirenT = 0.45;
          sirenHi = !sirenHi;
          sfx.siren(sirenHi);
        }
      }
    }
    net.step(dt);
    hudT += dt;
    if (hudT > 0.1) {
      hudT = 0;
      if (net.online && st.phase === 'play') {
        const car = riding(core);
        net.send({ x: core.x, y: core.y, a: core.a, ride: car ? (car.bike ? 1 : 2) : 0, stars: stars(core, b), turfs: core.turf.filter((t) => t === -1).length, inside: !!core.inside, hp: core.hp });
      }
      set({ hud: snapshot() });
    }
    saveT += dt;
    if (saveT > 4 && st.phase === 'play') {
      saveT = 0;
      SaveStore.save(toSave(core));
    }
  };
  return {
    phase: 'title',
    hud: snapshot(),
    panel: null,
    panelActs: null,
    mini: null,
    work: null,
    ending: false,
    routes: null,
    busted: null,
    down: null,
    hurt: 0,
    report: null,
    broke: false,
    loan: null,
    hub: false,
    gig: (id, take) => get().send({ type: 'gig', id, take }),
    staff: (id, act, k) => get().send({ type: 'staff', id, act, k }),
    bid: (id, act) => get().send({ type: 'bid', id, act }),
    corp: (act) => get().send({ type: 'corp', act }),
    line: (act) => get().send({ type: 'line', act }),
    wayTo: (poi) => {
      const p = city.pois[poi];
      get().send({ type: 'way', x: p.x, y: p.y });
      set({ hub: false });
    },
    exportSave: () => SaveStore.exportText(toSave(core)),
    importSave: (text) => {
      const d = SaveStore.importText(text);
      if (!d || d.seed !== CITY_SEED) return false;
      core = fromSave(d, city, b);
      SaveStore.save(toSave(core));
      set({ hud: snapshot(), bigMap: false, panel: null });
      return true;
    },
    rewind: (i) => {
      const d = SaveStore.snapshots()[i];
      if (!d || d.seed !== CITY_SEED) return false;
      core = fromSave(d, city, b);
      SaveStore.save(toSave(core));
      set({ hud: snapshot(), bigMap: false, panel: null });
      return true;
    },
    borrow: (kind, amount, plan) => {
      const id = get().loan;
      if (id === null) return;
      get().send({ type: 'loan', id, kind, amount, plan });
      set({ loan: null });
    },
    bigMap: false,
    fade: 0,
    toasts: [],
    prefs: prefs0,
    hasSave: SaveStore.load() !== null,
    start: (fresh) => {
      const saved = fresh ? null : SaveStore.load();
      core = saved && saved.seed === CITY_SEED ? fromSave(saved, city, b) : createGame(CITY_SEED, city, b);
      if (fresh) SaveStore.clear();
      input.fire = false;
      set({ phase: 'play', hud: snapshot(), panel: null, panelActs: null, mini: null, work: null, routes: null, busted: null, down: null, bigMap: false, report: null, broke: false, loan: null, hub: false });
      cancelAnimationFrame(raf);
      last = performance.now();
      raf = requestAnimationFrame(loop);
    },
    send: (cmd) => {
      handle(apply(core, city, cmd, b));
      set({ hud: snapshot() });
      SaveStore.save(toSave(core));
    },
    fire: () => shootNow(),
    // 乗る・降りる・盗む
    action: () => {
      buzz(10);
      get().send({ type: 'ride' });
    },
    // 場所に入る：歩きなら中の画面へ。乗り物のまま・外の機械（ATM）・解体屋は、その場で札を出す
    openPoi: () => {
      const id = get().hud.nearPoi;
      if (id === null) return;
      sfx.tap();
      const p = city.pois[id];
      // 契約の仕事がある相手の場所：入口で仕事を始める
      if (p.kind !== 'house' && poiActions(core, city, p, b).some((x) => x.id === 'deal')) {
        set({ panel: id, panelActs: ['deal'] });
        return;
      }
      if (core.ride !== null && p.kind === 'jewel') {
        get().toast('乗り物を降りてから入る', '');
        return;
      }
      if (core.ride !== null || p.kind === 'atm' || p.kind === 'chop' || kindOf(core, p) === 'land') {
        set({ panel: id, panelActs: null });
        return;
      }
      // 宝石店と銀行は、入り方を選ぶ
      if (p.kind === 'jewel' || p.kind === 'bank') {
        set({ routes: id });
        return;
      }
      if (p.kind === 'house') {
        const acts = poiActions(core, city, p, b);
        const a = acts.find((x) => x.id === 'break')!;
        if (acts.some((x) => x.id === 'gig')) set({ panel: id, panelActs: null }); // 仕事を受けた家：呼び鈴を押す
        else if (!a.ok) get().toast(a.why ?? '', '');
        else set({ mini: { poi: id, act: 'break' } });
        return;
      }
      get().send({ type: 'enter', id });
    },
    pickRoute: (rid) => {
      const id = get().routes;
      if (id === null) return;
      const r = routesOf(core, city.pois[id]).find((x) => x.id === rid);
      if (!r || !r.ok) return;
      buzz(10);
      set({ routes: null });
      if (r.how === 'pick') set({ mini: { poi: id, act: 'pick', route: rid } });
      else get().send({ type: 'enter', id, route: rid });
    },
    // 部屋の中で、近くの場所を使う
    spotAction: () => {
      const room = roomFor(core, city);
      const i = nearSpot(core, city);
      if (!room || !core.inside || i < 0) return;
      const sp = room.spots[i];
      const info = spotInfo(core, city, room, i, b);
      buzz(10);
      if (sp.exit) get().send({ type: 'leave' });
      else if (sp.loot) get().send({ type: 'loot', i });
      else if (!info.ok) get().toast(info.why, '');
      else if (sp.h) {
        if (info.mini) set({ mini: { poi: core.inside.poi, act: sp.h === 'panel' ? 'cam' : 'pickdoor', i } });
        else get().send({ type: 'heist', i });
      } else if (sp.acts && sp.acts.length === 1) get().send({ type: 'poi', id: core.inside.poi, act: sp.acts[0] });
      else if (sp.acts) set({ panel: core.inside.poi, panelActs: sp.acts });
    },
    act: (poi, act, mini) => {
      const kind = HAND[act];
      if (mini) set({ mini: { poi, act }, panel: null });
      else if (kind && !get().prefs.auto) {
        // 同じ仕事を同じ日に続けるときは、操作は最初の1回だけ。残りは同じ結果で進む
        if (lastWork && lastWork.act === act && lastWork.day === dayOf(core)) get().send({ type: 'poi', id: poi, act, grade: lastWork.grade });
        else set({ work: { poi, act, kind, narrow: core.eco.fatigue > b.self.handTired ? b.self.handNarrow : 1 } });
      } else get().send({ type: 'poi', id: poi, act });
    },
    workDone: (grade) => {
      const w = get().work;
      set({ work: null });
      if (!w) return;
      lastWork = { act: w.act, grade, day: dayOf(core) };
      get().send({ type: 'poi', id: w.poi, act: w.act, grade });
    },
    miniDone: (hits) => {
      const m = get().mini;
      set({ mini: null });
      if (!m) return;
      if (m.act === 'break') get().send({ type: 'enter', id: m.poi, hits });
      else if (m.act === 'pick') get().send({ type: 'enter', id: m.poi, hits, route: m.route });
      else if (m.act === 'cam' || m.act === 'pickdoor') get().send({ type: 'heist', i: m.i ?? 0, hits });
      else get().send({ type: 'poi', id: m.poi, act: m.act, hits });
    },
    set: (p) => set(p),
    setPrefs: (p) => {
      const prefs = { ...get().prefs, ...p };
      setSound(prefs.sound);
      savePrefs(prefs);
      set({ prefs });
    },
    // 目標の行き先（いちばん近い、まだ使っていない場所）へ道案内を出す
    guide: () => {
      const kind = get().hud.goalKind;
      let best: Poi | null = null;
      for (const p of city.pois) {
        if (p.kind !== kind || ownedPoi(core, city, p)) continue;
        if (!best || Math.hypot(p.x - core.x, p.y - core.y) < Math.hypot(best.x - core.x, best.y - core.y)) best = p;
      }
      if (best) {
        sfx.tap();
        get().send({ type: 'way', x: best.x, y: best.y });
      }
    },
    toast: (text, tone = '') => {
      const id = toastId++;
      set({ toasts: [...get().toasts.slice(-3), { id, text, tone }] });
      window.setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 2600);
    },
  };
});

export const poiOf = (id: number): Poi => city.pois[id];

// ほかの人と一緒に遊ぶ：claude.ai のページとして開いたときだけつながる（ほかの置き場では何もしない）
if (typeof window !== 'undefined') {
  const w = window as unknown as { claude?: { use?: (name: string) => Promise<unknown> } };
  void net.start(() => (w.claude?.use ? (w.claude.use('room') as Promise<never>) : null), city.size);
}

// 確かめ用（ブラウザのテストから状態を読む・場所へ動かす）
declare global {
  interface Window {
    __game?: { state: () => ReturnType<typeof toSave> & { ride: number | null; cars: number; inside: boolean }; spot: (i: number) => void; exit: () => void; mini: (hits: number) => void; work: (grade: 0 | 1 | 2) => void; go: (h: string, n?: number) => number; ins: () => GameState['inside']; tp: (x: number, y: number) => void; poi: (kind: string | number) => Poi | undefined; clock: (hour: number) => void; give: (what: string) => void };
  }
}
if (typeof window !== 'undefined') {
  window.__game = {
    state: () => ({ ...toSave(core), ride: core.ride, cars: core.cars.length, inside: !!core.inside }),
    spot: (i) => {
      const room = roomFor(core, city);
      if (!room || !core.inside) return;
      // その場所のすぐそば（壁や扉の中でない所）へ動かす
      const sp = room.spots[i];
      for (const [dx, dy] of [[0, 0], [0, 0.7], [0, -0.7], [0.7, 0], [-0.7, 0], [0, 1.1], [0, -1.1]]) {
        if (blocked(room, sp.x + dx, sp.y + dy, 0.34, core.inside.open)) continue;
        core.inside.x = sp.x + dx;
        core.inside.y = sp.y + dy;
        return;
      }
    },
    go: (h, n) => {
      const room = roomFor(core, city);
      const i = room ? room.spots.findIndex((sp) => sp.h === h && (n === undefined || sp.n === n)) : -1;
      if (i >= 0) window.__game!.spot(i);
      return i;
    },
    ins: () => core.inside,
    exit: () => {
      const room = roomFor(core, city);
      if (room) window.__game!.spot(room.spots.length - 1);
    },
    mini: (hits) => useGame.getState().miniDone(hits),
    work: (grade) => useGame.getState().workDone(grade),
    tp: (x, y) => {
      core.x = x;
      core.y = y;
    },
    poi: (kind) => (typeof kind === 'number' ? city.pois[kind] : city.pois.find((p) => p.kind === kind)),
    give: (what) => {
      if (what === 'gun') core.gun = true;
      if (what === 'crowbar') core.crowbar = true;
      if (what === 'laptop') core.laptop = true;
      if (what === 'lockpick') core.lockpick = true;
      if (what === 'drill') core.drill = true;
      if (what === 'down') core.hp = 0;
      if (what === 'calm') core.heat = 0;
      if (what === 'money') core.cash += 1000000;
      if (what === 'hp') core.hp = 100000;
    },
    clock: (hour) => {
      core.clock = Math.floor(core.clock / 1440) * 1440 + hour * 60;
    },
  };
}
