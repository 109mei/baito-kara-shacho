// ルール本体と画面の橋渡し。画面に見せる「写し」だけを持つ。
// 状態の持ち主はルール本体（core）で、画面からは命令を渡すだけ。
import { create } from 'zustand';
import { advanceDay, apply, clone, createGame, JOB_BIZ } from '../core/game';
import type { Biz, Command, GameEvent, GameState, Quality } from '../core/types';
import { balance as b } from '../data/schema';
import { loadPrefs, savePrefs, SaveStore, type Prefs } from '../save/SaveStore';
import { buzz, setSound, sfx } from '../ui/sfx';
import type { PlaceKey } from '../world/World';

export type Tab = 'home' | 'work' | 'plan' | 'people' | 'money';
export type MiniKind = 'order' | 'trace' | 'tap';
export interface MiniRequest {
  kind: MiniKind;
  biz: Biz;
  done: (q: Quality) => void;
}
export interface Toast {
  id: number;
  text: string;
  tone: 'good' | 'bad' | 'info';
}

function newSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) | 0;
}

let core: GameState = SaveStore.load() ?? createGame(newSeed(), b);
let toastId = 1;
let fxId = 1;
let runTimer = 0;
const firstPrefs = loadPrefs();
setSound(firstPrefs.sound);

// 街の絵に出す合図（お金が入った場所など）
export interface Fx {
  id: number;
  place: PlaceKey;
  big: boolean;
}

interface Store {
  s: GameState;
  tab: Tab;
  mini: MiniRequest | null;
  toasts: Toast[];
  pulse: number; // 1日進むたびに増える（街の絵の合図）
  busy: 'week' | 'month' | null; // まとめて進めている最中
  left: number; // まとめて進める残りの日数
  fx: Fx | null;
  prefs: Prefs;
  stop: () => void;
  setPrefs: (p: Partial<Prefs>) => void;
  setTab: (t: Tab) => void;
  send: (cmd: Command) => void;
  advance: (mode: 'day' | 'week' | 'month') => void;
  askMini: (biz: Biz, done: (q: Quality) => void) => void;
  closeMini: () => void;
  toast: (text: string, tone?: Toast['tone']) => void;
  reset: () => void;
  importSave: (text: string) => boolean;
  exportSave: () => string;
}

const MINI: Record<Biz, MiniKind> = { craft: 'order', handy: 'trace', dev: 'tap' };

export const useGame = create<Store>((set, get) => {
  const sync = () => {
    SaveStore.save(core);
    set({ s: clone(core) });
  };
  const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`;
  const report = (ev: GameEvent[]) => {
    for (const e of ev) {
      if (e.type === 'delivered') {
        const o = core.orders.find((x) => x.id === e.id);
        const place: PlaceKey = o && JOB_BIZ[o.job] === 'handy' ? 'c1' : 'market';
        get().toast(`+${yen(e.amount)}`, 'good');
        set({ fx: { id: fxId++, place, big: e.amount >= 20000 } });
        sfx.coin(e.amount >= 20000);
        buzz(12);
      } else if (e.type === 'failed') {
        get().toast('納期切れ', 'bad');
        sfx.fail();
        buzz(30);
      } else if (e.type === 'released') {
        get().toast(`発売 ${e.first}本`, 'good');
        set({ fx: { id: fxId++, place: 'home', big: true } });
        sfx.great();
      }
    }
  };
  // 自分が決めることができたら止まる
  const stops = (ev: GameEvent[]) => ev.some((e) => e.type === 'monthEnd' || e.type === 'offer' || e.type === 'short' || e.type === 'failed' || e.type === 'released');
  const oneDay = (): boolean => {
    const ev = advanceDay(core, b);
    report(ev);
    if (ev.some((e) => e.type === 'monthEnd')) {
      const r = core.reports[core.reports.length - 1];
      sfx.month(!!r && !r.restarted && !r.unpaid && r.cashEnd >= r.cashStart);
    }
    set({ pulse: get().pulse + 1 });
    sync();
    return stops(ev);
  };
  return {
    s: clone(core),
    tab: 'home',
    mini: null,
    toasts: [],
    pulse: 0,
    busy: null,
    left: 0,
    fx: null,
    prefs: firstPrefs,
    setTab: (tab) => {
      if (tab !== get().tab) sfx.tab();
      set({ tab });
    },
    send: (cmd) => {
      if (cmd.type === 'accept' || cmd.type === 'hire' || cmd.type === 'startBiz' || cmd.type === 'pick' || cmd.type === 'buyTool') sfx.accept();
      else if (cmd.type === 'decline' || cmd.type === 'dismiss') sfx.decline();
      report(apply(core, cmd, b));
      sync();
    },
    // 1日は、押した瞬間に進む。1週・月末までは、1日ずつ見せながら進み、途中で止められる
    advance: (mode) => {
      if (core.phase !== 'play' || get().busy) return;
      if (mode === 'day') {
        sfx.day();
        oneDay();
        return;
      }
      const max = mode === 'week' ? 7 : b.time.daysPerMonth;
      const gap = get().prefs.calm ? 0 : mode === 'week' ? 300 : 130;
      let left = max;
      const step = () => {
        const stopped = oneDay();
        left -= 1;
        if (stopped || left <= 0 || core.phase !== 'play' || !get().busy) {
          set({ busy: null, left: 0 });
          return;
        }
        sfx.tick();
        set({ left });
        runTimer = window.setTimeout(step, gap);
      };
      if (gap === 0) {
        for (let i = 0; i < max; i++) if (oneDay() || core.phase !== 'play') break;
        return;
      }
      set({ busy: mode, left });
      step();
    },
    stop: () => {
      window.clearTimeout(runTimer);
      set({ busy: null, left: 0 });
    },
    setPrefs: (p) => {
      const prefs = { ...get().prefs, ...p };
      setSound(prefs.sound);
      savePrefs(prefs);
      set({ prefs });
      if (p.sound) sfx.accept();
    },
    askMini: (biz, done) => {
      if (core.autoQuality) {
        done('ok');
        return;
      }
      set({ mini: { kind: MINI[biz], biz, done } });
    },
    closeMini: () => set({ mini: null }),
    toast: (text, tone = 'info') => {
      const id = toastId++;
      set({ toasts: [...get().toasts.slice(-3), { id, text, tone }] });
      setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 1800);
    },
    reset: () => {
      window.clearTimeout(runTimer);
      set({ busy: null, left: 0 });
      SaveStore.clear();
      core = createGame(newSeed(), b);
      set({ tab: 'home', mini: null });
      sync();
    },
    importSave: (text) => {
      const loaded = SaveStore.importText(text);
      if (!loaded) return false;
      core = loaded;
      sync();
      return true;
    },
    exportSave: () => SaveStore.exportText(core),
  };
});

// テスト（Playwright）から状態を見るための窓
declare global {
  interface Window {
    __game?: { state: () => GameState };
  }
}
if (typeof window !== 'undefined') window.__game = { state: () => clone(core) };
