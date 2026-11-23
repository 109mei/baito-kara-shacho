// 街を種から作る。同じ種なら、いつも同じ街になる。画面のことは知らない。
// 形：縦と横の道の線（大通りと細い道）が格子を作り、川と海で切れる。川は大通りだけが橋で渡る。
import type { Balance } from '../data/schema';

export type District = 'downtown' | 'commercial' | 'residential' | 'industrial' | 'park' | 'water';
export type PoiKind = 'home' | 'conbini' | 'warehouse' | 'bike' | 'car' | 'tool' | 'pawn' | 'chop' | 'bank' | 'police' | 'lot' | 'atm' | 'house' | 'hideout' | 'gang' | 'jewel' | 'market' | 'office' | 'apart';
export interface Poi { id: number; kind: PoiKind; x: number; y: number; district: District; traffic: number }
export interface Block { i: number; j: number; x0: number; y0: number; x1: number; y1: number; d: District; b: Float32Array }
export interface City {
  seed: number;
  size: number;
  xs: number[]; // 縦の道の x
  ys: number[]; // 横の道の y
  ax: boolean[]; // 縦の道が大通りか
  ay: boolean[]; // 横の道が大通りか
  h: Uint8Array; // 横の区間 (i,j)-(i+1,j)：0 なし／1 細い道／2 大通り／3 橋
  v: Uint8Array; // 縦の区間 (i,j)-(i,j+1)
  ok: Uint8Array; // 交差点が、街の主な道につながっているか
  blocks: Block[]; // 区画。番号は j*(NX-1)+i
  pois: Poi[];
  home: Poi;
  bridges: number[]; // 橋のある横の大通りの y
  half: (arterial: boolean) => number;
  coast: (y: number) => number;
  river: (y: number) => number;
}

export function makeRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 縄張り：街を 横3×縦2 の6つに分ける。はじめは3つの組織が2つずつ持っている
export const GANGS = [{ name: '赤蛇会', color: 0xd9463c }, { name: '青龍組', color: 0x2f6bd9 }, { name: '緑風連合', color: 0x2f9a5a }];
export const turfOf = (size: number, x: number, y: number) => Math.min(2, Math.max(0, Math.floor((x / size) * 3))) + 3 * Math.min(1, Math.max(0, Math.floor((y / size) * 2)));

export const TRAFFIC: Record<District, number> = { downtown: 1.6, commercial: 1.25, residential: 0.8, industrial: 0.55, park: 0.6, water: 0 };

