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
  // 1日の終わりの保存：直近3回分を残す（.1 が新しい、.3 が古い）
  snapshot(d: SaveData) {
    try {
      for (let i = 2; i >= 1; i--) {
        const v = localStorage.getItem(`${KEY}.${i}`);
        if (v) localStorage.setItem(`${KEY}.${i + 1}`, v);
      }
      localStorage.setItem(`${KEY}.1`, JSON.stringify(d));
    } catch {
      /* 保存できない環境でも、遊びは止めない */
    }
  },
  // 残っている保存（新しい順）
  snapshots(): SaveData[] {
    const out: SaveData[] = [];
    try {
      for (let i = 1; i <= 3; i++) {
        const v = localStorage.getItem(`${KEY}.${i}`);
        const d = v ? migrate(JSON.parse(v)) : null;
        if (d) out.push(d);
      }
    } catch {
      /* 何もしない */
    }
    return out;
  },
  clear() {
    try {
      for (let i = 1; i <= 3; i++) localStorage.removeItem(`${KEY}.${i}`);
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
  text: number; // 文字の大きさ（0 ふつう・1 大きい・2 とても大きい）
  auto?: boolean; // 手でやる操作を「おまかせ」にする（操作なしで、ふつうの結果）
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
      return { sound: p.sound !== false, calm: typeof p.calm === 'boolean' ? p.calm : calm, text: p.text === 1 || p.text === 2 ? p.text : 0, auto: p.auto === true };
    }
  } catch {
    /* 読めなければ初期の値 */
  }
  return { sound: true, calm, text: 0 };
}
export function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* 何もしない */
  }
}
