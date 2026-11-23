// ルール本体と画面の橋渡し。状態の持ち主はルール本体で、ここは写しを配るだけ。
// ルール本体は 1/30 秒の決まった刻みで進める。画面の数字は 1 秒に 10 回だけ更新する。
import { create } from 'zustand';
import { makeCity, type City, type Poi } from '../core/city';
import { apply, createGame, dayOf, fromSave, hourOf, nearby, poiTitle, rank, riding, stars, step, STEP, toSave, type Cmd, type Ev, type GameState } from '../core/sim';
import { balance as b } from '../data/schema';
import { loadPrefs, savePrefs, SaveStore, type Prefs } from '../save/SaveStore';
import { buzz, setSound, sfx } from '../ui/sfx';

export const CITY_SEED = 20261123;
export const city: City = makeCity(CITY_SEED, b);
let core: GameState = createGame(CITY_SEED, city, b);
export const getCore = () => core;
export const input = { mx: 0, my: 0 };

export interface Hud {
  cash: number; dirty: number; bank: number; loot: number;
  day: number; hour: number; stars: number; seen: boolean;
  ride: 'foot' | 'bike' | 'car'; kmh: number; rank: string; bizN: number;
  nearCar: '' | '乗る' | '盗む'; nearPoi: number | null; nearName: string; way: boolean;
}
export interface Toast { id: number; text: string; tone: string }
interface Store {
  phase: 'title' | 'play';
  hud: Hud;
  panel: number | null; // 開いている場所
  mini: { poi: number; act: string } | null;
  busted: Extract<Ev, { type: 'busted' }> | null;
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
  set: (p: Partial<Pick<Store, 'panel' | 'bigMap' | 'busted' | 'mini'>>) => void;
  setPrefs: (p: Partial<Prefs>) => void;
  toast: (text: string, tone?: string) => void;
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

function snapshot(): Hud {
  const s = core;
  const car = riding(s);
  const near = nearby(s, city);
  return {
    cash: s.cash, dirty: s.dirty, bank: s.bank, loot: s.loot, day: dayOf(s) + 1, hour: hourOf(s), stars: stars(s, b), seen: s.seen,
    ride: car ? (car.bike ? 'bike' : 'car') : 'foot', kmh: car ? Math.round(Math.abs(car.v) * 3.6) : 0, rank: rank(s), bizN: s.biz.length,
    nearCar: near.car ? (near.car.kind === 'mine' || near.car.kind === 'stolen' ? '乗る' : '盗む') : '',
    nearPoi: near.poi ? near.poi.id : null, nearName: near.poi ? poiTitle(s, near.poi) : '', way: !!s.way,
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
        else sfx.accept();
      } else if (e.type === 'star') {
        get().toast(`手配 ${'★'.repeat(e.stars)}`, 'bad');
        sfx.fail();
        buzz(30);
      } else if (e.type === 'busted') {
        set({ busted: e, panel: null, mini: null });
        sfx.month(false);
      } else if (e.type === 'day') {
        const net = e.profit - e.living;
        get().toast(`1日の終わり　事業 +¥${e.profit.toLocaleString('ja-JP')}　生活費 −¥${e.living.toLocaleString('ja-JP')}`, net >= 0 ? 'good' : '');
      } else if (e.type === 'skip') set({ fade: get().fade + 1 });
    }
  };
  const loop = (now: number) => {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const st = get();
    const paused = st.phase !== 'play' || st.panel !== null || st.mini !== null || st.bigMap || st.busted !== null;
    if (!paused) {
      acc += dt;
      let n = 0;
      while (acc >= STEP && n < 5) {
        handle(step(core, city, input, b));
        acc -= STEP;
        n++;
      }
      if (n === 5) acc = 0;
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
    mini: null,
    busted: null,
    bigMap: false,
    fade: 0,
    toasts: [],
    prefs: prefs0,
    hasSave: SaveStore.load() !== null,
    start: (fresh) => {
      const saved = fresh ? null : SaveStore.load();
      core = saved && saved.seed === CITY_SEED ? fromSave(saved, city, b) : createGame(CITY_SEED, city, b);
      if (fresh) SaveStore.clear();
      set({ phase: 'play', hud: snapshot(), panel: null, mini: null, busted: null, bigMap: false });
      cancelAnimationFrame(raf);
      last = performance.now();
      raf = requestAnimationFrame(loop);
    },
    send: (cmd) => {
      handle(apply(core, city, cmd, b));
      set({ hud: snapshot() });
      SaveStore.save(toSave(core));
    },
    // 乗る・降りる・盗む
    action: () => {
      buzz(10);
      get().send({ type: 'ride' });
    },
    openPoi: () => {
      const id = get().hud.nearPoi;
      if (id !== null) {
        sfx.tap();
        set({ panel: id });
      }
    },
    act: (poi, act, mini) => {
      if (mini) set({ mini: { poi, act }, panel: null });
      else get().send({ type: 'poi', id: poi, act });
    },
    miniDone: (hits) => {
      const m = get().mini;
      set({ mini: null });
      if (m) get().send({ type: 'poi', id: m.poi, act: m.act, hits });
    },
    set: (p) => set(p),
    setPrefs: (p) => {
      const prefs = { ...get().prefs, ...p };
      setSound(prefs.sound);
      savePrefs(prefs);
      set({ prefs });
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
    __game?: { state: () => ReturnType<typeof toSave> & { ride: number | null; cars: number }; tp: (x: number, y: number) => void; poi: (kind: string) => Poi | undefined };
  }
}
if (typeof window !== 'undefined') {
  window.__game = {
    state: () => ({ ...toSave(core), ride: core.ride, cars: core.cars.length }),
    tp: (x, y) => {
      core.x = x;
      core.y = y;
    },
    poi: (kind) => city.pois.find((p) => p.kind === kind),
  };
}
