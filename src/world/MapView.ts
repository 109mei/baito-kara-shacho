// 街の絵（PixiJS）。地図の見た目で、すべてコードで描く。
// ルール本体の状態を毎コマ読んで描くだけで、状態は書き換えない。タッチも受け取らない。
// 広い街は 800m 四方の「ます」に分け、見えている所だけ作って描く。
import 'pixi.js/unsafe-eval';
import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { nodeXY, type City, type District, type PoiKind } from '../core/city';
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
      await this.app.init({ resizeTo: el, background: 0xe4e0d6, antialias: true, autoDensity: true, resolution: this.res, preference: 'webgl' });
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
    this.me.addChild(new Graphics().circle(0, 0, 2.5).fill({ color: 0xffffff, alpha: 0.95 }).circle(0, 0, 1.6).fill(0x1b2330).poly([2.2, 0, 0.6, -1.1, 0.6, 1.1]).fill(0xffc94a));
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

  private drawWater(g: Graphics) {
    const S = this.city.size;
    const sea: number[] = [-3000, -400];
    for (let y = -400; y <= S + 400; y += 80) sea.push(this.city.coast(y), y);
    sea.push(-3000, S + 400);
    g.poly(sea).fill(WATER);
    const left: number[] = [];
    const right: number[] = [];
    for (let y = -400; y <= S + 400; y += 60) {
      left.push(this.city.river(y) - this.bal.world.riverHalf, y);
      right.unshift(this.city.river(y) + this.bal.world.riverHalf, y);
    }
    const poly = [...left];
    for (let k = 0; k < right.length; k += 2) poly.push(right[k], right[k + 1]);
    g.poly(poly).fill(WATER);
  }

  private buildChunk(cx: number, cy: number): Graphics {
    const c = this.city;
    const g = new Graphics();
    const NX = c.xs.length;
    const NY = c.ys.length;
    const inChunk = (x: number, y: number) => Math.floor(x / CH) === cx && Math.floor(y / CH) === cy;
    // 区画と建物
    for (const b of c.blocks) {
      if (b.d === 'water' || !inChunk((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2)) continue;
      const l = c.half(c.ax[b.i]) + 1.5;
      const r = c.half(c.ax[b.i + 1]) + 1.5;
      const t = c.half(c.ay[b.j]) + 1.5;
      const bt = c.half(c.ay[b.j + 1]) + 1.5;
      g.roundRect(b.x0 + l, b.y0 + t, b.x1 - b.x0 - l - r, b.y1 - b.y0 - t - bt, 3).fill(BLOCK[b.d]);
      if (b.d === 'park') {
        let h = (b.i * 73856093) ^ (b.j * 19349663);
        for (let k = 0; k < 14; k++) {
          h = (Math.imul(h, 1103515245) + 12345) >>> 0;
          const tx = b.x0 + l + 8 + ((h >>> 8) % 1000) / 1000 * (b.x1 - b.x0 - l - r - 16);
          h = (Math.imul(h, 1103515245) + 12345) >>> 0;
          const ty = b.y0 + t + 8 + ((h >>> 8) % 1000) / 1000 * (b.y1 - b.y0 - t - bt - 16);
          g.circle(tx, ty, 4 + (h % 4)).fill(0xa9d79c);
        }
        continue;
      }
      const deep = b.d === 'downtown' ? 0.07 : 0;
      const wall = mix(BLOCK[b.d], 0x6b6257, 0.24 + deep);
      const roof = mix(BLOCK[b.d], 0x6b6257, 0.12 + deep);
      for (let k = 0; k < b.b.length; k += 4) {
        const tone = ((k * 7 + b.i * 3 + b.j * 5) % 5) * 0.022; // 建物ごとに、少しだけ濃さを変える
        g.rect(b.b[k], b.b[k + 1], b.b[k + 2], b.b[k + 3]).fill(wall);
        g.rect(b.b[k] + 0.9, b.b[k + 1] + 0.9, b.b[k + 2] - 1.8, b.b[k + 3] - 2.6).fill(mix(roof, tone > 0.07 ? 0x8fa3b8 : 0x6b6257, tone));
      }
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
    for (const major of [false, true]) {
      for (const [x, y, w, h, t] of rects) if (t >= 2 === major) g.rect(x - 1.6, y - 1.6, w + 3.2, h + 3.2).fill(t === 3 ? 0xa9783a : major ? ROAD.majorEdge : ROAD.minorEdge);
      for (const [x, y, w, h, t] of rects) if (t >= 2 === major) g.rect(x, y, w, h).fill(major ? ROAD.major : ROAD.minor);
    }
    for (const [x, y, w, h, t] of rects) if (t >= 2) {
      if (w > h) for (let q = x + 22; q < x + w - 26; q += 14) g.rect(q, y + h / 2 - 0.5, 8, 1).fill({ color: 0xffffff, alpha: 0.85 });
      else for (let q = y + 22; q < y + h - 26; q += 14) g.rect(x + w / 2 - 0.5, q, 1, 8).fill({ color: 0xffffff, alpha: 0.85 });
    }
    for (const [x, y, w, h, t] of rects) {
      if (t === 2) {
        // 街路樹：大通りの両わきに、間をあけて
        if (w > h) for (let q = x + 30; q < x + w - 30; q += 34) g.circle(q, y - 4, 2.6).fill(0x9fd08f).circle(q + 17, y + h + 4, 2.6).fill(0x9fd08f);
        else for (let q = y + 30; q < y + h - 30; q += 34) g.circle(x - 4, q, 2.6).fill(0x9fd08f).circle(x + w + 4, q + 17, 2.6).fill(0x9fd08f);
      } else if (t === 1) {
        // 横断歩道：細い道の両はし
        const n = 4;
        if (w > h) for (let k = 0; k < n; k++) g.rect(x + 20, y + 2 + (k * (h - 4)) / n, 5, (h - 4) / n - 1.6).fill({ color: 0xd9d4c8, alpha: 0.9 }).rect(x + w - 25, y + 2 + (k * (h - 4)) / n, 5, (h - 4) / n - 1.6).fill({ color: 0xd9d4c8, alpha: 0.9 });
        else for (let k = 0; k < n; k++) g.rect(x + 2 + (k * (w - 4)) / n, y + 20, (w - 4) / n - 1.6, 5).fill({ color: 0xd9d4c8, alpha: 0.9 }).rect(x + 2 + (k * (w - 4)) / n, y + h - 25, (w - 4) / n - 1.6, 5).fill({ color: 0xd9d4c8, alpha: 0.9 });
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
      g.roundRect(-2.4, -1.25, 4.8, 2.5, 0.7).fill({ color: 0x1b2330, alpha: 0.22 });
      g.roundRect(-2.3, -1.1, 4.6, 2.2, 0.6).fill(c.color);
      g.roundRect(-1.1, -0.92, 2.2, 1.84, 0.4).fill(mix(c.color, 0x1b2330, c.kind === 'police' ? 0.75 : 0.28));
      g.rect(0.9, -0.85, 0.5, 1.7).fill({ color: 0xcfe6f5, alpha: 0.9 });
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
    if (this.frames > 30 && dt > 0.03) this.slow++;
    if (this.frames % 90 === 0) {
      if (this.slow > 45 && this.res > 1) {
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
    for (let cy = Math.floor((y0 - 60) / CH); cy <= Math.floor((y1 + 60) / CH); cy++) for (let cx = Math.floor((x0 - 60) / CH); cx <= Math.floor((x1 + 60) / CH); cx++) {
      const key = `${cx},${cy}`;
      need.add(key);
      if (!this.chunks.has(key) && built < 2) {
        const g = this.buildChunk(cx, cy);
        this.chunkLayer.addChild(g);
        this.chunks.set(key, g);
        built++;
      }
    }
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
