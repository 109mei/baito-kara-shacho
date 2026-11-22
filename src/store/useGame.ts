// ルール本体と画面の橋渡し。画面に見せる「写し」だけを持つ。
// 状態の持ち主はルール本体（core）で、画面からは命令を渡すだけ。
import { create } from 'zustand';
import { advanceDay, apply, clone, createGame } from '../core/game';
import type { Biz, Command, GameEvent, GameState, Quality } from '../core/types';
import { balance as b } from '../data/schema';
import { SaveStore } from '../save/SaveStore';

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

interface Store {
  s: GameState;
  tab: Tab;
  mini: MiniRequest | null;
  toasts: Toast[];
  pulse: number; // 1日進むたびに増える（街の絵の合図）
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
      if (e.type === 'delivered') get().toast(`+${yen(e.amount)}`, 'good');
      else if (e.type === 'failed') get().toast('納期切れ', 'bad');
      else if (e.type === 'released') get().toast(`発売 ${e.first}本`, 'good');
    }
  };
  return {
    s: clone(core),
    tab: 'home',
    mini: null,
    toasts: [],
    pulse: 0,
    setTab: (tab) => set({ tab }),
    send: (cmd) => {
      report(apply(core, cmd, b));
      sync();
    },
    advance: (mode) => {
      if (core.phase !== 'play') return;
      const max = mode === 'day' ? 1 : mode === 'week' ? 7 : b.time.daysPerMonth;
      const all: GameEvent[] = [];
      for (let i = 0; i < max; i++) {
        const ev = advanceDay(core, b);
        all.push(...ev);
        // 自分が決めることができたら止まる
        if (ev.some((e) => e.type === 'monthEnd' || e.type === 'offer' || e.type === 'short' || e.type === 'failed' || e.type === 'released')) break;
      }
      report(all);
      set({ pulse: get().pulse + 1 });
      sync();
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
