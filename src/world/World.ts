// 街の絵（PixiJS）。画像は使わず、すべてコードで描く。
// ルール本体の写しを読んで描くだけで、状態は持たない。文字は描かない（文字は HTML 側）。タッチも受け取らない。
//
// 色と光の計画（docs/QUALITY_BAR.md）：
//  ・色の主役は空。時刻で空の色が変わり、街には空の色を掛ける（昼＝白、夕方＝だいだい、夜＝青）。
//  ・主な光は太陽。影は時刻で向きと長さが変わる（朝夕は長い）。壁の明るさも朝と夕方で左右が入れ替わる。
//  ・光らせるのは、本当に明るい物だけ（太陽・月・窓・街灯）。
//  ・行ってほしい所（自分の行き先）だけ、足元に暖かい輪を出す。
import 'pixi.js/unsafe-eval'; // 実行時にコードを組み立てない版（制限の強い場所でも絵が出るように）
import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { Slot } from '../core/types';

export const WORLD_W = 390;
export const WORLD_H = 306;
const TW = 22;
const TH = 11;
const OX = 195;
const OY = 88;

type P2 = [number, number];
const iso = (gx: number, gy: number, z = 0): P2 => [OX + (gx - gy) * TW, OY + (gx + gy) * TH - z];

// ---- 色の道具
const rgb = (c: number): [number, number, number] => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const hex = (r: number, g: number, b: number) => (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
const mix = (a: number, b: number, t: number) => {
  const A = rgb(a);
  const B = rgb(b);
  return hex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
};
const dark = (c: number, t: number) => mix(c, 0x1b2233, t);
const light = (c: number, t: number) => mix(c, 0xffffff, t);
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- 空と光：時刻ごとの色（時刻, 空の上, 空の下, 街に掛ける色, 夜の度合い）
const SKY: [number, number, number, number, number][] = [
  [0, 0x0c1433, 0x283463, 0x7381c8, 1],
  [4.6, 0x141d47, 0x4a4a80, 0x7c86c6, 1],
  [6, 0x5f7fc8, 0xffc4a0, 0xffd9c6, 0.35],
  [7.5, 0x62aaf0, 0xdff0ff, 0xfff3e6, 0],
  [12, 0x3e93ea, 0xcbe9ff, 0xffffff, 0],
  [16, 0x4a96e2, 0xdcedfb, 0xfff6ea, 0],
  [18, 0x5a6cc0, 0xffb07a, 0xffc7a2, 0.3],
  [19.3, 0x2c2f6c, 0xd0688a, 0xb89ad0, 0.8],
  [21, 0x10183c, 0x2f3868, 0x7582ca, 1],
  [24, 0x0c1433, 0x283463, 0x7381c8, 1],
];
function skyAt(hour: number) {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < SKY.length - 2 && SKY[i + 1][0] <= h) i++;
  const a = SKY[i];
  const b = SKY[i + 1];
  const t = (h - a[0]) / (b[0] - a[0]);
  return { top: mix(a[1], b[1], t), bot: mix(a[2], b[2], t), tint: mix(a[3], b[3], t), night: a[4] + (b[4] - a[4]) * t, h };
}

// ---- 場所
export type PlaceKey = 'home' | 'job' | 'mats' | 'market' | 'c1' | 'c2' | 'tool' | 'c3';
interface Lot { x: number; y: number; w: number; d: number; h: number; top: number; door: P2; via: 'v' | 'h'; label: string; color: number }
const LOTS: Record<PlaceKey, Lot> = {
  home: { x: 1.2, y: 0.5, w: 1.5, d: 1.4, h: 17, top: 31, door: [2.95, 1.2], via: 'v', label: '自宅', color: 0x1d7a63 },
  tool: { x: 0.7, y: 2.55, w: 1.9, d: 1.15, h: 15, top: 26, door: [1.6, 3.9], via: 'h', label: '道具の店', color: 0x9a6b3f },
  job: { x: 4.35, y: 2.35, w: 1.75, d: 1.3, h: 16, top: 22, door: [5.2, 3.9], via: 'h', label: 'アルバイト先', color: 0x5b6b7a },
  c2: { x: 6.5, y: 0.4, w: 1.2, d: 1.25, h: 40, top: 49, door: [7.1, 1.95], via: 'v', label: '客先', color: 0x2f7fc1 },
  mats: { x: 6.3, y: 2.45, w: 1.5, d: 1.2, h: 16, top: 26, door: [7.05, 3.9], via: 'h', label: '材料の店', color: 0x8a8f3a },
  market: { x: 0.4, y: 6.75, w: 2.2, d: 1.0, h: 15, top: 21, door: [2.85, 7.25], via: 'v', label: '売り場', color: 0xc2507a },
  c1: { x: 0.6, y: 5.35, w: 1.4, d: 0.95, h: 13, top: 25, door: [2.3, 5.85], via: 'v', label: '客先', color: 0x2f7fc1 },
  c3: { x: 4.5, y: 5.5, w: 1.5, d: 1.2, h: 24, top: 28, door: [5.25, 6.92], via: 'v', label: '客先', color: 0x2f7fc1 },
};
// 名前の札を置く位置（HTML 側で使う）
export const PLACES = Object.fromEntries(
  (Object.keys(LOTS) as PlaceKey[]).map((k) => {
    const l = LOTS[k];
    const p = iso(l.x + l.w / 2, l.y + l.d / 2, l.top);
    return [k, { x: p[0], y: p[1], label: l.label, color: l.color }];
  }),
) as Record<PlaceKey, { x: number; y: number; label: string; color: number }>;

export interface WorldView {
  slots: Slot[]; // 今日の時間割
  day: number;
  mode: 'title' | 'play';
  fast: boolean; // まとめて進めている最中
  calm: boolean; // 動きを少なくする
}

const SLOT_COLOR: Record<Slot, number> = { rest: 0xffffff, job: 0x5b6b7a, craft: 0xd9822b, handy: 0x2f7fc1, dev: 0x7b5cc9, sell: 0xc2507a, shop: 0x8a8f3a };
function placeOf(slot: Slot, i: number): PlaceKey {
  if (slot === 'job') return 'job';
  if (slot === 'handy') return (['c1', 'c3', 'c2'] as PlaceKey[])[i % 3];
  if (slot === 'sell') return 'market';
  if (slot === 'shop') return 'mats';
  return 'home';
}

// 道を通る道のり（歩道の線に沿う）
function access(l: Lot): P2 {
  return l.via === 'v' ? [l.door[0] < 3.5 ? 3.06 : 3.94, l.door[1]] : [l.door[0], l.door[1] < 4.5 ? 4.06 : 4.94];
}
function route(from: PlaceKey, to: PlaceKey): P2[] {
  const A = LOTS[from];
  const B = LOTS[to];
  const a = access(A);
  const b = access(B);
  const mid: P2[] = [];
  if (A.via === 'v' && B.via === 'v') {
    if (a[0] !== b[0]) {
      const cy = a[1] < 4 && b[1] < 4 ? 4.06 : a[1] > 5 && b[1] > 5 ? 4.94 : a[1] < 4.5 ? 4.06 : 4.94;
      mid.push([a[0], cy], [b[0], cy]);
    }
  } else if (A.via === 'h' && B.via === 'h') {
    if (a[1] !== b[1]) {
      const cx = a[0] < 3 && b[0] < 3 ? 3.06 : a[0] > 4 && b[0] > 4 ? 3.94 : a[0] < 3.5 ? 3.06 : 3.94;
      mid.push([cx, a[1]], [cx, b[1]]);
    }
  } else if (A.via === 'v') mid.push([a[0], b[1]]);
  else mid.push([b[0], a[1]]);
  return [A.door, a, ...mid, b, B.door];
}
function along(path: P2[], t: number): P2 {
  let total = 0;
  const seg: number[] = [];
  for (let i = 1; i < path.length; i++) {
    const d = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    seg.push(d);
    total += d;
  }
  let want = Math.min(1, Math.max(0, t)) * total;
  for (let i = 0; i < seg.length; i++) {
    if (want <= seg[i] || i === seg.length - 1) {
      const k = seg[i] > 0 ? Math.min(1, want / seg[i]) : 1;
      return [path[i][0] + (path[i + 1][0] - path[i][0]) * k, path[i][1] + (path[i + 1][1] - path[i][1]) * k];
    }
    want -= seg[i];
  }
  return path[path.length - 1];
}

