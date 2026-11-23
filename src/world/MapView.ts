// 街の絵（PixiJS）。地図の見た目で、すべてコードで描く。
// ルール本体の状態を毎コマ読んで描くだけで、状態は書き換えない。タッチも受け取らない。
// 広い街は 800m 四方の「ます」に分け、見えている所だけ作って描く。
import 'pixi.js/unsafe-eval';
import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { nodeXY, seg, type Block, type City, type District, type PoiKind } from '../core/city';
import { hourOf, riding, stars, type Car, type GameState } from '../core/sim';
import type { Balance } from '../data/schema';

export const LAND = 0xf2efe9;
export const WATER = 0xa9d3e6;
export const BLOCK: Record<District, number> = { downtown: 0xe9dcea, commercial: 0xf6dcd6, residential: 0xe7e2d8, industrial: 0xdfe1ec, park: 0xcdebc0, water: WATER };
export const ROAD = { minor: 0xffffff, minorEdge: 0xcbc5b8, major: 0xf9c97c, majorEdge: 0xd9993c };
export const PIN: Record<PoiKind | 'biz', { c: number; t: string }> = {
  home: { c: 0x1b2330, t: '家' }, conbini: { c: 0x5b6b7a, t: '働' }, warehouse: { c: 0x5b6b7a, t: '働' },
  bike: { c: 0x2f7fc1, t: '輪' }, car: { c: 0x2f7fc1, t: '車' }, tool: { c: 0x2f7fc1, t: '具' },
  pawn: { c: 0x7b3fa0, t: '質' }, chop: { c: 0x7b3fa0, t: '解' }, atm: { c: 0x7b3fa0, t: 'A' }, house: { c: 0x7b3fa0, t: '留' },
  bank: { c: 0x1f8a6f, t: '銀' }, police: { c: 0x3b4a8f, t: '警' }, lot: { c: 0xd9822b, t: '空' }, biz: { c: 0xe0a100, t: '店' },
};
const CH = 800;
const SIDEWALK = 0xe7e4dd;
const SHADE = 0x1b2330;
// 屋根の色：用途ごとに色の系統を分ける（住宅＝暖かい色と青ねず、商業＝明るい灰、都心＝青いガラス、工業＝青みの金属）
const ROOF: Record<string, number[]> = {
  residential: [0xc98b74, 0x9aa9bb, 0xa58f7d, 0xb3bbb1, 0xd3a57e, 0x93a1af, 0xbf7f6a],
  commercial: [0xdcd8d1, 0xd0d5da, 0xe2dacf, 0xd6d0c6],
  downtown: [0xb9c7d6, 0xa9b6c6, 0xc5cdd6, 0x9fb0c2],
  industrial: [0xc9ced6, 0xbfc6cf, 0xd3cfc5],
};
const WALL: Record<string, [number, number]> = { residential: [0xcbbfa9, 0xb3a893], commercial: [0xb9b4ab, 0xa29d94], downtown: [0x8498ae, 0x6f8298], industrial: [0xaab1bb, 0x959ca7] };
const AWNING = [0xd9574c, 0x3f9a6e, 0x3f7fc4, 0xe0a436, 0x8a5fc0];
const hsh = (a: number, b: number, c: number) => {
  let h = Math.imul(a + 1, 73856093) ^ Math.imul(b + 1, 19349663) ^ Math.imul(c + 1, 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const mix = (a: number, b: number, t: number) => {
  const f = (s: number) => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * t);
  return (f(16) << 16) | (f(8) << 8) | f(0);
};
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class MapView {
  private app = new Application();
  private world = new Container();
  private chunks = new Map<string, Graphics>();
  private chunkLayer = new Container();
  private routeG = new Graphics();
  private pins = new Container();
  private pinSprites: Sprite[] = [];
  private pinTex = {} as Record<PoiKind | 'biz', Texture>;
  private pedG = new Graphics();
  private carLayer = new Container();
  private carViews = new Map<number, { box: Container; light: Graphics | null; ring: Graphics }>();
  private me = new Container();
  private glows = new Container();
  private glowWorld = new Container(); // 街と同じ位置・大きさに合わせて、夜の覆いの上に重ねる
  private glowTex!: Texture;
  private glowPool: Sprite[] = [];
  private night = new Graphics();
  private zoom = 1.7;
  private labels: Sprite[] = [];
  private poiRoof = new Map<number, Map<number, number>>(); // 場所の建物（区画の番号 → 建物の番号 → 印の色）
  private camX = 0;
  private camY = 0;
  private routeKey = '';
  private dead = false;
  private res = 2;
  private frames = 0;
  private slow = 0;
  ok = false;

  constructor(private city: City, private bal: Balance, private get: () => GameState) {}

  async init(el: HTMLElement): Promise<boolean> {
    try {
      this.res = Math.min(window.devicePixelRatio || 1, 2);
      // 画素の細かい画面（スマホ）では、なめらかにする処理を切る（細かさで足りるうえ、重いため）
      await this.app.init({ resizeTo: el, background: 0xe4e0d6, antialias: this.res < 2, autoDensity: true, resolution: this.res, preference: 'webgl' });
    } catch {
      return false;
    }
    if (this.dead) {
      this.app.destroy(true);
      return false;
    }
    const cv = this.app.canvas;
    cv.style.pointerEvents = 'none';
    cv.style.display = 'block';
    el.appendChild(cv);
    this.glowTex = this.makeGlow();
    for (const k of Object.keys(PIN) as (PoiKind | 'biz')[]) this.pinTex[k] = this.makePin(PIN[k].c, PIN[k].t);
    // 場所にいちばん近い建物を、その場所の建物にする（屋根のふちとひさしを、印と同じ色にする）
    const NXb = this.city.xs.length - 1;
    for (const p of this.city.pois) {
      if (p.kind === 'house' || p.kind === 'atm') continue;
      const bi = seg(this.city.ys, p.y) * NXb + seg(this.city.xs, p.x);
      const blk = this.city.blocks[bi];
      if (!blk) continue;
      let best = -1;
      let bd = Infinity;
      for (let k = 0; k < blk.b.length; k += 4) {
        const dx = Math.max(blk.b[k] - p.x, 0, p.x - blk.b[k] - blk.b[k + 2]);
        const dy = Math.max(blk.b[k + 1] - p.y, 0, p.y - blk.b[k + 1] - blk.b[k + 3]);
        if (Math.hypot(dx, dy) < bd) {
          bd = Math.hypot(dx, dy);
          best = k;
        }
      }
      if (best >= 0) {
        if (!this.poiRoof.has(bi)) this.poiRoof.set(bi, new Map());
        this.poiRoof.get(bi)!.set(best, PIN[p.kind].c);
      }
    }
    const base = new Graphics();
    const S = this.city.size;
    base.rect(0, 0, S, S).fill(LAND);
    this.drawWater(base);
    for (const p of this.city.pois) {
      const sp = new Sprite(this.pinTex[p.kind]);
      sp.anchor.set(0.5, 1);
      sp.position.set(p.x, p.y - 4);
      this.pins.addChild(sp);
      this.pinSprites.push(sp);
    }
    const S2 = this.city.size;
    const names: [number, number, string, number][] = [
      [0.42, 0.5, '中央', 1.3], [0.42, 0.2, '北町', 1], [0.42, 0.82, '南町', 1], [0.2, 0.3, '浜通り', 1], [0.14, 0.72, '港', 1.1], [0.3, 0.36, '中央公園', 0.8],
      [0.82, 0.22, '川向こう', 1], [0.86, 0.62, '東が丘', 1], [0.63, 0.94, '川下', 0.8], [0.6, 0.08, '川上', 0.8],
    ];
    for (const [fx, fy, text, size] of names) {
      const sp = new Sprite(this.makeLabel(text));
      sp.anchor.set(0.5);
      sp.position.set(fx * S2, fy * S2);
      sp.scale.set(size * 0.55);
      sp.alpha = 0.5;
      this.labels.push(sp);
    }
    this.me.addChild(new Graphics().circle(0.5, 0.6, 2.6).fill({ color: SHADE, alpha: 0.25 }).circle(0, 0, 2.5).fill({ color: 0xffffff, alpha: 0.95 }).circle(0, 0, 1.6).fill(0x1b2330).poly([2.2, 0, 0.6, -1.1, 0.6, 1.1]).fill(0xffc94a));
    this.world.addChild(base, this.chunkLayer, ...this.labels, this.routeG, this.pedG, this.carLayer, this.me, this.pins);
    this.app.stage.addChild(this.world, this.night, this.glowWorld);
    this.glowWorld.addChild(this.glows);
    const s = this.get();
    this.camX = s.x;
    this.camY = s.y;
    this.app.ticker.add((tk) => this.frame(tk.deltaMS / 1000));
    this.ok = true;
    return true;
  }

  destroy() {
    this.dead = true;
    if (this.ok) this.app.destroy(true, { children: true });
  }

  // 画面の点を、街の位置に直す（全体地図や確かめ用）
  get scale() {
    return this.zoom;
  }

  private makeGlow(): Texture {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d')!;
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
    return Texture.from(c);
  }
  // 場所の印：色の丸に1文字。先に絵にしておき、同じ種類は同じ絵を使い回す
  private makePin(color: number, text: string): Texture {
    const c = document.createElement('canvas');
    c.width = 72;
    c.height = 88;
    const x = c.getContext('2d')!;
    x.fillStyle = 'rgba(27,35,48,0.25)';
    x.beginPath();
    x.ellipse(36, 82, 12, 5, 0, 0, 6.3);
    x.fill();
    x.fillStyle = hex(color);
    x.beginPath();
    x.moveTo(36, 84);
    x.lineTo(22, 58);
    x.lineTo(50, 58);
    x.fill();
    x.beginPath();
    x.arc(36, 36, 30, 0, 6.3);
    x.fill();
    x.lineWidth = 5;
    x.strokeStyle = '#ffffff';
    x.stroke();
    x.fillStyle = '#ffffff';
    x.font = `900 ${text.length > 1 ? 24 : 34}px -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(text, 36, 38);
    return Texture.from(c);
  }

  private makeLabel(text: string): Texture {
    const c = document.createElement('canvas');
    c.width = 64 * text.length + 40;
    c.height = 96;
    const x = c.getContext('2d')!;
    x.font = '900 60px -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.lineWidth = 10;
    x.strokeStyle = 'rgba(255,255,255,0.9)';
    x.strokeText(text, c.width / 2, 50);
    x.fillStyle = '#5a6272';
    x.fillText(text, c.width / 2, 50);
    return Texture.from(c);
  }

  // 水辺：浅い所は明るく、岸には砂、水面には小さな波
  private drawWater(g: Graphics) {
    const S = this.city.size;
    const RH = this.bal.world.riverHalf;
    const c = this.city;
    const band = (fa: (y: number) => number, fb: (y: number) => number, color: number, step = 80) => {
      const pts: number[] = [];
      for (let y = -400; y <= S + 400; y += step) pts.push(fa(y), y);
      for (let y = S + 400; y >= -400; y -= step) pts.push(fb(y), y);
      g.poly(pts).fill(color);
    };
    band(() => -3000, (y) => c.coast(y), WATER);
    band((y) => c.coast(y) - 80, (y) => c.coast(y), 0xbfe0ee);
    band((y) => c.coast(y) - 26, (y) => c.coast(y), 0xd3ebf3);
    band((y) => c.coast(y), (y) => c.coast(y) + 24, 0xf1e4c0);
    band((y) => c.river(y) - RH - 7, (y) => c.river(y) + RH + 7, 0xcfe3b6, 60);
    band((y) => c.river(y) - RH, (y) => c.river(y) + RH, WATER, 60);
    band((y) => c.river(y) - RH, (y) => c.river(y) - RH + 16, 0xbfe0ee, 60);
    band((y) => c.river(y) + RH - 16, (y) => c.river(y) + RH, 0xbfe0ee, 60);
    for (let n = 0; n < 520; n++) {
      const y = hsh(n, 3, 7) * S;
      const sea = n % 3 !== 0;
      const x = sea ? hsh(n, 9, 2) * Math.max(0, c.coast(y) - 110) : c.river(y) + (hsh(n, 5, 1) - 0.5) * (RH * 2 - 50);
      g.rect(x, y, 7 + (n % 4) * 2, 0.9).fill({ color: 0xffffff, alpha: 0.5 }).rect(x + 4, y + 2.6, 5, 0.8).fill({ color: 0xffffff, alpha: 0.35 });
    }
  }

  private tree(g: Graphics, x: number, y: number, r: number) {
    g.regularPoly(x + r * 0.5, y + r * 0.55, r, 8).fill({ color: SHADE, alpha: 0.16 });
    g.regularPoly(x, y, r, 8).fill(0x7fba74).regularPoly(x - r * 0.25, y - r * 0.28, r * 0.62, 6).fill(0xa6d79a);
  }

  private park(g: Graphics, b: Block, X: number, Y: number, W: number, H: number) {
    const r1 = hsh(b.i, b.j, 1);
    g.roundRect(X, Y, W, H, 7).fill(0xcdebc0);
    for (let k = 0; k < 4; k++) g.ellipse(X + W * (0.2 + 0.6 * hsh(b.i, b.j, 20 + k)), Y + H * (0.2 + 0.6 * hsh(b.j, b.i, 30 + k)), W * 0.2, H * 0.16).fill(0xc0e4b2);
    // 散歩道
    const px = X + W * (0.3 + 0.4 * hsh(b.i, b.j, 2));
    const py = Y + H * (0.3 + 0.4 * hsh(b.i, b.j, 3));
    g.rect(X + 3, py - 1.6, W - 6, 3.2).fill(0xece4cf).rect(px - 1.6, Y + 3, 3.2, H - 6).fill(0xece4cf);
    g.circle(px, py, 6.5).fill(0xece4cf).circle(px, py, 3).fill(0x9fd2e8).circle(px, py, 1.2).fill(0xffffff);
    if (r1 < 0.45 && W > 60 && H > 60) {
      // 池
      const ox = X + W * 0.72;
      const oy = Y + H * 0.7;
      g.ellipse(ox, oy, W * 0.17 + 2, H * 0.14 + 2).fill(0xe9dfbd).ellipse(ox, oy, W * 0.17, H * 0.14).fill(0x9fd2e8).ellipse(ox - W * 0.04, oy - H * 0.03, W * 0.08, H * 0.05).fill(0xbfe3f1);
    } else if (r1 < 0.8 && W > 70 && H > 60) {
      // 運動場
      const fw = Math.min(64, W * 0.42);
      const fh = Math.min(40, H * 0.34);
      const ox = X + W * 0.56;
      const oy = Y + H * 0.58;
      for (let k = 0; k < 6; k++) g.rect(ox + (k * fw) / 6, oy, fw / 6, fh).fill(k % 2 ? 0x9fd08f : 0xb1dba2);
      g.rect(ox, oy, fw, fh).stroke({ width: 0.8, color: 0xffffff, alpha: 0.9 }).rect(ox + fw / 2 - 0.4, oy, 0.8, fh).fill({ color: 0xffffff, alpha: 0.9 });
      g.circle(ox + fw / 2, oy + fh / 2, fh * 0.2).stroke({ width: 0.8, color: 0xffffff, alpha: 0.9 });
    }
    for (let k = 0; k < 18; k++) {
      const tx = X + 7 + hsh(b.i * 31 + k, b.j, 5) * (W - 14);
      const ty = Y + 7 + hsh(b.j * 17 + k, b.i, 6) * (H - 14);
      if (Math.abs(tx - px) < 5 || Math.abs(ty - py) < 5) continue;
      this.tree(g, tx, ty, 3.4 + hsh(k, b.i, b.j) * 2.6);
    }
  }

  // 建物：屋根（上の面）＋南の壁＋東の壁。光は北西から。影は南東の地面に落ちる
  private building(g: Graphics, b: Block, k: number, mark: number | undefined) {
    const x = b.b[k];
    const y = b.b[k + 1];
    const w = b.b[k + 2];
    const h = b.b[k + 3];
    const r1 = hsh(b.i * 7 + k, b.j, 11);
    const r2 = hsh(b.j * 5 + k, b.i, 13);
    const d = b.d;
    const tall = d === 'downtown' ? 3.4 + r1 * 2.2 : d === 'commercial' ? 2.3 + r1 * 1.3 : d === 'industrial' ? 2.4 + r1 : 1.5 + r1 * 0.9;
    const e = tall * 0.55;
    const [ws, we] = WALL[d];
    g.poly([x, y + h, x + w, y + h, x + w + e, y + h + tall, x + e, y + h + tall]).fill(ws);
    g.poly([x + w, y, x + w + e, y + tall, x + w + e, y + h + tall, x + w, y + h]).fill(we);
    const pal = ROOF[d];
    const c = pal[Math.floor(r2 * pal.length)];
    const lite = (col: number, t: number) => mix(col, 0xffffff, t);
    const dark = (col: number, t: number) => mix(col, SHADE, t);
    if (d === 'downtown') {
      // 壁に窓の帯
      for (let q = 1; q <= 2; q++) {
        const f = q / 3;
        g.poly([x + e * f, y + h + tall * f - 0.35, x + w + e * f, y + h + tall * f - 0.35, x + w + e * f, y + h + tall * f + 0.35, x + e * f, y + h + tall * f + 0.35]).fill({ color: 0xd6e6f5, alpha: 0.8 });
      }
    }
    if (mark !== undefined) {
      // 場所の建物：ひさしと入口
      g.poly([x + 1, y + h, x + w - 1, y + h, x + w - 1 + e * 0.5, y + h + tall * 0.5, x + 1 + e * 0.5, y + h + tall * 0.5]).fill(mark);
      for (let q = 0; q < 4; q++) g.rect(x + 2 + e * 0.25 + (q * (w - 4)) / 4, y + h + tall * 0.12, (w - 4) / 8, tall * 0.3).fill({ color: 0xffffff, alpha: 0.85 });
      g.rect(x + w / 2 - 1.6 + e * 0.8, y + h + tall * 0.55, 3.2, tall * 0.45).fill(0x2b3547);
    } else if (d === 'commercial' && r1 > 0.4) {
      g.poly([x + 1, y + h, x + w - 1, y + h, x + w - 1 + e * 0.3, y + h + tall * 0.3, x + 1 + e * 0.3, y + h + tall * 0.3]).fill(AWNING[Math.floor(r2 * 7919) % AWNING.length]);
    }
    // 屋根
    g.rect(x, y, w, h).fill(mark !== undefined ? mark : dark(c, 0.14));
    const inset = mark !== undefined ? 1.5 : d === 'residential' ? 0 : 0.9;
    if (d === 'residential' && mark === undefined) {
      // 切妻屋根：光の当たる面を明るく、反対の面を暗く。まん中に棟の線
      if (w >= h) {
        g.rect(x, y, w, h / 2).fill(lite(c, 0.16)).rect(x, y + h / 2, w, h / 2).fill(dark(c, 0.1)).rect(x, y + h / 2 - 0.3, w, 0.6).fill(dark(c, 0.3));
      } else {
        g.rect(x, y, w / 2, h).fill(lite(c, 0.16)).rect(x + w / 2, y, w / 2, h).fill(dark(c, 0.1)).rect(x + w / 2 - 0.3, y, 0.6, h).fill(dark(c, 0.3));
      }
      if (r1 > 0.7) g.rect(x + w * 0.2, y + h * 0.2, 1.6, 1.6).fill(dark(c, 0.4)); // 煙突・天窓
      return;
    }
    g.rect(x + inset, y + inset, w - inset * 2, h - inset * 2).fill(lite(c, mark !== undefined ? 0.12 : 0.06));
    if (d === 'industrial') {
      // のこぎり屋根の線と、丸いタンク
      if (w >= h) for (let q = x + 5; q < x + w - 2; q += 6.5) g.rect(q, y + 1, 0.9, h - 2).fill(dark(c, 0.18));
      else for (let q = y + 5; q < y + h - 2; q += 6.5) g.rect(x + 1, q, w - 2, 0.9).fill(dark(c, 0.18));
      if (r1 > 0.62 && w > 16 && h > 16) g.circle(x + w * 0.3, y + h * 0.3, 4.2).fill(dark(c, 0.22)).circle(x + w * 0.3 - 0.8, y + h * 0.3 - 0.8, 2.8).fill(lite(c, 0.3));
      return;
    }
    if (d === 'downtown' && w > 18 && h > 18) {
      // 屋上：一段高い部分と設備
      g.rect(x + w * 0.22 + 1, y + h * 0.22 + 1, w * 0.56, h * 0.56).fill({ color: SHADE, alpha: 0.14 });
      g.rect(x + w * 0.22, y + h * 0.22, w * 0.56, h * 0.56).fill(lite(c, 0.22));
      if (r1 > 0.55) g.circle(x + w * 0.5, y + h * 0.5, Math.min(w, h) * 0.16).stroke({ width: 0.8, color: 0xf4c84a }).circle(x + w * 0.5, y + h * 0.5, 1).fill(0xf4c84a);
    }
    if (w > 11 && h > 11) {
      const ux = x + 2 + r2 * (w - 7);
      const uy = y + 2 + r1 * (h - 7);
      g.rect(ux + 0.6, uy + 0.6, 2.8, 2.4).fill({ color: SHADE, alpha: 0.2 }).rect(ux, uy, 2.8, 2.4).fill(dark(c, 0.3));
    }
  }

  private buildChunk(cx: number, cy: number): Graphics {
    const c = this.city;
    const g = new Graphics();
    const NX = c.xs.length;
    const NY = c.ys.length;
    const inChunk = (x: number, y: number) => Math.floor(x / CH) === cx && Math.floor(y / CH) === cy;
    // 区画：歩道の帯 → 敷地 → 建物の影 → 建物
    for (const b of c.blocks) {
      if (b.d === 'water' || !inChunk((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2)) continue;
      const l = c.half(c.ax[b.i]) + 1.5;
      const r = c.half(c.ax[b.i + 1]) + 1.5;
      const t = c.half(c.ay[b.j]) + 1.5;
      const bt = c.half(c.ay[b.j + 1]) + 1.5;
      const X = b.x0 + l;
      const Y = b.y0 + t;
      const W = b.x1 - b.x0 - l - r;
      const H = b.y1 - b.y0 - t - bt;
      if (b.d === 'park') {
        this.park(g, b, X, Y, W, H);
        continue;
      }
      g.roundRect(X, Y, W, H, 3).fill(SIDEWALK);
      g.rect(X + 3.2, Y + 3.2, W - 6.4, H - 6.4).fill(BLOCK[b.d]);
      for (let k = 0; k < b.b.length; k += 4) {
        const tall = b.d === 'downtown' ? 5 : b.d === 'residential' ? 2 : 3;
        g.rect(b.b[k] + tall * 0.55, b.b[k + 1] + tall * 0.9, b.b[k + 2] + tall * 0.75, b.b[k + 3] + tall * 0.95).fill({ color: SHADE, alpha: 0.15 });
      }
      const marks = this.poiRoof.get(b.j * (NX - 1) + b.i);
      for (let k = 0; k < b.b.length; k += 4) this.building(g, b, k, marks?.get(k));
    }
    // 道：先にふち、あとから面。細い道→大通りの順に重ねる
    const rects: [number, number, number, number, number][] = [];
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const t = c.h[j * NX + i];
      if (t && inChunk((c.xs[i] + c.xs[i + 1]) / 2, c.ys[j])) {
        const hw = c.half(t >= 2);
        rects.push([c.xs[i] - hw, c.ys[j] - hw, c.xs[i + 1] - c.xs[i] + hw * 2, hw * 2, t]);
      }
      const u = c.v[j * NX + i];
      if (u && inChunk(c.xs[i], (c.ys[j] + c.ys[j + 1]) / 2)) {
        const hw = c.half(u >= 2);
        rects.push([c.xs[i] - hw, c.ys[j] - hw, hw * 2, c.ys[j + 1] - c.ys[j] + hw * 2, u]);
      }
    }
    for (const [x, y, w, h, t] of rects) if (t === 3) g.rect(x + 5, y + h + 1.6, w - 6, 7).fill({ color: SHADE, alpha: 0.14 }); // 橋の影
    for (const major of [false, true]) {
      for (const [x, y, w, h, t] of rects) if (t >= 2 === major) g.rect(x - 1.6, y - 1.6, w + 3.2, h + 3.2).fill(t === 3 ? 0x8f6a35 : major ? ROAD.majorEdge : ROAD.minorEdge);
      for (const [x, y, w, h, t] of rects) if (t >= 2 === major) g.rect(x, y, w, h).fill(major ? ROAD.major : ROAD.minor);
    }
    const white = { color: 0xffffff, alpha: 0.9 };
    for (const [x, y, w, h, t] of rects) {
      const horiz = w > h;
      if (t >= 2) {
        // 大通り：中央の二重線、車線の破線、はしの横断歩道
        const hw = (horiz ? h : w) / 2;
        if (horiz) {
          g.rect(x + hw + 22, y + hw - 1.1, w - hw * 2 - 44, 0.7).fill(white).rect(x + hw + 22, y + hw + 0.4, w - hw * 2 - 44, 0.7).fill(white);
          for (let q = x + hw + 24; q < x + w - hw - 30; q += 15) g.rect(q, y + hw / 2 - 0.3, 7, 0.6).fill({ color: 0xffffff, alpha: 0.7 }).rect(q, y + hw * 1.5 - 0.3, 7, 0.6).fill({ color: 0xffffff, alpha: 0.7 });
          if (t === 2) for (let k = 0; k < 7; k++) g.rect(x + hw + 12, y + 2 + (k * (h - 4)) / 7, 6, (h - 4) / 7 - 1.7).fill(white).rect(x + w - hw - 18, y + 2 + (k * (h - 4)) / 7, 6, (h - 4) / 7 - 1.7).fill(white);
        } else {
          g.rect(x + hw - 1.1, y + hw + 22, 0.7, h - hw * 2 - 44).fill(white).rect(x + hw + 0.4, y + hw + 22, 0.7, h - hw * 2 - 44).fill(white);
          for (let q = y + hw + 24; q < y + h - hw - 30; q += 15) g.rect(x + hw / 2 - 0.3, q, 0.6, 7).fill({ color: 0xffffff, alpha: 0.7 }).rect(x + hw * 1.5 - 0.3, q, 0.6, 7).fill({ color: 0xffffff, alpha: 0.7 });
          if (t === 2) for (let k = 0; k < 7; k++) g.rect(x + 2 + (k * (w - 4)) / 7, y + hw + 12, (w - 4) / 7 - 1.7, 6).fill(white).rect(x + 2 + (k * (w - 4)) / 7, y + h - hw - 18, (w - 4) / 7 - 1.7, 6).fill(white);
        }
        if (t === 3) {
          // 橋：らんかん
          if (horiz) g.rect(x, y + 0.6, w, 1.3).fill(0x8f6a35).rect(x, y + h - 1.9, w, 1.3).fill(0x8f6a35);
        } else if (horiz) {
          for (let q = x + 34; q < x + w - 34; q += 34) {
            this.tree(g, q, y - 4.4, 2.7);
            this.tree(g, q + 17, y + h + 4.4, 2.7);
          }
        } else {
          for (let q = y + 34; q < y + h - 34; q += 34) {
            this.tree(g, x - 4.4, q, 2.7);
            this.tree(g, x + w + 4.4, q + 17, 2.7);
          }
        }
      } else {
        // 細い道：両はしの横断歩道と、止まれの線
        const n = 4;
        const bar = { color: 0xd3cec2, alpha: 0.95 };
        if (horiz) {
          for (let k = 0; k < n; k++) g.rect(x + 20, y + 2 + (k * (h - 4)) / n, 5, (h - 4) / n - 1.6).fill(bar).rect(x + w - 25, y + 2 + (k * (h - 4)) / n, 5, (h - 4) / n - 1.6).fill(bar);
          g.rect(x + 28, y + h / 2, 0.8, h / 2 - 1.5).fill(bar).rect(x + w - 29, y + 1.5, 0.8, h / 2 - 1.5).fill(bar);
        } else {
          for (let k = 0; k < n; k++) g.rect(x + 2 + (k * (w - 4)) / n, y + 20, (w - 4) / n - 1.6, 5).fill(bar).rect(x + 2 + (k * (w - 4)) / n, y + h - 25, (w - 4) / n - 1.6, 5).fill(bar);
          g.rect(x + 1.5, y + 28, w / 2 - 1.5, 0.8).fill(bar).rect(x + w / 2, y + h - 29, w / 2 - 1.5, 0.8).fill(bar);
        }
      }
    }
    return g;
  }

  private carView(c: Car) {
    let v = this.carViews.get(c.id);
    if (v) return v;
    const box = new Container();
    const ring = new Graphics().circle(0, 0, 4.4).stroke({ width: 0.7, color: 0xffc94a });
    const g = new Graphics();
    let light: Graphics | null = null;
    if (c.bike) {
      g.roundRect(-1.6, -0.35, 3.2, 0.7, 0.3).fill(c.color).circle(-1.5, 0, 0.6).fill(0x1b2330).circle(1.5, 0, 0.6).fill(0x1b2330).circle(0, 0, 0.9).fill(0x1b2330);
    } else {
      g.roundRect(-2.0, -0.8, 4.8, 2.5, 0.7).fill({ color: 0x1b2330, alpha: 0.22 });
      g.roundRect(-2.3, -1.1, 4.6, 2.2, 0.6).fill(c.color);
      g.roundRect(-1.1, -0.92, 2.2, 1.84, 0.4).fill(mix(c.color, 0x1b2330, c.kind === 'police' ? 0.75 : 0.28));
      g.rect(0.9, -0.85, 0.5, 1.7).fill({ color: 0xcfe6f5, alpha: 0.9 }).rect(-1.4, -0.85, 0.35, 1.7).fill({ color: 0xcfe6f5, alpha: 0.6 });
      g.rect(2.05, -0.95, 0.25, 0.5).fill(0xfff3c4).rect(2.05, 0.45, 0.25, 0.5).fill(0xfff3c4).rect(-2.3, -0.95, 0.2, 0.5).fill(0xd9463c).rect(-2.3, 0.45, 0.2, 0.5).fill(0xd9463c);
      if (c.kind === 'police') {
        g.rect(1.5, -1.1, 0.8, 2.2).fill(0x1b2330).rect(-2.3, -1.1, 0.9, 2.2).fill(0x1b2330);
        light = new Graphics().rect(-0.25, -0.8, 0.5, 0.75).fill(0xff3b30).rect(-0.25, 0.05, 0.5, 0.75).fill(0x2f6bff);
      } else if (c.kind === 'hunter') g.rect(-2.3, -0.2, 4.6, 0.4).fill(0xc43a3a);
    }
    box.addChild(ring, g);
    if (light) box.addChild(light);
    box.scale.set(2.8);
    box.position.set(c.x, c.y);
    this.carLayer.addChild(box);
    v = { box, light, ring };
    this.carViews.set(c.id, v);
    return v;
  }

  private frame(dt: number) {
    const s = this.get();
    const c = this.city;
    const W = this.app.screen.width;
    const H = this.app.screen.height;
    // 遅い端末では、絵の細かさを1段ずつ下げる
    this.frames++;
    if (this.frames > 20 && dt > 0.034) this.slow++;
    if (this.frames % 30 === 0) {
      if (this.slow >= 15 && this.res > 1) {
        this.res = Math.max(1, this.res - 0.5);
        this.app.renderer.resolution = this.res;
        this.app.resize();
      }
      this.slow = 0;
    }
    const car = riding(s);
    const speed = car ? Math.abs(car.v) : 0;
    const want = car ? (car.bike ? 1.55 : 1.4 - (speed / this.bal.move.car) * 0.4) : 1.75;
    this.zoom += (want - this.zoom) * (1 - Math.exp(-dt * 2.2));
    const k = 1 - Math.exp(-dt * 14);
    const lead = car ? 0.55 : 0;
    this.camX += (s.x + Math.cos(s.a) * speed * lead - this.camX) * k;
    this.camY += (s.y + Math.sin(s.a) * speed * lead - this.camY) * k;
    if (Math.hypot(s.x - this.camX, s.y - this.camY) > 400) {
      this.camX = s.x;
      this.camY = s.y;
    }
    const z = this.zoom;
    this.world.scale.set(z);
    this.world.position.set(W / 2 - this.camX * z, H * 0.54 - this.camY * z);
    this.glowWorld.scale.set(z);
    this.glowWorld.position.copyFrom(this.world.position);
    const x0 = this.camX - W / 2 / z;
    const x1 = this.camX + W / 2 / z;
    const y0 = this.camY - (H * 0.54) / z;
    const y1 = this.camY + (H * 0.46) / z;

    // 見えている「ます」を用意する（1コマに作るのは2つまで）
    let built = 0;
    const need = new Set<string>();
    for (let cy = Math.floor((y0 - 200) / CH); cy <= Math.floor((y1 + 200) / CH); cy++) for (let cx = Math.floor((x0 - 200) / CH); cx <= Math.floor((x1 + 200) / CH); cx++) {
      const key = `${cx},${cy}`;
      need.add(key);
      if (!this.chunks.has(key) && built < 1) {
        const g = this.buildChunk(cx, cy);
        this.chunkLayer.addChild(g);
        this.chunks.set(key, g);
        built++;
      }
    }
    for (const [key, g] of this.chunks) g.visible = need.has(key);
    if (this.chunks.size > 30) for (const [key, g] of this.chunks) if (!need.has(key) && this.chunks.size > 20) {
      g.destroy();
      this.chunks.delete(key);
    }

    // 道案内の線
    const rk = s.way ? `${s.route.length}:${s.route[1] ?? 0}:${Math.round(s.x / 6)}:${Math.round(s.y / 6)}` : '';
    if (rk !== this.routeKey) {
      this.routeKey = rk;
      const g = this.routeG;
      g.clear();
      if (s.way) {
        g.moveTo(s.x, s.y);
        for (let i = 1; i < s.route.length; i++) g.lineTo(...nodeXY(c, s.route[i]));
        g.lineTo(s.way[0], s.way[1]).stroke({ width: 3.2, color: 0x2f7bff, alpha: 0.75, cap: 'round', join: 'round' });
        g.circle(s.way[0], s.way[1], 6).fill({ color: 0x2f7bff, alpha: 0.3 }).circle(s.way[0], s.way[1], 2.4).fill(0x2f7bff);
      }
    }

    // 場所の印：画面の上では、いつも同じ大きさ
    const pinScale = 30 / 72 / z;
    for (const sp of this.labels) sp.visible = sp.x > x0 - 300 && sp.x < x1 + 300 && sp.y > y0 - 100 && sp.y < y1 + 100;
    const day = Math.floor(s.clock / 1440);
    c.pois.forEach((p, i) => {
      const sp = this.pinSprites[i];
      const vis = p.x > x0 - 30 && p.x < x1 + 30 && p.y > y0 - 30 && p.y < y1 + 60 && (p.kind !== 'house' || (s.crowbar && (s.cool[p.id] ?? 0) <= day));
      sp.visible = vis;
      if (!vis) return;
      sp.scale.set(pinScale);
      if (p.kind === 'lot') sp.texture = s.biz.some((b) => b.poi === p.id) ? this.pinTex.biz : this.pinTex.lot;
    });

    // 車
    const st = stars(s, this.bal);
    const live = new Set<number>();
    const blink = Math.floor(performance.now() / 260) % 2 === 0;
    const h = hourOf(s);
    const dark = Math.max(smooth(17.5, 19.5, h), 1 - smooth(4.8, 6.5, h));
    let gi = 0;
    const glow = (x: number, y: number, size: number, color: number, alpha: number) => {
      let sp = this.glowPool[gi];
      if (!sp) {
        sp = new Sprite(this.glowTex);
        sp.anchor.set(0.5);
        sp.blendMode = 'add';
        this.glows.addChild(sp);
        this.glowPool.push(sp);
      }
      gi++;
      sp.visible = true;
      sp.position.set(x, y);
      sp.scale.set(size / 64);
      sp.tint = color;
      sp.alpha = alpha;
    };
    for (const cr of s.cars) {
      live.add(cr.id);
      const v = this.carView(cr);
      const mine = cr.id === s.ride;
      const kk = mine ? 1 : 1 - Math.exp(-dt * 16);
      v.box.x += (cr.x - v.box.x) * kk;
      v.box.y += (cr.y - v.box.y) * kk;
      v.box.rotation = cr.a;
      v.ring.visible = mine || (cr.kind === 'mine' && s.ride === null);
      if (v.light) v.light.alpha = cr.chase && st > 0 ? (blink ? 1 : 0.25) : 0.6;
      if (cr.x < x0 - 20 || cr.x > x1 + 20 || cr.y < y0 - 20 || cr.y > y1 + 20) continue;
      if (dark > 0.25 && !cr.bike && cr.kind !== 'parked') glow(cr.x + Math.cos(cr.a) * 9, cr.y + Math.sin(cr.a) * 9, 26, 0xffe2a0, dark * 0.75);
      if (cr.chase && st > 0) glow(cr.x, cr.y, 44, blink ? 0xff4038 : 0x3a6bff, 0.55);
    }
    for (const [id, v] of this.carViews) if (!live.has(id)) {
      v.box.destroy({ children: true });
      this.carViews.delete(id);
    }
    if (dark > 0.25 && !car) glow(s.x, s.y, 46, 0xfff0c8, dark * 0.45);
    if (dark > 0.25) {
      const NX = c.xs.length;
      for (let j = 0; j < c.ys.length; j++) {
        if (c.ys[j] < y0 - 30 || c.ys[j] > y1 + 30) continue;
        for (let i = 0; i < NX; i++) {
          if (c.xs[i] < x0 - 30 || c.xs[i] > x1 + 30 || !c.ok[j * NX + i]) continue;
          glow(c.xs[i], c.ys[j], c.ax[i] || c.ay[j] ? 90 : 56, 0xffcf8a, dark * 0.5);
        }
      }
    }
    for (let i = gi; i < this.glowPool.length; i++) this.glowPool[i].visible = false;

    // 歩く人
    const pg = this.pedG;
    pg.clear();
    for (const p of s.peds) {
      if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
      pg.circle(p.x, p.y + 0.5, 2.3).fill({ color: 0x1b2330, alpha: 0.18 }).circle(p.x, p.y, 2.1).fill(p.color).circle(p.x, p.y - 0.2, 1.05).fill(0xf6d2b0);
    }

    // 自分
    this.me.visible = !car;
    this.me.position.set(s.x, s.y);
    this.me.rotation = s.a;
    this.me.scale.set(2.6);

    // 夜：全体を青く暗くする
    this.night.clear();
    if (dark > 0.02) this.night.rect(0, 0, W, H).fill({ color: 0x0b1433, alpha: dark * 0.56 });
  }
}
