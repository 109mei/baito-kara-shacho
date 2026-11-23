// 保存の窓口は、ここ1つだけ。版番号を付け、古い版は新しい版へ変換する。
import { SAVE_VERSION, type SaveData } from '../core/sim';

const KEY = 'baito-kara-shacho/open/save';
const PREFS_KEY = 'baito-kara-shacho/prefs';

function migrate(raw: unknown): SaveData | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Partial<SaveData>;
  if (typeof d.v !== 'number' || typeof d.seed !== 'number' || typeof d.x !== 'number') return null;
  // 版が上がったら、ここで古い形を新しい形へ直す
  if (d.v > SAVE_VERSION) return null;
  return d as SaveData;
}

export const SaveStore = {
  load(): SaveData | null {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? migrate(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  },
  save(d: SaveData) {
    try {
      localStorage.setItem(KEY, JSON.stringify(d));
    } catch {
      /* 保存できない環境でも、遊びは止めない */
    }
  },
  clear() {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* 何もしない */
    }
  },
  exportText(d: SaveData): string {
    return JSON.stringify(d);
  },
  importText(text: string): SaveData | null {
    try {
      return migrate(JSON.parse(text));
    } catch {
      return null;
    }
  },
};

// 遊び方の好み（音・動き）
export interface Prefs {
  sound: boolean;
  calm: boolean;
}
export function loadPrefs(): Prefs {
  let calm = false;
  try {
    calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    /* 調べられなければ、ふつうの動き */
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
    /* 何もしない */
  }
}