function hull(pts: P2[]): number[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: P2[] = [];
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  const up: P2[] = [];
  for (const q of [...p].reverse()) {
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
    up.push(q);
  }
  return [...lo.slice(0, -1), ...up.slice(0, -1)].flat();
}

// ---- 建物を組み立てる道具
class Build {
  box = new Container();
  base = new Graphics();
  sL = new Graphics(); // 左の壁に掛ける陰（時刻で濃さが変わる）
  sR = new Graphics(); // 右の壁に掛ける陰
  litA = new Graphics(); // 早くともる窓
  litB = new Graphics(); // 遅くともる窓
  casts: { x: number; y: number; w: number; d: number; h: number }[] = [];
  constructor(public x: number, public y: number, public w: number, public d: number) {
    this.box.addChild(this.base, this.sL, this.sR, this.litA, this.litB);
  }
  quad(g: Graphics, pts: P2[], color: number, alpha = 1) {
    g.poly(pts.flat()).fill({ color, alpha });
  }
  // 箱（上・左の壁・右の壁）
  block(x: number, y: number, w: number, d: number, z0: number, h: number, wall: number, top: number, cast = true) {
    const z1 = z0 + h;
    const l: P2[] = [iso(x, y + d, z1), iso(x + w, y + d, z1), iso(x + w, y + d, z0), iso(x, y + d, z0)];
    const r: P2[] = [iso(x + w, y + d, z1), iso(x + w, y, z1), iso(x + w, y, z0), iso(x + w, y + d, z0)];
    this.quad(this.base, l, wall);
    this.quad(this.base, r, wall);
    this.quad(this.base, [iso(x, y, z1), iso(x + w, y, z1), iso(x + w, y + d, z1), iso(x, y + d, z1)], top);
    this.quad(this.sL, l, 0x1b2233);
    this.quad(this.sR, r, 0x1b2233);
    if (cast) this.casts.push({ x, y, w, d, h: z1 });
  }
  // 壁の上の位置。u は壁に沿った位置（0〜1）、z は高さ
  pl(u: number, z: number): P2 {
    return iso(this.x + this.w * u, this.y + this.d, z);
  }
  pr(u: number, z: number): P2 {
    return iso(this.x + this.w, this.y + this.d * (1 - u), z);
  }
  rect(side: 'L' | 'R', u0: number, u1: number, z0: number, z1: number): P2[] {
    const f = side === 'L' ? this.pl.bind(this) : this.pr.bind(this);
    return [f(u0, z1), f(u1, z1), f(u1, z0), f(u0, z0)];
  }
  paint(side: 'L' | 'R', u0: number, u1: number, z0: number, z1: number, color: number, alpha = 1) {
    this.quad(this.base, this.rect(side, u0, u1, z0, z1), color, alpha);
  }
  // 窓：昼はガラス、夜はともる
  win(side: 'L' | 'R', u0: number, u1: number, z0: number, z1: number, late = false, warm = 0xffd98a) {
    const q = this.rect(side, u0, u1, z0, z1);
    this.quad(this.base, q, 0x7fa6c4);
    this.quad(this.base, this.rect(side, u0, u0 + (u1 - u0) * 0.42, z0 + (z1 - z0) * 0.5, z1), 0xbfdcee, 0.9);
    this.quad(late ? this.litB : this.litA, q, warm);
  }
}

interface Actor { g: Container; gx: number; gy: number }
interface Car extends Actor { axis: 'v' | 'h'; dir: number; pos: number; speed: number; lamp: Sprite }
interface Walker extends Actor { axis: 'v' | 'h'; line: number; pos: number; speed: number; phase: number }
interface Bit { g: Graphics; x: number; y: number; vx: number; vy: number; life: number; max: number; grav: number }

export class World {
  private app = new Application();
  private root = new Container();
  private sky = new Graphics();
  private skyTop!: Sprite;
  private stars = new Graphics();
  private sun = new Container();
  private moon = new Container();
  private far = new Graphics();
  private clouds: { g: Graphics; x: number; y: number; v: number }[] = [];
  private birds: { g: Graphics; x: number; y: number; v: number; ph: number }[] = [];
  private ground = new Graphics();
  private pond = new Container();
  private glints: Graphics[] = [];
  private shadows = new Graphics();
  private pools = new Container(); // 街灯が地面に落とす光
  private trail = new Graphics(); // 今日の道のり
  private ring = new Graphics(); // 行き先の輪
  private town = new Container();
  private glows = new Container(); // 光る物（足し算で重ねる）
  private fx = new Container();
  private builds: Build[] = [];
  private tinted: { o: Container; k: number }[] = [];
  private trees: { g: Graphics; ph: number; sp: number; gx: number; gy: number; r: number }[] = [];
  private lamps: { glow: Sprite; pool: Sprite }[] = [];
  private cars: Car[] = [];
  private walkers: Walker[] = [];
  private smoke: Bit[] = [];
  private bits: Bit[] = [];
  private me = new Container();
  private meBody = new Graphics();
  private mark = new Graphics();
  private glowTex!: Texture;
  private view: WorldView = { slots: [], day: 0, mode: 'play', fast: false, calm: false };
  private seq: { place: PlaceKey; from: number; to: number; slot: Slot }[] = [{ place: 'home', from: 0, to: 16, slot: 'rest' }];
  private seqKey = '';
  private hour = 7.5;
  private drawnHour = -9;
  private shadowHour = -9;
  private time = 0;
  private replay: { t0: number; dur: number; back: number } | null = null;
  private at: PlaceKey = 'home';
  private path: P2[] | null = null;
  private moveT = 1;
  private moveDur = 0.3;
  private pos: P2 = [...LOTS.home.door];
  private facing = 1;
  private fastT = 0;
  private fastI = 0;
  private dead = false;
  private frames = 0;
  private slow = 0;
  private res = 2;
  private fixedHour: number | null = null; // 確かめ用：?hour=19 で時刻を止める
  ok = false;

  async init(el: HTMLElement): Promise<boolean> {
    try {
      // 確かめ用：?res=1 で細かさ、?aa=0 でなめらかさを切り替えられる
      const q = new URLSearchParams(window.location.search);
      this.res = Number(q.get('res')) || Math.min(window.devicePixelRatio || 1, 2);
      if (q.get('hour')) this.fixedHour = Number(q.get('hour'));
      await this.app.init({
        resizeTo: el, backgroundAlpha: 0, antialias: q.get('aa') !== '0', autoDensity: true,
        resolution: this.res, preference: 'webgl',
      });
    } catch {
      return false; // 描けない環境では、絵なしで遊べるようにする
    }
    if (this.dead) {
      this.app.destroy(true);
      return false;
    }
    const canvas = this.app.canvas;
    canvas.style.pointerEvents = 'none';
    canvas.style.display = 'block';
    el.appendChild(canvas);
    this.glowTex = this.makeGlow();
    this.sky.rect(-40, -600, WORLD_W + 80, 1000).fill(0xffffff);
    this.skyTop = new Sprite(this.makeFade());
    this.skyTop.position.set(-40, -600);
    this.skyTop.width = WORLD_W + 80;
    this.skyTop.height = 840;
    this.town.sortableChildren = true;
    this.pools.blendMode = 'add';
    this.root.addChild(this.sky, this.skyTop, this.stars, this.sun, this.moon, this.far);
    this.makeSkyThings();
    const onGround = new Container();
    const cut = new Graphics().poly([...iso(0, 0), ...iso(8, 0), ...iso(8, 8), ...iso(0, 8)]).fill(0xffffff);
    onGround.addChild(this.shadows, this.pools, cut);
    onGround.mask = cut;
    this.root.addChild(this.ground, this.pond, onGround, this.trail, this.ring, this.town, this.glows, this.fx);
    this.app.stage.addChild(this.root);
    this.drawGround();
    this.makeBuildings();
    this.makeTrees();
    this.makeLamps();
    this.makeActors();
    this.tinted.push({ o: this.ground, k: 1 }, { o: this.pond, k: 1 }, { o: this.far, k: 0.6 });
    this.app.ticker.add((tk) => {
      this.adapt(tk.deltaMS);
      this.tick(Math.min(0.05, tk.deltaMS / 1000));
    });
    this.ok = true;
    this.tick(0);
    return true;
  }