export function makeCity(seed: number, bal: Balance): City {
  const r = makeRng(seed);
  const S = bal.world.size;
  const RH = bal.world.riverHalf;
  const p1 = r() * 6;
  const p2 = r() * 6;
  const coast = (y: number) => 520 + 180 * Math.sin(y / 900 + p1) + 90 * Math.sin(y / 310 + 0.4);
  const river = (y: number) => S * 0.64 + 420 * Math.sin(y / 1500 + p2) + 150 * Math.sin(y / 520 + 2);
  const sea = (x: number, y: number) => x < coast(y);
  const inRiver = (x: number, y: number) => Math.abs(x - river(y)) < RH;
  const half = (arterial: boolean) => (arterial ? bal.world.arterialHalf : bal.world.minorHalf);

  // 道の線：大通りを 720〜920m おきに置き、その間に細い道を 3〜5 本
  const lines = () => {
    const p: number[] = [];
    const a: boolean[] = [];
    let x = 260 + r() * 80;
    while (x < S - 200) {
      p.push(x);
      a.push(true);
      const next = x + 720 + r() * 200;
      const n = 3 + Math.floor(r() * 3);
      for (let k = 1; k <= n; k++) {
        const q = x + ((next - x) * k) / (n + 1) + (r() - 0.5) * 30;
        if (q < S - 200) {
          p.push(q);
          a.push(false);
        }
      }
      x = next;
    }
    return { p, a };
  };
  const lx = lines();
  const ly = lines();
  const xs = lx.p;
  const ys = ly.p;
  const ax = lx.a;
  const ay = ly.a;
  const NX = xs.length;
  const NY = ys.length;

  // 交差点が使えるか：海の上はだめ。川の上は、横の大通り（橋）だけよい
  const nodeOk = (i: number, j: number) => !sea(xs[i], ys[j]) && (!inRiver(xs[i], ys[j]) || ay[j]);
  const h = new Uint8Array(NX * NY);
  const v = new Uint8Array(NX * NY);
  const bridgeSet = new Set<number>();
  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) {
      if (i < NX - 1 && nodeOk(i, j) && nodeOk(i + 1, j)) {
        let wet = false;
        for (let k = 0; k <= 6; k++) if (inRiver(xs[i] + ((xs[i + 1] - xs[i]) * k) / 6, ys[j])) wet = true;
        if (wet) {
          if (ay[j]) {
            h[j * NX + i] = 3;
            bridgeSet.add(ys[j]);
          }
        } else h[j * NX + i] = ay[j] ? 2 : r() < 0.13 ? 0 : 1;
      }
      if (j < NY - 1 && nodeOk(i, j) && nodeOk(i, j + 1)) {
        let wet = false;
        for (let k = 0; k <= 6; k++) {
          const y = ys[j] + ((ys[j + 1] - ys[j]) * k) / 6;
          if (sea(xs[i], y) || Math.abs(xs[i] - river(y)) < RH + 20) wet = true;
        }
        if (!wet) v[j * NX + i] = ax[i] ? 2 : r() < 0.13 ? 0 : 1;
      }
    }
  }

  // 街の中心にいちばん近い交差点から、つながっている交差点をたどる
  const cx = S * 0.42;
  const cy = S * 0.5;
  const ok = new Uint8Array(NX * NY);
  let start = 0;
  let best = Infinity;
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const d = Math.hypot(xs[i] - cx, ys[j] - cy);
    if (d < best && (h[j * NX + i] || v[j * NX + i])) {
      best = d;
      start = j * NX + i;
    }
  }
  const queue = [start];
  ok[start] = 1;
  while (queue.length) {
    const n = queue.pop()!;
    for (const m of neighborsRaw(n, NX, NY, h, v)) if (!ok[m]) {
      ok[m] = 1;
      queue.push(m);
    }
  }

  // 区画と建物
  const blocks: Block[] = [];
  const cell: Record<string, number> = { downtown: 58, commercial: 40, residential: 24, industrial: 74 };
  for (let j = 0; j < NY - 1; j++) {
    for (let i = 0; i < NX - 1; i++) {
      const x0 = xs[i];
      const x1 = xs[i + 1];
      const y0 = ys[j];
      const y1 = ys[j + 1];
      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2;
      let d: District;
      const wetAt = (x: number, y: number) => sea(x - 30, y) || Math.abs(x - river(y)) < RH + 14;
      if (wetAt(x0, y0) || wetAt(x1, y0) || wetAt(x0, y1) || wetAt(x1, y1) || wetAt(mx, my) || wetAt(x0, my) || wetAt(x1, my)) d = 'water';
      else {
        const dist = Math.hypot(mx - cx, my - cy) / S;
        const roll = r();
        if (roll < 0.06 || (Math.abs(mx - S * 0.3) < 260 && Math.abs(my - S * 0.36) < 330)) d = 'park';
        else if (mx - coast(my) < 800 && my > S * 0.52) d = 'industrial';
        else if (mx > river(my) + 1500 && roll > 0.72) d = 'industrial';
        else if (dist < 0.1) d = 'downtown';
        else if (dist < 0.22) d = roll < 0.62 ? 'commercial' : 'residential';
        else d = roll < 0.12 ? 'commercial' : 'residential';
      }
      const rects: number[] = [];
      if (d !== 'water' && d !== 'park') {
        const il = half(ax[i]) + 6;
        const ir = half(ax[i + 1]) + 6;
        const it = half(ay[j]) + 6;
        const ib = half(ay[j + 1]) + 6;
        const w = x1 - x0 - il - ir;
        const hh = y1 - y0 - it - ib;
        const c = cell[d];
        const nx = Math.max(1, Math.round(w / c));
        const ny = Math.max(1, Math.round(hh / c));
        const gap = d === 'residential' ? 3 : 4.5;
        for (let b = 0; b < ny; b++) for (let a = 0; a < nx; a++) {
          if (r() < (d === 'residential' ? 0.12 : 0.06)) continue;
          const bw = w / nx - gap * 2;
          const bh = hh / ny - gap * 2;
          const sw = bw * (1 - r() * 0.22);
          const sh = bh * (1 - r() * 0.22);
          rects.push(x0 + il + (a * w) / nx + gap + (bw - sw) * r(), y0 + it + (b * hh) / ny + gap + (bh - sh) * r(), sw, sh);
        }
      }
      blocks.push({ i, j, x0, y0, x1, y1, d, b: new Float32Array(rects) });
    }
  }

  // 場所を置く：区画の下側の道に面した歩道の上
  const cand = blocks.filter((b) => b.d !== 'water' && b.d !== 'park' && b.j + 1 < NY && (h[(b.j + 1) * NX + b.i] === 1 || h[(b.j + 1) * NX + b.i] === 2) && ok[(b.j + 1) * NX + b.i] && ok[(b.j + 1) * NX + b.i + 1]);
  for (let k = cand.length - 1; k > 0; k--) {
    const q = Math.floor(r() * (k + 1));
    [cand[k], cand[q]] = [cand[q], cand[k]];
  }
  const used = new Set<Block>();
  const pois: Poi[] = [];
  const centerDist = (b: Block) => Math.hypot((b.x0 + b.x1) / 2 - cx, (b.y0 + b.y1) / 2 - cy);
  const take = (kind: PoiKind, count: number, pred: (b: Block) => boolean, spacing: number) => {
    let got = 0;
    for (const b of cand) {
      if (got >= count) break;
      if (used.has(b) || !pred(b)) continue;
      const x = (b.x0 + b.x1) / 2;
      const y = b.y1 - half(ay[b.j + 1]) - 3;
      if (pois.some((p) => p.kind === kind && Math.hypot(p.x - x, p.y - y) < spacing)) continue;
      used.add(b);
      pois.push({ id: pois.length, kind, x, y, district: b.d, traffic: TRAFFIC[b.d] });
      got++;
    }
  };
  const res = (b: Block) => b.d === 'residential';
  const com = (b: Block) => b.d === 'commercial' || b.d === 'downtown';
  take('home', 1, (b) => res(b) && centerDist(b) > 700 && centerDist(b) < 1700, 0);
  if (!pois.length) take('home', 1, () => true, 0);
  const home = pois[0];
  const nearHome = (b: Block, d: number) => Math.hypot((b.x0 + b.x1) / 2 - home.x, (b.y0 + b.y1) / 2 - home.y) < d;
  take('conbini', 1, (b) => nearHome(b, 600), 0);
  take('conbini', 4, (b) => com(b) || res(b), 1400);
  take('tool', 1, (b) => nearHome(b, 900), 0);
  take('bike', 1, (b) => nearHome(b, 1100), 0);
  take('warehouse', 2, (b) => b.d === 'industrial', 1200);
  take('bike', 2, com, 1500);
  take('car', 2, (b) => b.d === 'commercial' || b.d === 'industrial', 2000);
  take('tool', 3, (b) => com(b) || b.d === 'industrial', 1500);
  take('pawn', 3, (b) => b.d === 'commercial' || res(b), 1800);
  take('chop', 2, (b) => b.d === 'industrial', 2000);
  take('bank', 4, com, 900);
  take('police', 3, (b) => com(b) || res(b), 2200);
  take('atm', 9, (b) => com(b) || res(b), 700);
  take('lot', 14, (b) => b.d !== 'industrial' || centerDist(b) < 3000, 650);
  take('house', 70, res, 240);
  for (let t = 0; t < 6; t++) take('gang', 1, (b) => turfOf(S, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2) === t && centerDist(b) > 900 && !nearHome(b, 700), 0);
  take('hideout', 6, (b) => res(b) || b.d === 'industrial', 1500);
  take('jewel', 3, com, 1500); // 後から足した場所は、番号がずれないように最後に置く
  take('market', 1, (b) => nearHome(b, 1300), 0);
  take('market', 4, (b) => com(b) || res(b), 1700);
  take('office', 3, com, 2200);
  take('apart', 8, res, 800);

  return { seed, size: S, xs, ys, ax, ay, h, v, ok, blocks, pois, home, bridges: [...bridgeSet], half, coast, river };
}

