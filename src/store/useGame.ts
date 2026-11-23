// ルール本体と画面の橋渡し。状態の持ち主はルール本体で、ここは写しを配るだけ。
// ルール本体は 1/30 秒の決まった刻みで進める。画面の数字は 1 秒に 10 回だけ更新する。
import { create } from 'zustand';
import { makeCity, type City, type Poi, type PoiKind } from '../core/city';
import { blocked } from '../core/rooms';
import { apply, createGame, dayOf, fromSave, hourOf, nearby, nearSpot, ownedPoi, poiActions, poiTitle, rank, riding, roomFor, routesOf, spotInfo, stars, step, STEP, toSave, type Cmd, type Ev, type GameState } from '../core/sim';
import { balance as b } from '../data/schema';
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
}
export interface Toast { id: number; text: string; tone: string }
interface Store {
  phase: 'title' | 'play';
  hud: Hud;
  panel: number | null; // 開いている場所
  panelActs: string[] | null; // 札に出す行動（部屋の中の1か所ぶん）。null は全部
  spotAction: () => void;
  mini: { poi: number; act: string; i?: number; route?: 'front' | 'back' } | null;
  routes: number | null; // 入り方を選んでいる場所
  pickRoute: (id: 'front' | 'back') => void;
  busted: Extract<Ev, { type: 'busted' }> | null;
  down: number | null; // 倒されたとき：失った額
  hurt: number; // 撃たれた回数（画面のふちを赤く光らせる合図）
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
  set: (p: Partial<Pick<Store, 'panel' | 'panelActs' | 'bigMap' | 'busted' | 'mini' | 'down' | 'routes'>>) => void;
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
  if (!hasRide) return ['自転車を買う', 'bike'];
  if (s.biz.length === 0) return [`屋台を出す ¥${b.biz.stall.toLocaleString('ja-JP')}`, s.cash >= b.biz.stall ? 'lot' : 'conbini'];
  if (s.biz.length < 3) return [`社長まで 事業 ${s.biz.length}/3`, 'lot'];
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
    tools: [s.crowbar && 'バール', s.lockpick && 'ピッキング道具', s.laptop && 'ノートPC', s.drill && 'ドリル', s.gun && '銃', s.keys.length > 0 && `鍵 ${s.keys.length}本`].filter((x): x is string => !!x),
    ...insideHud(s),
  };
}

export const useGame = create<Store>((set, get) => {
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
        const net = e.profit + e.turf - e.living;
        get().toast(`1日の終わり　事業 +¥${e.profit.toLocaleString('ja-JP')}${e.turf ? `　縄張り +¥${e.turf.toLocaleString('ja-JP')}` : ''}　生活費 −¥${e.living.toLocaleString('ja-JP')}`, net >= 0 ? 'good' : '');
        if (e.lost) get().toast(e.lost, 'bad');
        if (e.news) get().toast(e.news, '');
      } else if (e.type === 'skip') set({ fade: get().fade + 1 });
    }
  };
  const loop = (now: number) => {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const st = get();
    const paused = st.phase !== 'play' || st.panel !== null || st.mini !== null || st.bigMap || st.busted !== null || st.down !== null || st.routes !== null;
    if (!paused) {
      acc += dt;
      let n = 0;
      while (acc >= STEP && n < 5) {
        if (input.fire && core.gun && core.fireCd <= 0 && !core.inside) handle(apply(core, city, { type: 'fire' }, b)); // 押しっぱなしで撃ち続ける
        handle(step(core, city, input, b));
        acc -= STEP;
        n++;
      }
      if (n === 5) acc = 0;
      // 建物の中：警報が鳴っている間は 1 秒ごとに音、ドリルの間は削る音
      if (core.inside && (core.inside.alarm > 0 || core.inside.drill > 0)) {
        beepT -= dt;
        if (beepT <= 0) {
          beepT = core.inside.drill > 0 ? 0.22 : 1;
          if (core.inside.drill > 0) sfx.drill();
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
    hudT += dt;
    if (hudT > 0.1) {
      hudT = 0;
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
    routes: null,
    busted: null,
    down: null,
    hurt: 0,
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
      set({ phase: 'play', hud: snapshot(), panel: null, panelActs: null, mini: null, routes: null, busted: null, down: null, bigMap: false });
      cancelAnimationFrame(raf);
      last = performance.now();
      raf = requestAnimationFrame(loop);
    },
    send: (cmd) => {
      handle(apply(core, city, cmd, b));
      set({ hud: snapshot() });
      SaveStore.save(toSave(core));
    },
    fire: () => {
      handle(apply(core, city, { type: 'fire' }, b));
    },
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
      if (core.ride !== null && p.kind === 'jewel') {
        get().toast('乗り物を降りてから入る', '');
        return;
      }
      if (core.ride !== null || p.kind === 'atm' || p.kind === 'chop') {
        set({ panel: id, panelActs: null });
        return;
      }
      // 宝石店と銀行は、入り方を選ぶ
      if (p.kind === 'jewel' || p.kind === 'bank') {
        set({ routes: id });
        return;
      }
      if (p.kind === 'house') {
        const a = poiActions(core, city, p, b)[0];
        if (!a.ok) get().toast(a.why ?? '', '');
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
      if (mini) set({ mini: { poi, act }, panel: null });
      else get().send({ type: 'poi', id: poi, act });
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

// 確かめ用（ブラウザのテストから状態を読む・場所へ動かす）
declare global {
  interface Window {
    __game?: { state: () => ReturnType<typeof toSave> & { ride: number | null; cars: number; inside: boolean }; spot: (i: number) => void; exit: () => void; mini: (hits: number) => void; go: (h: string, n?: number) => number; ins: () => GameState['inside']; tp: (x: number, y: number) => void; poi: (kind: string) => Poi | undefined; clock: (hour: number) => void; give: (what: string) => void };
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
    tp: (x, y) => {
      core.x = x;
      core.y = y;
    },
    poi: (kind) => city.pois.find((p) => p.kind === kind),
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