  setView(v: WorldView) {
    this.view = v;
    const key = `${v.day}|${v.slots.join(',')}`;
    if (key !== this.seqKey) {
      this.seqKey = key;
      const seq: typeof this.seq = [];
      let run = 0;
      v.slots.forEach((s, i) => {
        const prev = v.slots[i - 1];
        if (i > 0 && prev !== s && (s === 'handy' || prev === 'handy')) run++;
        const place = placeOf(s, run + v.day);
        const last = seq[seq.length - 1];
        if (last && last.place === place) last.to = i + 1;
        else seq.push({ place, from: i, to: i + 1, slot: s });
      });
      this.seq = seq.length ? seq : [{ place: 'home', from: 0, to: 16, slot: 'rest' }];
      this.drawTrail();
    }
  }

  // 1日が過ぎた合図：朝から夜までを通して見せる
  playDay() {
    if (!this.ok || this.view.calm || this.view.fast) return;
    this.replay = { t0: performance.now(), dur: 1.25, back: 0.55 };
    this.hour = 6;
  }

  // お金が入った合図：その場所から硬貨が跳ねる
  burst(place: PlaceKey, big = false) {
    if (!this.ok || this.view.calm) return;
    const l = LOTS[place];
    const p = iso(l.x + l.w / 2, l.y + l.d / 2, l.top - 4);
    const n = big ? 16 : 9;
    for (let i = 0; i < n; i++) {
      const g = new Graphics().ellipse(0, 0, 3.2, 3.2).fill(0xf2b632).ellipse(-0.6, -0.8, 1.5, 1.5).fill(0xffe9a3);
      const a = -Math.PI / 2 + (i / (n - 1) - 0.5) * 1.9;
      const sp = 70 + ((i * 37) % 50);
      this.fx.addChild(g);
      this.bits.push({ g, x: p[0], y: p[1], vx: Math.cos(a) * sp * 0.6, vy: Math.sin(a) * sp, life: 0, max: 0.75 + (i % 3) * 0.08, grav: 260 });
    }
  }

  destroy() {
    this.dead = true;
    if (this.ok) this.app.destroy(true, { children: true });
  }

