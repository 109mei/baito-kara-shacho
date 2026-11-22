// 保存の窓口。保存と読み込みはここだけを通す。版番号を付け、古い版は新しい版へ変換する。
import { SAVE_VERSION } from '../core/game';
import type { GameState } from '../core/types';

const KEY = 'baito-kara-shacho/save';

interface SaveFile {
  v: number;
  savedAt: string;
  state: GameState;
}

/** 古い版のセーブを、いまの版の形に直す */
export function migrate(file: { v?: number; state?: unknown }): GameState | null {
  if (!file || typeof file !== 'object' || !file.state) return null;
  const s = file.state as GameState & Record<string, unknown>;
  const v = typeof file.v === 'number' ? file.v : 0;
  if (v > SAVE_VERSION) return null;
  // v0 → v1：おまかせの設定がなかった
  if (v < 1 && typeof s.autoQuality !== 'boolean') s.autoQuality = false;
  s.v = SAVE_VERSION;
  if (typeof s.day !== 'number' || typeof s.cash !== 'number' || !s.biz || !s.templates) return null;
  return s;
}

export const SaveStore = {
  save(state: GameState): boolean {
    try {
      const file: SaveFile = { v: SAVE_VERSION, savedAt: new Date().toISOString(), state };
      localStorage.setItem(KEY, JSON.stringify(file));
      return true;
    } catch {
      return false; // 保存できない環境でも、遊びは止めない
    }
  },
  load(): GameState | null {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? migrate(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  },
  clear() {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* 何もしない */
    }
  },
  exportText(state: GameState): string {
    const file: SaveFile = { v: SAVE_VERSION, savedAt: new Date().toISOString(), state };
    return btoa(unescape(encodeURIComponent(JSON.stringify(file))));
  },
  importText(text: string): GameState | null {
    try {
      return migrate(JSON.parse(decodeURIComponent(escape(atob(text.trim())))));
    } catch {
      return null;
    }
  },
};

// 遊び方の好み（音・動き）。ゲームの進み具合とは別に持つ
export interface Prefs {
  sound: boolean;
  calm: boolean; // 動きを少なくする
}
const PREFS_KEY = 'baito-kara-shacho/prefs';
export function loadPrefs(): Prefs {
  let calm = false;
  try {
    calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    /* 調べられない環境では、ふつうの動きにする */
  }
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Prefs>;
      return { sound: p.sound !== false, calm: typeof p.calm === 'boolean' ? p.calm : calm };
    }
  } catch {
    /* 読めなければ初期の値 */
  }
  return { sound: true, calm };
}
export function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* 保存できない環境でも、遊びは止めない */
  }
}