function neighborsRaw(n: number, NX: number, NY: number, h: Uint8Array, v: Uint8Array): number[] {
  const i = n % NX;
  const j = Math.floor(n / NX);
  const out: number[] = [];
  if (i < NX - 1 && h[n]) out.push(n + 1);
  if (i > 0 && h[n - 1]) out.push(n - 1);
  if (j < NY - 1 && v[n]) out.push(n + NX);
  if (j > 0 && v[n - NX]) out.push(n - NX);
  return out;
}
export const neighbors = (c: City, n: number) => neighborsRaw(n, c.xs.length, c.ys.length, c.h, c.v);
export const nodeXY = (c: City, n: number): [number, number] => [c.xs[n % c.xs.length], c.ys[Math.floor(n / c.xs.length)]];
// 2つの交差点の間の道が大通り（または橋）か
export function edgeArterial(c: City, a: number, b: number): boolean {
  const lo = Math.min(a, b);
  return Math.abs(a - b) === 1 ? c.h[lo] >= 2 : c.v[lo] >= 2;
}

// arr の中で、値 val 以下の最後の位置（なければ -1）
export function seg(arr: number[], val: number): number {
  let lo = 0;
  let hi = arr.length - 1;
  if (val < arr[0]) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (arr[mid] <= val) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// 水の上か（橋の上は水ではない）
export function wet(c: City, x: number, y: number): boolean {
  if (x < c.coast(y)) return true;
  if (Math.abs(x - c.river(y)) < 75) {
    for (const by of c.bridges) if (Math.abs(y - by) <= 14) return false;
    return true;
  }
  return false;
}

// 通れない所か（街の外・水・建物）。r は自分の半径
export function solid(c: City, x: number, y: number, r: number): boolean {
  if (x < r || y < r || x > c.size - r || y > c.size - r) return true;
  if (wet(c, x, y)) return true;
  const i = seg(c.xs, x);
  const j = seg(c.ys, y);
  if (i < 0 || j < 0 || i >= c.xs.length - 1 || j >= c.ys.length - 1) return false;
  const b = c.blocks[j * (c.xs.length - 1) + i].b;
  for (let k = 0; k < b.length; k += 4) {
    if (x + r > b[k] && x - r < b[k] + b[k + 2] && y + r > b[k + 1] && y - r < b[k + 1] + b[k + 3]) return true;
  }
  return false;
}

// 道の上か（0 道でない／1 細い道／2 大通り／3 橋）
export function roadAt(c: City, x: number, y: number): number {
  const NX = c.xs.length;
  const i = seg(c.xs, x);
  const j = seg(c.ys, y);
  let best = 0;
  for (const ii of [i, i + 1]) {
    if (ii < 0 || ii >= NX || j < 0 || j >= c.ys.length - 1) continue;
    const t = c.v[j * NX + ii];
    if (t && Math.abs(x - c.xs[ii]) <= c.half(c.ax[ii]) + 1) best = Math.max(best, t);
  }
  for (const jj of [j, j + 1]) {
    if (jj < 0 || jj >= c.ys.length || i < 0 || i >= NX - 1) continue;
    const t = c.h[jj * NX + i];
    if (t && Math.abs(y - c.ys[jj]) <= c.half(c.ay[jj]) + 1) best = Math.max(best, t);
  }
  return best;
}

// いちばん近い、主な道につながった交差点
export function nearestNode(c: City, x: number, y: number): number {
  const NX = c.xs.length;
  const NY = c.ys.length;
  const i0 = Math.max(0, seg(c.xs, x));
  const j0 = Math.max(0, seg(c.ys, y));
  let best = -1;
  let bd = Infinity;
  for (let rad = 1; rad <= 8 && best < 0; rad += 2) {
    for (let j = Math.max(0, j0 - rad); j <= Math.min(NY - 1, j0 + rad + 1); j++) for (let i = Math.max(0, i0 - rad); i <= Math.min(NX - 1, i0 + rad + 1); i++) {
      const n = j * NX + i;
      if (!c.ok[n]) continue;
      const d = Math.hypot(c.xs[i] - x, c.ys[j] - y);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
  }
  return best < 0 ? 0 : best;
}

// 道をたどる道のり（交差点の番号の列）。幅優先で探す
export function findPath(c: City, from: number, to: number): number[] {
  if (from === to) return [from];
  const prev = new Int32Array(c.ok.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  for (let q = 0; q < queue.length; q++) {
    const n = queue[q];
    if (n === to) break;
    for (const m of neighbors(c, n)) if (prev[m] < 0) {
      prev[m] = n;
      queue.push(m);
    }
  }
  if (prev[to] < 0) return [from];
  const path = [to];
  while (path[path.length - 1] !== from) path.push(prev[path[path.length - 1]]);
  return path.reverse();
}