  // ---- 作る
  private makeGlow(): Texture {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d')!;
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
    return Texture.from(c);
  }
  // 上が濃く、下へ行くほど透ける板（空の上の色を掛けて使う）
  private makeFade(): Texture {
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 256;
    const x = c.getContext('2d')!;
    const g = x.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.7, 'rgba(255,255,255,1)');
    g.addColorStop(0.86, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 4, 256);
    return Texture.from(c);
  }
  private glow(x: number, y: number, size: number, color: number, parent: Container = this.glows): Sprite {
    const s = new Sprite(this.glowTex);
    s.anchor.set(0.5);
    s.position.set(x, y);
    s.scale.set(size / 64);
    s.tint = color;
    s.blendMode = 'add';
    parent.addChild(s);
    return s;
  }

  private makeSkyThings() {
    const r = rng(7);
    const heights = [92, 118, 144, 20, -70, -150]; // 上の3つは、空が広い画面（最初の画面）でだけ見える
    for (let i = 0; i < 6; i++) {
      const g = new Graphics();
      const w = 34 + r() * 26;
      g.ellipse(0, 0, w, 7).ellipse(-w * 0.35, -5, w * 0.42, 8).ellipse(w * 0.2, -7, w * 0.5, 10).ellipse(w * 0.55, -2, w * 0.3, 6).fill({ color: 0xffffff, alpha: 0.92 });
      this.clouds.push({ g, x: r() * 420, y: heights[i] + r() * 10, v: 3 + r() * 4 });
      this.root.addChild(g);
    }
    for (let i = 0; i < 2; i++) {
      const g = new Graphics().moveTo(-4, -1.5).lineTo(0, 1).lineTo(4, -1.5).stroke({ width: 1.3, color: 0x3a4660, alpha: 0.7, cap: 'round', join: 'round' });
      this.birds.push({ g, x: -60 - i * 140, y: 78 + i * 22, v: 16 + i * 5, ph: i * 2 });
      this.root.addChild(g);
    }
    // 遠くの街並み（空の色に寄せて、遠くに見せる）
    const f = this.far;
    let x = -10;
    while (x < WORLD_W + 10) {
      const w = 10 + r() * 16;
      const h = 8 + r() * 26;
      f.rect(x, 176 - h, w, h + 40).fill(0xffffff);
      if (r() > 0.6) f.rect(x + w * 0.3, 176 - h - 5, w * 0.25, 6).fill(0xffffff);
      x += w + r() * 5;
    }
    f.alpha = 0.5;
    const sunCore = new Graphics().circle(0, 0, 8).fill(0xfff6d6);
    this.sun.addChild(sunCore);
    this.glow(0, 0, 72, 0xffe2a0, this.sun).alpha = 0.85;
    const m = new Graphics().circle(0, 0, 7).fill(0xf3f1e4).circle(2.5, -1.5, 5.5).fill({ color: 0xd9dbe6, alpha: 0.35 });
    this.moon.addChild(m);
    this.glow(0, 0, 60, 0xaab8ff, this.moon);
  }

  private tile(g: Graphics, x: number, y: number, w: number, d: number, color: number, alpha = 1, z = 0) {
    g.poly([...iso(x, y, z), ...iso(x + w, y, z), ...iso(x + w, y + d, z), ...iso(x, y + d, z)]).fill({ color, alpha });
  }

  private drawGround() {
    const g = this.ground;
    // 島の影と、土の側面
    g.ellipse(OX, OY + 16 * TH + 26, 168, 12).fill({ color: 0x1b2233, alpha: 0.16 });
    const T = 18;
    const L = iso(0, 8);
    const B = iso(8, 8);
    const R = iso(8, 0);
    g.poly([L[0], L[1], B[0], B[1], B[0], B[1] + T, L[0], L[1] + T]).fill(0xb98b5e);
    g.poly([B[0], B[1], R[0], R[1], R[0], R[1] + T, B[0], B[1] + T]).fill(0x9c7148);
    g.poly([L[0], L[1] + 8, B[0], B[1] + 8, B[0], B[1] + T, L[0], L[1] + T]).fill(0xa67a50);
    g.poly([B[0], B[1] + 8, R[0], R[1] + 8, R[0], R[1] + T, B[0], B[1] + T]).fill(0x86603c);
    g.poly([L[0], L[1], B[0], B[1], B[0], B[1] + 3.5, L[0], L[1] + 3.5]).fill(0x8cc276);
    g.poly([B[0], B[1], R[0], R[1], R[0], R[1] + 3.5, B[0], B[1] + 3.5]).fill(0x74ad62);
    // 区画ごとの地面（草・敷石）。1マスごとに少しだけ色を変える
    const blocks: [number, number, number, number, number][] = [
      [0, 0, 3, 4, 0xcfe6b8], [4, 0, 4, 4, 0xece5d3], [0, 5, 3, 3, 0xf0e6cf], [4, 5, 4, 3, 0xc3e2ab],
    ];
    for (const [bx, by, bw, bd, c] of blocks) {
      for (let i = 0; i < bw; i++) for (let j = 0; j < bd; j++) this.tile(g, bx + i, by + j, 1, 1, (i + j) % 2 ? c : dark(c, 0.035));
    }
    // 道（歩道のふち・車道・線・横断歩道）
    const road = 0x9ba3b0;
    const curb = 0xdcd7c9;
    this.tile(g, 3, 0, 1, 8, curb);
    this.tile(g, 0, 4, 8, 1, curb);
    this.tile(g, 3.13, 0, 0.74, 8, road);
    this.tile(g, 0, 4.13, 8, 0.74, road);
    for (let y = 0.2; y < 8; y += 0.62) if (y < 3.85 || y > 5.1) this.tile(g, 3.48, y, 0.04, 0.3, 0xf4f1e8, 0.9);
    for (let x = 0.2; x < 8; x += 0.62) if (x < 2.85 || x > 4.1) this.tile(g, x, 4.48, 0.3, 0.04, 0xf4f1e8, 0.9);
    for (let k = 0; k < 4; k++) {
      this.tile(g, 3.17 + k * 0.18, 3.78, 0.1, 0.24, 0xf4f1e8);
      this.tile(g, 3.17 + k * 0.18, 4.98, 0.1, 0.24, 0xf4f1e8);
      this.tile(g, 2.78, 4.17 + k * 0.18, 0.24, 0.1, 0xf4f1e8);
      this.tile(g, 3.98, 4.17 + k * 0.18, 0.24, 0.1, 0xf4f1e8);
    }
    // 家の前の小道、売り場の敷物、花
    this.tile(g, 2.7, 1.05, 0.3, 0.3, 0xe6dcc3);
    this.tile(g, 0.3, 6.65, 2.4, 1.2, 0xe2d3b3);
    for (let k = 0; k < 3; k++) this.tile(g, 4.5 + k * 0.42, 0.75, 0.03, 0.6, 0xf4f1e8, 0.9);
    const r = rng(21);
    const flowers = [0xf28aa5, 0xffd35c, 0xffffff, 0xf2a25c];
    for (let i = 0; i < 26; i++) {
      const inPark = i % 3 !== 0;
      const fx = inPark ? 4.2 + r() * 3.6 : 0.2 + r() * 0.9;
      const fy = inPark ? 6.9 + r() * 1.0 : 0.2 + r() * 3.4;
      const p = iso(fx, fy);
      g.circle(p[0], p[1], 1.1).fill(flowers[i % 4]);
    }
    // 池（ふち・水・深い所）。きらめきの線は別に置いて動かす
    const ring = (rx: number, ry: number, cx = 7.0, cy = 6.35) => {
      const pts: number[] = [];
      for (let a = 0; a < 28; a++) pts.push(...iso(cx + Math.cos((a / 28) * 6.283) * rx, cy + Math.sin((a / 28) * 6.283) * ry));
      return pts;
    };
    g.poly(ring(0.86, 0.72)).fill(0xe9dfbd);
    g.poly(ring(0.74, 0.6)).fill(0x69c0e8);
    g.poly(ring(0.42, 0.34, 7.05, 6.4)).fill(0x4aa8dc);
    for (let i = 0; i < 4; i++) {
      const line = new Graphics().moveTo(-6, 0).lineTo(6, 0).stroke({ width: 1, color: 0xffffff, cap: 'round' });
      this.glints.push(line);
      this.pond.addChild(line);
    }
    // 建物の足元の暗がり（置かれている感じを出す）
    for (const k of Object.keys(LOTS) as PlaceKey[]) {
      const l = LOTS[k];
      this.tile(g, l.x - 0.07, l.y - 0.07, l.w + 0.14, l.d + 0.14, 0x1b2233, 0.16);
    }
  }

  private add(b: Build, key?: PlaceKey) {
    b.box.zIndex = (b.x + b.w + b.y + b.d) * 10;
    this.town.addChild(b.box);
    this.builds.push(b);
    this.tinted.push({ o: b.base, k: 1 });
    void key;
  }

  private makeBuildings() {
    // 自宅：切妻屋根の家。煙突から煙
    {
      const l = LOTS.home;
      const b = new Build(l.x, l.y, l.w, l.d);
      b.block(l.x, l.y, l.w, l.d, 0, l.h, 0xfff3df, 0xfff3df);
      b.paint('L', 0, 1, 0, 2.5, 0xd9c7a8);
      b.paint('R', 0, 1, 0, 2.5, 0xd9c7a8);
      b.win('L', 0.14, 0.4, 6, 12);
      b.win('L', 0.6, 0.86, 6, 12, true);
      b.paint('R', 0.36, 0.6, 0, 11, 0x8a5a3c);
      b.paint('R', 0.52, 0.56, 5, 6, 0xf2c66a);
      b.win('R', 0.72, 0.9, 6, 12);
      const o = 0.14;
      const r = 12;
      const gable: P2[] = [iso(l.x + l.w, l.y, l.h), iso(l.x + l.w, l.y + l.d, l.h), iso(l.x + l.w, l.y + l.d / 2, l.h + r)];
      b.quad(b.base, gable, 0xfff3df);
      b.quad(b.sR, gable, 0x1b2233);
      b.quad(b.base, [iso(l.x - o, l.y - o, l.h - 1), iso(l.x + l.w + o, l.y - o, l.h - 1), iso(l.x + l.w + o, l.y + l.d / 2, l.h + r), iso(l.x - o, l.y + l.d / 2, l.h + r)], 0x18634f);
      const front: P2[] = [iso(l.x - o, l.y + l.d / 2, l.h + r), iso(l.x + l.w + o, l.y + l.d / 2, l.h + r), iso(l.x + l.w + o, l.y + l.d + o, l.h - 1.5), iso(l.x - o, l.y + l.d + o, l.h - 1.5)];
      b.quad(b.base, front, 0x26896f);
      b.quad(b.sL, front, 0x1b2233);
      for (let i = 1; i < 4; i++) {
        const t = i / 4;
        const p0 = iso(l.x - o, l.y + l.d / 2 + (l.d / 2 + o) * t, l.h + r - (r + 1.5) * t);
        const p1 = iso(l.x + l.w + o, l.y + l.d / 2 + (l.d / 2 + o) * t, l.h + r - (r + 1.5) * t);
        b.base.moveTo(p0[0], p0[1]).lineTo(p1[0], p1[1]).stroke({ width: 0.7, color: 0x18634f, alpha: 0.55 });
      }
      b.block(l.x + 0.25, l.y + 0.2, 0.22, 0.22, l.h + 4, 12, 0xc98a6a, 0xa8694c, false);
      this.add(b, 'home');
      // 垣根
      const hedge = new Build(0.25, 2.05, 2.4, 0.16);
      hedge.block(0.25, 2.05, 2.4, 0.16, 0, 4.5, 0x6fae62, 0x8cc77a, false);
      this.add(hedge);
    }
    // 道具の店：屋根の上に看板
    {
      const l = LOTS.tool;
      const b = new Build(l.x, l.y, l.w, l.d);
      b.block(l.x, l.y, l.w, l.d, 0, l.h, 0xf1dfc4, 0xd8c3a2);
      b.paint('L', 0, 1, l.h - 3.5, l.h, 0x9a6b3f);
      b.paint('R', 0, 1, l.h - 3.5, l.h, 0x9a6b3f);
      b.paint('L', 0.1, 0.52, 0, 10, 0xb9c2c9);
      for (let i = 1; i < 5; i++) b.paint('L', 0.1, 0.52, i * 2, i * 2 + 0.5, 0x8f9aa3);
      b.win('L', 0.62, 0.9, 3, 10, false, 0xffe2a8);
      b.win('R', 0.2, 0.8, 4, 10, true);
      const s0 = l.x + l.w * 0.2;
      const s1 = l.x + l.w * 0.8;
      b.quad(b.base, [iso(s0, l.y + l.d, l.h + 9), iso(s1, l.y + l.d, l.h + 9), iso(s1, l.y + l.d, l.h + 1), iso(s0, l.y + l.d, l.h + 1)], 0x7a4f2a);
      b.quad(b.base, [iso(s0 + 0.08, l.y + l.d, l.h + 8), iso(s1 - 0.08, l.y + l.d, l.h + 8), iso(s1 - 0.08, l.y + l.d, l.h + 2), iso(s0 + 0.08, l.y + l.d, l.h + 2)], 0xfbe7c2);
      const c = iso((s0 + s1) / 2, l.y + l.d, l.h + 5);
      b.base.moveTo(c[0] - 5, c[1] - 1.5).lineTo(c[0] + 4, c[1] + 3).stroke({ width: 2.2, color: 0x7a4f2a, cap: 'round' });
      b.base.circle(c[0] - 5.5, c[1] - 1.8, 2.3).stroke({ width: 1.6, color: 0x7a4f2a });
      this.add(b, 'tool');
    }
    // アルバイト先：しま模様のひさしと、大きなガラス
    {
      const l = LOTS.job;
      const b = new Build(l.x, l.y, l.w, l.d);
      b.block(l.x, l.y, l.w, l.d, 0, l.h, 0xf7f4ee, 0xe3e0d8);
      b.paint('L', 0, 1, l.h - 4, l.h, 0x5b6b7a);
      b.paint('R', 0, 1, l.h - 4, l.h, 0x5b6b7a);
      b.paint('L', 0.08, 0.3, l.h - 3, l.h - 1, 0xffffff);
      b.win('L', 0.06, 0.58, 1.5, 9.5, false, 0xfff1c4);
      b.win('L', 0.66, 0.9, 0, 9.5, false, 0xfff1c4);
      b.win('R', 0.12, 0.88, 1.5, 9.5, true, 0xfff1c4);
      for (let i = 0; i < 8; i++) {
        const u0 = i / 8;
        const u1 = (i + 1) / 8;
        b.quad(b.base, [b.pl(u0, 12), b.pl(u1, 12), iso(l.x + l.w * u1, l.y + l.d + 0.34, 9), iso(l.x + l.w * u0, l.y + l.d + 0.34, 9)], i % 2 ? 0xffffff : 0x5b6b7a);
      }
      b.block(l.x + 0.3, l.y + 0.25, 0.5, 0.4, l.h, 4, 0xc9cdd2, 0xdfe2e6, false);
      this.add(b, 'job');
      this.glow(...iso(l.x + l.w * 0.4, l.y + l.d + 0.3, 5), 34, 0xffdc9a).label = 'night';
    }
    // 客先（高い集合住宅）：屋上に水のタンク
    {
      const l = LOTS.c2;
      const b = new Build(l.x, l.y, l.w, l.d);
      b.block(l.x, l.y, l.w, l.d, 0, l.h, 0xe6edf5, 0xd3dce7);
      b.paint('L', 0, 1, 0, 4, 0x2f7fc1);
      b.paint('R', 0, 1, 0, 4, 0x2f7fc1);
      for (let f = 0; f < 4; f++) {
        const z = 8 + f * 8;
        b.win('L', 0.12, 0.42, z, z + 5, (f + 1) % 2 === 0);
        b.win('L', 0.58, 0.88, z, z + 5, f % 3 === 0);
        b.win('R', 0.14, 0.44, z, z + 5, f % 2 === 0);
        b.win('R', 0.58, 0.86, z, z + 5, f === 1);
        b.paint('L', 0, 1, z - 1.6, z - 1, 0xb9c6d6);
        b.paint('R', 0, 1, z - 1.6, z - 1, 0xb9c6d6);
      }
      b.block(l.x + 0.1, l.y + 0.1, l.w - 0.2, l.d - 0.2, l.h, 1.6, 0xc4cedb, 0xd9e1ea, false);
      b.block(l.x + 0.55, l.y + 0.3, 0.35, 0.35, l.h + 1.6, 5, 0x9fb1c6, 0xb7c6d8, false);
      this.add(b, 'c2');
    }
    // 材料の店：片流れ屋根の倉庫と、木箱
    {
      const l = LOTS.mats;
      const b = new Build(l.x, l.y, l.w, l.d);
      b.block(l.x, l.y, l.w, l.d, 0, l.h, 0xe9e2c9, 0xe9e2c9);
      const up = 8;
      const side: P2[] = [iso(l.x + l.w, l.y, l.h), iso(l.x + l.w, l.y, l.h + up), iso(l.x + l.w, l.y + l.d, l.h)];
      b.quad(b.base, side, 0xe9e2c9);
      b.quad(b.sR, side, 0x1b2233);
      b.quad(b.base, [iso(l.x - 0.08, l.y, l.h + up), iso(l.x + l.w + 0.08, l.y, l.h + up), iso(l.x + l.w + 0.08, l.y + l.d + 0.1, l.h - 0.6), iso(l.x - 0.08, l.y + l.d + 0.1, l.h - 0.6)], 0x8a8f3a);
      for (let i = 1; i < 6; i++) {
        const p0 = iso(l.x + (l.w * i) / 6, l.y, l.h + up);
        const p1 = iso(l.x + (l.w * i) / 6, l.y + l.d + 0.1, l.h - 0.6);
        b.base.moveTo(p0[0], p0[1]).lineTo(p1[0], p1[1]).stroke({ width: 0.7, color: 0x6c7128, alpha: 0.6 });
      }
      b.paint('L', 0.3, 0.74, 0, 11, 0x6f7a45);
      b.paint('L', 0.33, 0.71, 0, 10, 0x3c4426);
      b.quad(b.litA, b.rect('L', 0.33, 0.71, 0, 10), 0xffcf7a, 0.85);
      b.win('R', 0.3, 0.7, 6, 11, true);
      this.add(b, 'mats');
      const crates = new Build(6.38, 3.7, 0.6, 0.2);
      crates.block(6.38, 3.7, 0.24, 0.2, 0, 4.5, 0xc79a62, 0xdbb27a, false);
      crates.block(6.66, 3.7, 0.22, 0.2, 0, 4, 0xb88850, 0xcfa468, false);
      crates.block(6.46, 3.72, 0.22, 0.16, 4.5, 3.6, 0xc79a62, 0xe0b982, false);
      this.add(crates);
    }
    // 売り場：色ちがいの天幕が3つ
    {
      const l = LOTS.market;
      const tops = [0xc2507a, 0xf6efe0, 0xe8a23c];
      for (let i = 0; i < 3; i++) {
        const x = l.x + i * 0.74;
        const w = 0.62;
        const b = new Build(x, l.y, w, l.d);
        b.block(x + 0.08, l.y + 0.35, w - 0.16, l.d - 0.45, 0, 4.5, 0xc9a273, 0xe5c898, false);
        const goods = [0xe2574c, 0x79b85a, 0xf2c14e, 0x8f6bd1];
        for (let k = 0; k < 4; k++) {
          const p = iso(x + 0.16 + (k % 2) * 0.24, l.y + 0.5 + Math.floor(k / 2) * 0.24, 5.4);
          b.base.circle(p[0], p[1], 1.5).fill(goods[(k + i) % 4]);
        }
        for (const [px, py] of [[x, l.y + l.d], [x + w, l.y + l.d], [x + w, l.y]] as P2[]) {
          const p0 = iso(px, py, 0);
          const p1 = iso(px, py, 11);
          b.base.moveTo(p0[0], p0[1]).lineTo(p1[0], p1[1]).stroke({ width: 1, color: 0x8a7a66 });
        }
        const apex = iso(x + w / 2, l.y + l.d / 2, 19);
        const c = tops[i];
        const fl: P2[] = [iso(x, l.y + l.d, 11), iso(x + w, l.y + l.d, 11), apex];
        const fr: P2[] = [iso(x + w, l.y + l.d, 11), iso(x + w, l.y, 11), apex];
        b.quad(b.base, [iso(x, l.y, 11), iso(x + w, l.y, 11), apex], dark(c, 0.12));
        b.quad(b.base, [iso(x, l.y, 11), iso(x, l.y + l.d, 11), apex], dark(c, 0.06));
        b.quad(b.base, fl, c);
        b.quad(b.base, fr, c);
        b.quad(b.sL, fl, 0x1b2233);
        b.quad(b.sR, fr, 0x1b2233);
        b.quad(b.base, [iso(x, l.y + l.d, 11), iso(x + w, l.y + l.d, 11), iso(x + w, l.y + l.d, 9.2), iso(x, l.y + l.d, 9.2)], light(c, 0.25));
        b.casts.push({ x, y: l.y, w, d: l.d, h: 8 });
        this.add(b, 'market');
        if (i === 1) this.glow(...iso(x + w / 2, l.y + l.d, 7), 28, 0xffd98a).label = 'night';
      }
    }
    // 客先（小さな家）
    {
      const l = LOTS.c1;
      const b = new Build(l.x, l.y, l.w, l.d);
      b.block(l.x, l.y, l.w, l.d, 0, l.h, 0xf4efe6, 0xf4efe6);
      b.win('L', 0.12, 0.42, 4.5, 10);
      b.paint('L', 0.58, 0.8, 0, 9.5, 0x3b6ea5);
      b.win('R', 0.3, 0.7, 4.5, 10, true);
      const o = 0.12;
      const r = 10;
      const gable: P2[] = [iso(l.x + l.w, l.y, l.h), iso(l.x + l.w, l.y + l.d, l.h), iso(l.x + l.w, l.y + l.d / 2, l.h + r)];
      b.quad(b.base, gable, 0xf4efe6);
      b.quad(b.sR, gable, 0x1b2233);
      const front: P2[] = [iso(l.x - o, l.y + l.d / 2, l.h + r), iso(l.x + l.w + o, l.y + l.d / 2, l.h + r), iso(l.x + l.w + o, l.y + l.d + o, l.h - 1.5), iso(l.x - o, l.y + l.d + o, l.h - 1.5)];
      b.quad(b.base, [iso(l.x - o, l.y - o, l.h - 1), iso(l.x + l.w + o, l.y - o, l.h - 1), iso(l.x + l.w + o, l.y + l.d / 2, l.h + r), iso(l.x - o, l.y + l.d / 2, l.h + r)], 0x225f96);
      b.quad(b.base, front, 0x2f7fc1);
      b.quad(b.sL, front, 0x1b2233);
      this.add(b, 'c1');
    }
    // 客先（小さな事務所）：ガラスの多い建物
    {
      const l = LOTS.c3;
      const b = new Build(l.x, l.y, l.w, l.d);
      b.block(l.x, l.y, l.w, l.d, 0, l.h, 0xdfe8f1, 0xcbd6e2);
      for (let f = 0; f < 3; f++) {
        const z = 2.5 + f * 7;
        b.win('L', 0.08, 0.92, z, z + 5, f === 1, 0xfff0c9);
        b.win('R', 0.08, 0.92, z, z + 5, f !== 1, 0xfff0c9);
        for (let k = 1; k < 4; k++) {
          b.paint('L', k / 4 - 0.012, k / 4 + 0.012, z, z + 5, 0xdfe8f1);
          b.paint('R', k / 4 - 0.012, k / 4 + 0.012, z, z + 5, 0xdfe8f1);
        }
      }
      b.block(l.x + 0.12, l.y + 0.12, l.w - 0.24, l.d - 0.24, l.h, 1.5, 0x2f7fc1, 0x4a94d2, false);
      this.add(b, 'c3');
    }
    // 駐車場に止まっている車
    {
      const b = new Build(4.95, 0.85, 0.3, 0.52);
      b.block(4.95, 0.85, 0.3, 0.52, 1, 3.4, 0xf6f3ec, 0xffffff, false);
      b.block(4.97, 0.98, 0.26, 0.26, 4.4, 2.8, 0x9fc3dd, 0xffffff, false);
      this.add(b);
    }
    // 公園の長いす
    {
      const b = new Build(6.0, 7.45, 0.5, 0.14);
      b.block(6.0, 7.45, 0.5, 0.14, 2, 1, 0x9a6b3f, 0xb88758, false);
      b.block(6.0, 7.4, 0.5, 0.04, 2, 3.5, 0x9a6b3f, 0xb88758, false);
      this.add(b);
    }
  }

  private makeTrees() {
    const spots: [number, number, number, number][] = [
      [0.45, 0.6, 10, 0x4f9a55], [0.5, 1.65, 7.5, 0x5fae5f], [2.8, 3.3, 6, 0x4f9a55], [4.55, 0.4, 8.5, 0x5fae5f], [5.75, 0.45, 7, 0x4f9a55], [5.95, 1.6, 6, 0x5fae5f],
      [2.5, 6.2, 6, 0x5fae5f], [0.35, 6.45, 5.5, 0x4f9a55], [4.5, 7.5, 7.5, 0x4f9a55], [6.2, 5.35, 8, 0x5fae5f], [7.6, 5.3, 10, 0x4f9a55], [7.7, 7.55, 8.5, 0x5fae5f], [5.45, 7.85, 6, 0x69b566],
      [6.9, 7.85, 5.5, 0xe79ab0],
    ];
    spots.forEach(([gx, gy, r, c], i) => {
      const g = new Graphics();
      g.rect(-1.2, -r * 0.9, 2.4, r * 0.9).fill(0x8a6242);
      g.circle(0, -r * 1.25, r).fill(dark(c, 0.16)).circle(-r * 0.28, -r * 1.45, r * 0.78).fill(c).circle(-r * 0.42, -r * 1.7, r * 0.42).fill(light(c, 0.22));
      const p = iso(gx, gy);
      g.position.set(p[0], p[1]);
      g.zIndex = this.baseDepth(gx, gy) + 0.2 + (gx + gy) * 0.01;
      this.town.addChild(g);
      this.trees.push({ g, ph: i * 1.7, sp: 0.6 + (i % 5) * 0.11, gx, gy, r });
      this.tinted.push({ o: g, k: 1 });
    });
  }

  private makeLamps() {
    const spots: P2[] = [[2.9, 3.9], [4.1, 5.1], [2.9, 6.55], [4.1, 2.05]];
    for (const [gx, gy] of spots) {
      const p = iso(gx, gy);
      const g = new Graphics();
      g.rect(-0.7, -17, 1.4, 17).fill(0x56606e).roundRect(-2.6, -19.5, 5.2, 3, 1.2).fill(0x3d4654).circle(0, -16.2, 1.5).fill(0xfff2c9);
      g.position.set(p[0], p[1]);
      g.zIndex = this.baseDepth(gx, gy) + 0.25 + (gx + gy) * 0.01;
      this.town.addChild(g);
      this.tinted.push({ o: g, k: 0.7 });
      const pool = this.glow(p[0], p[1] + 1, 56, 0xffc67a, this.pools);
      pool.scale.y *= 0.5;
      this.lamps.push({ glow: this.glow(p[0], p[1] - 16, 15, 0xffd590), pool });
    }
  }

  private person(body: number, big: boolean): Graphics {
    const s = big ? 1.55 : 1;
    const g = new Graphics();
    g.ellipse(0, 0.5, 3.4 * s, 1.5 * s).fill({ color: 0x1b2233, alpha: 0.25 });
    g.roundRect(-2.2 * s, -7.5 * s, 4.4 * s, 7 * s, 2 * s).fill(body);
    g.circle(0, -9.6 * s, 2.5 * s).fill(0xf6d2b0);
    if (big) g.roundRect(-2.9 * s, -12.3 * s, 5.8 * s, 2.3 * s, 1.1 * s).fill(0xf2b632).rect(-2.2 * s, -5 * s, 4.4 * s, 1.5 * s).fill(0xf2b632);
    return g;
  }

  private makeActors() {
    // 車（道に沿って2種類の向き）
    const colors = [0xe2574c, 0xf2c14e, 0x4a94d2, 0xffffff];
    const defs: [Car['axis'], number, number][] = [['v', 1, 0.3], ['v', -1, 5.4], ['h', 1, 6.2], ['h', -1, 1.4]];
    defs.forEach(([axis, dir, pos], i) => {
      const g = new Container();
      const body = new Graphics();
      const c = colors[i];
      const li = (x: number, y: number, z = 0): P2 => [(x - y) * TW, (x + y) * TH - z];
      const w = axis === 'h' ? 0.52 : 0.26;
      const d = axis === 'h' ? 0.26 : 0.52;
      const boxAt = (x: number, y: number, bw: number, bd: number, z0: number, h: number, wall: number, top: number) => {
        body.poly([...li(x, y + bd, z0 + h), ...li(x + bw, y + bd, z0 + h), ...li(x + bw, y + bd, z0), ...li(x, y + bd, z0)]).fill(dark(wall, 0.12));
        body.poly([...li(x + bw, y + bd, z0 + h), ...li(x + bw, y, z0 + h), ...li(x + bw, y, z0), ...li(x + bw, y + bd, z0)]).fill(dark(wall, 0.24));
        body.poly([...li(x, y, z0 + h), ...li(x + bw, y, z0 + h), ...li(x + bw, y + bd, z0 + h), ...li(x, y + bd, z0 + h)]).fill(top);
      };
      body.ellipse(...li(0, 0, -1), 9, 4).fill({ color: 0x1b2233, alpha: 0.22 });
      boxAt(-w / 2, -d / 2, w, d, 1, 3.4, c, c);
      const cw = axis === 'h' ? w * 0.5 : w * 0.86;
      const cd = axis === 'h' ? d * 0.86 : d * 0.5;
      boxAt(-cw / 2, -cd / 2, cw, cd, 4.4, 2.8, 0x9fc3dd, light(c, 0.3));
      g.addChild(body);
      this.town.addChild(g);
      this.tinted.push({ o: body, k: 1 });
      const lamp = this.glow(0, 0, 12, 0xffdc9a);
      this.cars.push({ g, gx: 0, gy: 0, axis, dir, pos, speed: 1.1 + (i % 3) * 0.25, lamp });
    });
    // 歩く人
    const wear = [0xd9822b, 0x4a94d2, 0xc2507a, 0x8a8f3a, 0x7b5cc9, 0x5b6b7a];
    for (let i = 0; i < 6; i++) {
      const g = this.person(wear[i], false);
      this.town.addChild(g);
      this.tinted.push({ o: g, k: 0.85 });
      this.walkers.push({ g, gx: 0, gy: 0, axis: i % 2 ? 'h' : 'v', line: i % 4 < 2 ? 0 : 1, pos: (i * 1.37) % 8, speed: (i % 3 === 0 ? -1 : 1) * (0.32 + (i % 4) * 0.07), phase: i });
    }
    // 自分：ほかの人より大きく、足元に白い輪、頭の上に印
    const ringG = new Graphics().ellipse(0, 0.5, 8, 3.6).stroke({ width: 1.6, color: 0xffffff, alpha: 0.95 });
    this.meBody = this.person(0x2b3547, true);
    this.mark.poly([-4.6, -28.5, 4.6, -28.5, 0, -22.5]).fill(0xffc94a).poly([-4.6, -28.5, 4.6, -28.5, 0, -22.5]).stroke({ width: 1.5, color: 0x1c2530, join: 'round' });
    this.ring.ellipse(0, 0, 10, 4.6).fill({ color: 0xffc94a, alpha: 0.3 }).ellipse(0, 0, 10, 4.6).stroke({ width: 1.4, color: 0xffb21f, alpha: 0.9 });
    this.me.addChild(ringG, this.meBody, this.mark);
    this.town.addChild(this.me);
    this.tinted.push({ o: this.meBody, k: 0.45 });
    // 煙突の煙
    for (let i = 0; i < 5; i++) {
      const g = new Graphics().circle(0, 0, 3).fill({ color: 0xffffff, alpha: 0.8 });
      this.fx.addChild(g);
      this.smoke.push({ g, x: 0, y: 0, vx: 0, vy: 0, life: i * 0.5, max: 2.5, grav: 0 });
    }
  }

  // 建物との前後：横か奥行きのどちらかで重なる位置にいるときだけ、手前と決める
  private baseDepth(gx: number, gy: number): number {
    let z = 0;
    for (const b of this.builds) {
      const x1 = b.x + b.w - 0.04;
      const y1 = b.y + b.d - 0.04;
      if ((gx >= x1 && gy > b.y - 0.3) || (gy >= y1 && gx > b.x - 0.3)) z = Math.max(z, b.box.zIndex);
    }
    return z;
  }
  private depth(gx: number, gy: number): number {
    let z = this.baseDepth(gx, gy) + 0.3;
    for (const t of this.trees) if (gx + gy >= t.gx + t.gy && t.g.zIndex >= z) z = t.g.zIndex + 0.05;
    return z + (gx + gy) * 0.01;
  }

  private drawTrail() {
    const g = this.trail;
    g.clear();
    if (this.view.mode === 'title') return;
    for (let i = 1; i < this.seq.length; i++) {
      const path = route(this.seq[i - 1].place, this.seq[i].place);
      for (let t = 0; t <= 1.0001; t += 0.045) {
        const p = iso(...along(path, t));
        g.ellipse(p[0], p[1], 1.5, 0.8).fill({ color: 0xffffff, alpha: 0.75 });
      }
    }
  }

  private drawSky(s: ReturnType<typeof skyAt>) {
    this.sky.tint = s.bot;
    this.skyTop.tint = s.top;
    // 太陽と月の通り道
    const p = (s.h - 6) / 12;
    this.sun.visible = p > -0.08 && p < 1.08;
    this.sun.position.set(356 - p * 322, 162 - Math.sin(Math.PI * Math.min(1, Math.max(0, p))) * 118);
    const q = (((s.h - 18 + 24) % 24)) / 12;
    this.moon.visible = q > 0.02 && q < 0.98;
    this.moon.position.set(346 - q * 302, 164 - Math.sin(Math.PI * q) * 110);
    this.moon.alpha = smooth(0.2, 0.7, s.night);
    this.far.tint = mix(s.bot, s.top, 0.6);
  }

  private drawShadows(s: ReturnType<typeof skyAt>) {
    const g = this.shadows;
    g.clear();
    const p = Math.min(1, Math.max(0, (s.h - 6) / 12));
    const c = Math.cos(Math.PI * p);
    const sx = -c * (0.5 + 0.85 * Math.abs(c));
    const sy = 0.26;
    const ogx = sx / (2 * TW) + sy / (2 * TH);
    const ogy = -sx / (2 * TW) + sy / (2 * TH);
    const alpha = 0.24 * (1 - s.night);
    if (alpha < 0.01) return;
    for (const b of this.builds) {
      for (const k of b.casts) {
        const pts: P2[] = [];
        for (const [cx, cy] of [[k.x, k.y], [k.x + k.w, k.y], [k.x + k.w, k.y + k.d], [k.x, k.y + k.d]] as P2[]) {
          pts.push(iso(cx, cy), iso(cx + ogx * k.h, cy + ogy * k.h));
        }
        g.poly(hull(pts)).fill({ color: 0x1b2233, alpha });
      }
    }
    for (const t of this.trees) {
      const z = t.r * 1.3;
      const a = iso(t.gx, t.gy);
      const e = iso(t.gx + ogx * z, t.gy + ogy * z);
      g.ellipse((a[0] + e[0]) / 2, (a[1] + e[1]) / 2, t.r * 0.9 + Math.abs(e[0] - a[0]) / 2, t.r * 0.45).fill({ color: 0x1b2233, alpha });
    }
  }

  private applyLight(s: ReturnType<typeof skyAt>) {
    for (const t of this.tinted) t.o.tint = t.k >= 1 ? s.tint : mix(0xffffff, s.tint, t.k);
    const p = Math.min(1, Math.max(0, (s.h - 6) / 12));
    // 朝は右の壁が明るく、夕方は左の壁が明るい（太陽は右から昇る）
    const aL = 0.05 + 0.2 * (1 - smooth(0.1, 0.9, p));
    const aR = 0.05 + 0.2 * smooth(0.1, 0.9, p);
    const litA = smooth(0.2, 0.55, s.night);
    const litB = smooth(0.45, 0.9, s.night);
    for (const b of this.builds) {
      b.sL.alpha = aL;
      b.sR.alpha = aR;
      b.litA.alpha = litA;
      b.litB.alpha = litB;
    }
    for (const l of this.lamps) {
      l.glow.alpha = litA * 0.9;
      l.pool.alpha = litA * 0.4;
    }
    for (const c of this.glows.children) if (c.label === 'night') c.alpha = litA * 0.55;
    for (const c of this.clouds) c.g.tint = mix(0xffffff, s.tint, 0.8);
    this.stars.alpha = smooth(0.5, 1, s.night);
  }

  // 1秒あたりのコマ数が足りない端末では、絵の細かさ（解像度）を1段ずつ落とす
  private adapt(ms: number) {
    this.frames++;
    if (this.frames < 30) return;
    if (ms > 30) this.slow++;
    if (this.frames % 90 === 0) {
      if (this.slow > 45 && this.res > 1) {
        this.res = Math.max(1, this.res - 0.5);
        this.app.renderer.resolution = this.res;
        this.app.resize();
      }
      this.slow = 0;
    }
  }

  private setPlace(to: PlaceKey, dur: number) {
    if (to === this.at && this.moveT >= 1) return;
    const from = this.at;
    this.path = from === to ? null : route(from, to);
    this.at = to;
    this.moveT = this.path ? 0 : 1;
    this.moveDur = dur;
  }

  private tick(dt: number) {
    const v = this.view;
    const scale = this.app.screen.width / WORLD_W;
    this.root.scale.set(scale);
    this.root.y = this.app.screen.height - WORLD_H * scale;
    this.time += dt;
    const calm = v.calm;

    // ---- 時刻
    let slotPos = -1;
    if (v.mode === 'title') {
      this.hour = (this.hour + dt * (calm ? 0 : 0.55)) % 24;
    } else if (this.replay) {
      const r = this.replay;
      const t = (performance.now() - r.t0) / 1000;
      if (t < r.dur) {
        const q = ease(t / r.dur);
        this.hour = 6 + 16 * q;
        slotPos = q * 16;
      } else if (t < r.dur + r.back) {
        this.hour = 22 + 9.5 * ease((t - r.dur) / r.back);
        this.setPlace(this.seq[0].place, 0.3);
      } else {
        this.replay = null;
        this.hour = 7.5;
      }
    } else if (v.fast && !calm) {
      const want = 12.5 + Math.sin(this.time * 0.9) * 2.5;
      this.hour += (want - (this.hour % 24)) * (1 - Math.exp(-dt * 3));
      this.fastT += dt;
      if (this.fastT > 0.24) {
        this.fastT = 0;
        this.fastI = (this.fastI + 1) % this.seq.length;
        this.setPlace(this.seq[this.fastI].place, 0.2);
      }
    } else {
      const h = this.hour % 24;
      this.hour = h + (7.5 - h) * (1 - Math.exp(-dt * 4));
      if (this.moveT >= 1) this.setPlace(this.seq[0].place, 0.35);
    }
    if (slotPos >= 0) {
      const cur = this.seq.find((x) => slotPos >= x.from && slotPos < x.to) ?? this.seq[this.seq.length - 1];
      if (cur.place !== this.at) {
        this.setPlace(cur.place, Math.min(0.26, ((cur.to - cur.from) / 16) * 1.25 * 0.7));
        if (cur.slot !== 'rest') this.spark(cur.place, SLOT_COLOR[cur.slot]);
      }
    }

    if (this.fixedHour !== null) this.hour = this.fixedHour;
    const s = skyAt(this.hour);
    if (Math.abs(s.h - this.drawnHour) > 0.02) {
      this.drawnHour = s.h;
      this.drawSky(s);
      this.applyLight(s);
    }
    if (Math.abs(s.h - this.shadowHour) > 0.08) {
      this.shadowHour = s.h;
      this.drawShadows(s);
    }

    // ---- 空の物
    const drift = calm ? 0 : 1;
    for (const c of this.clouds) {
      c.x += c.v * dt * drift * (v.fast ? 4 : 1);
      if (c.x > WORLD_W + 90) c.x = -90;
      c.g.position.set(c.x, c.y);
      c.g.alpha = 1 - s.night * 0.72;
    }
    for (const b of this.birds) {
      b.x += b.v * dt * drift;
      if (b.x > WORLD_W + 400) b.x = -80;
      b.g.position.set(b.x, b.y + Math.sin(this.time * 1.3 + b.ph) * 3);
      b.g.scale.y = 0.6 + 0.4 * Math.sin(this.time * 9 + b.ph);
      b.g.alpha = 1 - smooth(0.1, 0.5, s.night);
    }
    if (s.night > 0.5 && Math.floor(this.time * 8) !== Math.floor((this.time - dt) * 8)) {
      const g = this.stars;
      g.clear();
      const r = rng(99);
      for (let i = 0; i < 40; i++) {
        const x = r() * WORLD_W;
        const y = -30 + r() * 170;
        const tw = 0.55 + 0.45 * Math.sin(this.time * (0.6 + r() * 1.4) + i);
        g.circle(x, y, 0.5 + r() * 0.7).fill({ color: 0xffffff, alpha: calm ? 0.8 : tw });
      }
    }

    // ---- 池のきらめき
    this.glints.forEach((line, i) => {
      const ph = this.time * (calm ? 0 : 0.5 + i * 0.13) + i * 1.9;
      const p = iso(6.75 + i * 0.17 + Math.sin(ph) * 0.07, 6.1 + i * 0.16);
      line.position.set(p[0], p[1]);
      line.scale.x = 0.75 + 0.35 * Math.sin(ph * 1.7);
      line.alpha = 0.5 + 0.25 * Math.sin(ph * 1.3);
    });

    // ---- 木のゆれ（1本ごとに速さを変える）
    for (const t of this.trees) t.g.rotation = calm ? 0 : Math.sin(this.time * t.sp + t.ph) * 0.028 + Math.sin(this.time * t.sp * 2.3 + t.ph) * 0.012;

    // ---- 車
    for (const c of this.cars) {
      c.pos += c.dir * c.speed * dt * drift * (v.fast ? 2.4 : 1);
      if (c.pos > 8.6) c.pos = -0.6;
      if (c.pos < -0.6) c.pos = 8.6;
      const lane = c.dir > 0 ? 0.31 : 0.69;
      c.gx = c.axis === 'v' ? 3 + lane : c.pos;
      c.gy = c.axis === 'v' ? c.pos : 4 + (1 - lane);
      const p = iso(c.gx, c.gy);
      c.g.position.set(p[0], p[1]);
      const edge = Math.min(smooth(0, 0.6, c.pos), 1 - smooth(7.4, 8, c.pos));
      c.g.alpha = edge;
      c.g.zIndex = this.depth(c.gx, c.gy);
      const ahead = iso(c.gx + (c.axis === 'h' ? c.dir * 0.3 : 0), c.gy + (c.axis === 'v' ? c.dir * 0.3 : 0), 2.5);
      c.lamp.position.set(ahead[0], ahead[1]);
      c.lamp.alpha = edge * edge * smooth(0.3, 0.7, s.night) * 0.7;
    }

    // ---- 歩く人
    for (const w of this.walkers) {
      w.pos = (w.pos + w.speed * dt * drift * (v.fast ? 2.4 : 1) + 8) % 8;
      const off = w.line === 0 ? 0.06 : 0.94;
      w.gx = w.axis === 'v' ? 3 + off : w.pos;
      w.gy = w.axis === 'v' ? w.pos : 4 + off;
      const p = iso(w.gx, w.gy);
      w.g.position.set(p[0], p[1] - Math.abs(Math.sin(this.time * 7 + w.phase)) * 1.1 * drift);
      w.g.alpha = Math.min(smooth(0, 0.4, w.pos), 1 - smooth(7.6, 8, w.pos)) * (1 - s.night * 0.5);
      w.g.zIndex = this.depth(w.gx, w.gy);
    }

    // ---- 自分
    let moving = false;
    if (this.path && this.moveT < 1) {
      this.moveT = Math.min(1, this.moveT + dt / Math.max(0.05, this.moveDur));
      const np = along(this.path, calm ? 1 : ease(this.moveT));
      const dx = (np[0] - np[1]) - (this.pos[0] - this.pos[1]);
      if (Math.abs(dx) > 0.001) this.facing = dx > 0 ? 1 : -1;
      this.pos = np;
      moving = true;
    } else if (this.moveT >= 1) {
      this.pos = [...LOTS[this.at].door];
    }
    const mp = iso(this.pos[0], this.pos[1]);
    const hop = moving ? Math.abs(Math.sin(this.time * 22)) * 2.2 : Math.sin(this.time * 2.2) * 0.5;
    this.me.position.set(mp[0], mp[1]);
    this.meBody.y = calm ? 0 : -hop;
    this.meBody.scale.x = this.facing;
    this.mark.y = calm ? 0 : Math.sin(this.time * 3.1) * 1.6 - hop;
    this.me.zIndex = this.depth(this.pos[0], this.pos[1]) + 0.2;
    this.me.visible = v.mode !== 'title';
    this.trail.alpha = v.mode === 'title' || this.replay || v.fast ? 0 : 0.5 + 0.2 * Math.sin(this.time * 2);
    // 行き先の輪（暖かい色。ここだけ目立たせる）
    {
      const d = iso(...LOTS[this.at].door);
      const k = calm ? 0.5 : 0.5 + 0.5 * Math.sin(this.time * 3.4);
      this.ring.visible = v.mode !== 'title';
      this.ring.position.set(d[0], d[1]);
      this.ring.scale.set(0.92 + k * 0.24);
      this.ring.alpha = 0.95 - k * 0.3;
    }

    // ---- 煙
    const chim = iso(LOTS.home.x + 0.36, LOTS.home.y + 0.31, LOTS.home.h + 17);
    for (const b of this.smoke) {
      b.life += dt * drift;
      if (b.life > b.max) b.life = 0;
      const k = b.life / b.max;
      b.g.position.set(chim[0] + Math.sin(k * 5 + b.max) * 2 + k * 7, chim[1] - k * 22);
      b.g.scale.set(0.5 + k * 1.3);
      b.g.alpha = calm ? 0 : (1 - k) * 0.55 * (1 - s.night * 0.5);
    }

    // ---- 硬貨・火花
    for (let i = this.bits.length - 1; i >= 0; i--) {
      const b = this.bits[i];
      b.life += dt;
      b.vy += b.grav * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.g.position.set(b.x, b.y);
      b.g.scale.x = b.grav > 100 ? Math.cos(b.life * 14 + i) : 1;
      b.g.alpha = 1 - smooth(0.6, 1, b.life / b.max);
      if (b.life >= b.max) {
        b.g.destroy();
        this.bits.splice(i, 1);
      }
    }
  }

  private spark(place: PlaceKey, color: number) {
    if (this.view.calm) return;
    const d = iso(...LOTS[place].door, 8);
    for (let i = 0; i < 5; i++) {
      const g = new Graphics().circle(0, 0, 1.8).fill(color).circle(0, 0, 0.8).fill(0xffffff);
      this.fx.addChild(g);
      const a = -Math.PI / 2 + (i - 2) * 0.5;
      this.bits.push({ g, x: d[0], y: d[1], vx: Math.cos(a) * 34, vy: Math.sin(a) * 46, life: 0, max: 0.5, grav: 90 });
    }
  }
}
