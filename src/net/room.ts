// ほかの人と一緒に遊ぶ。claude.ai のページとして開いたときだけ使える「room」の仕組みで、
// 同じページを「いま」開いている人どうしが、位置と様子を送り合う。サーバーは自分では持たない。
// ルール本体はこのことを知らない。ここは「外から来る入力」を読んで、橋渡し（store）に渡すだけ。
// 相手から届く物は信用しない：数は範囲を確かめてから使う。何も残らない（開いている間だけ）。

export interface Mate {
  id: string; // その人の、いま開いているページの名前（開き直すと変わる）
  x: number; y: number; a: number; // 画面に出す位置（なめらかに動かす）
  tx: number; ty: number; // 届いた位置
  ride: 0 | 1 | 2; // 歩き・自転車・車
  stars: number; turfs: number; inside: boolean; hp: number;
}
export interface MyState { x: number; y: number; a: number; ride: 0 | 1 | 2; stars: number; turfs: number; inside: boolean; hp: number }

// room の中で、ここが使う分だけの形
interface PeerLike { peer: string; isMe: boolean; sameTab: boolean; kind: string; presence: Readonly<Record<string, unknown>> }
export interface RoomLike {
  presence(patch: Record<string, unknown>): Promise<void>;
  onPeers(handler: (change: { peers: readonly PeerLike[] }) => void, onError?: (e: unknown) => void): () => void;
}

const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
const TAG = 1; // このゲームの印（同じページに別の物が乗っても混ざらないように）

export class Net {
  mates = new Map<string, Mate>();
  me = '';
  online = false;
  // 撃たれたとき（1発ごと）。どこから撃たれたかを渡す
  onHit: (from: Mate) => void = () => {};
  private room: RoomLike | null = null;
  private seen = new Map<string, number>(); // 相手ごとの「撃った回数」。増えた分だけ当たる
  private shots = 0;
  private target = '';
  private size = 8000;

  async start(open: () => Promise<RoomLike | null> | null | undefined, size: number): Promise<boolean> {
    this.size = size;
    try {
      this.room = (await open()) ?? null;
    } catch {
      this.room = null;
    }
    if (!this.room) return false;
    this.online = true;
    this.room.onPeers((c) => this.read(c.peers), () => this.stop());
    return true;
  }
  private stop() {
    this.room = null;
    this.online = false;
    this.mates.clear();
  }
  // 自分の様子を送る（まるごと。差分ではなく、いまの値）
  send(st: MyState) {
    if (!this.room) return;
    const r = (v: number) => Math.round(v * 10) / 10;
    this.room
      .presence({ g: TAG, x: r(st.x), y: r(st.y), a: Math.round(st.a * 100) / 100, r: st.ride, s: st.stars, t: st.turfs, i: st.inside ? 1 : 0, h: Math.round(st.hp), f: this.shots ? { to: this.target, n: this.shots } : null })
      .catch(() => {});
  }
  // 相手を撃った（相手の画面で、体力が減る）
  fireAt(id: string) {
    this.target = id;
    this.shots++;
  }
  // 届いた一覧を読む
  read(peers: readonly PeerLike[]) {
    const here = new Set<string>();
    for (const p of peers) {
      if (p.isMe && p.sameTab) {
        this.me = p.peer;
        continue;
      }
      const q = p.presence;
      if (p.kind !== 'viewer' || !q || q.g !== TAG) continue;
      here.add(p.peer);
      const tx = num(q.x, 0, this.size, -1);
      const ty = num(q.y, 0, this.size, -1);
      if (tx < 0 || ty < 0) continue;
      let m = this.mates.get(p.peer);
      if (!m) {
        m = { id: p.peer, x: tx, y: ty, a: 0, tx, ty, ride: 0, stars: 0, turfs: 0, inside: false, hp: 100 };
        this.mates.set(p.peer, m);
      }
      m.tx = tx;
      m.ty = ty;
      m.a = num(q.a, -7, 7, 0);
      m.ride = num(q.r, 0, 2, 0) as 0 | 1 | 2;
      m.stars = num(q.s, 0, 5, 0);
      m.turfs = num(q.t, 0, 6, 0);
      m.inside = q.i === 1;
      m.hp = num(q.h, 0, 100, 100);
      // 撃たれたか：相手の「撃った回数」が、前に見たときより増えていて、的が自分のとき
      const f = q.f as { to?: unknown; n?: unknown } | null | undefined;
      const n = f && typeof f === 'object' ? num(f.n, 0, 1e9, 0) : 0;
      const before = this.seen.get(p.peer);
      this.seen.set(p.peer, n);
      if (before !== undefined && n > before && f && f.to === this.me && this.me) {
        for (let k = 0; k < Math.min(3, n - before); k++) this.onHit(m);
      }
    }
    for (const id of [...this.mates.keys()]) {
      if (!here.has(id)) {
        this.mates.delete(id);
        this.seen.delete(id);
      }
    }
  }
  // 相手の位置を、届いた位置へなめらかに寄せる（遠すぎたら、そのまま移す）
  step(dt: number) {
    const k = 1 - Math.exp(-dt * 10);
    for (const m of this.mates.values()) {
      if (Math.hypot(m.tx - m.x, m.ty - m.y) > 60) {
        m.x = m.tx;
        m.y = m.ty;
      } else {
        m.x += (m.tx - m.x) * k;
        m.y += (m.ty - m.y) * k;
      }
    }
  }
  // 外にいる相手のうち、いちばん近い人
  nearest(x: number, y: number, range: number): Mate | null {
    let best: Mate | null = null;
    let bd = range;
    for (const m of this.mates.values()) {
      if (m.inside) continue;
      const d = Math.hypot(m.x - x, m.y - y);
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    return best;
  }
}

export const net = new Net();
export const MATE_COLORS = [0x19a7b8, 0xe8833a, 0x7d5fd1, 0x3f9d57, 0xd94c8a];
export const mateColor = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return MATE_COLORS[h % MATE_COLORS.length];
};
