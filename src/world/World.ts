// 街の絵（PixiJS）。ルール本体の写しを読んで描くだけで、状態は持たない。
// 文字は描かない（文字は HTML 側に置く）。タッチも受け取らない。
import 'pixi.js/unsafe-eval'; // 実行時にコードを組み立てない版（制限の強い場所でも絵が出るように）
import { Application, Container, Graphics } from 'pixi.js';
import type { Slot } from '../core/types';

export const WORLD_W = 390;
export const WORLD_H = 218;

export type PlaceKey = 'home' | 'job' | 'mats' | 'market' | 'c1' | 'c2' | 'tool' | 'c3';
export const PLACES: Record<PlaceKey, { x: number; y: number; label: string; color: number }> = {
  home: { x: 58, y: 40, label: '自宅', color: 0x1d7a63 },
  job: { x: 186, y: 36, label: 'バイト先', color: 0x5b6b7a },
  mats: { x: 322, y: 40, label: '材料の店', color: 0x8a8f3a },
  market: { x: 58, y: 108, label: '売り場', color: 0xc2507a },
  c1: { x: 186, y: 108, label: '客先', color: 0x2f7fc1 },
  c2: { x: 322, y: 108, label: '', color: 0x2f7fc1 },
  tool: { x: 58, y: 174, label: '道具の店', color: 0x9a6b3f },
  c3: { x: 186, y: 174, label: '', color: 0x2f7fc1 },
};

export interface WorldView {
  slots: Slot[]; // 今日の時間割
  running: boolean; // 早送り中
}

const ROAD_H = [74, 142];
const ROAD_V = [122, 254];

function placeOf(slot: Slot, i: number): PlaceKey {
  if (slot === 'job') return 'job';
  if (slot === 'handy') return (['c1', 'c2', 'c3'] as PlaceKey[])[i % 3];
  if (slot === 'sell') return 'market';
  if (slot === 'shop') return 'mats';
  return 'home';
}

export class World {
  private app = new Application();
  private root = new Container();
  private glow = new Graphics();
  private player = new Graphics();
  private walkers: { g: Graphics; horizontal: boolean; line: number; pos: number; speed: number }[] = [];
  private view: WorldView = { slots: [], running: false };
  private clock = 0;
  private px = PLACES.home.x;
  private py = PLACES.home.y + 16;
  private dead = false;
  ok = false;

  async init(el: HTMLElement): Promise<boolean> {
    try {
      await this.app.init({
        resizeTo: el, backgroundAlpha: 0, antialias: true, autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2), preference: 'webgl',
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
    this.app.stage.addChild(this.root);
    this.drawStatic();
    this.root.addChild(this.glow);
    this.makeWalkers();
    this.player.circle(0, 0, 7).fill(0x1c2530).circle(0, 0, 7).stroke({ width: 2.5, color: 0xffffff }).circle(0, 0, 2.5).fill(0xffffff);
    this.root.addChild(this.player);
    this.app.ticker.add((tk) => this.tick(tk.deltaMS / 1000));
    this.ok = true;
    return true;
  }

  setView(v: WorldView) {
    this.view = v;
  }

  destroy() {
    this.dead = true;
    if (this.ok) this.app.destroy(true, { children: true });
  }

  private drawStatic() {
    const g = new Graphics();
    g.roundRect(0, 0, WORLD_W, WORLD_H, 14).fill(0xe7e2d3);
    // 区画（道の間の地面）
    const xs = [8, ROAD_V[0] + 9, ROAD_V[1] + 9];
    const ws = [ROAD_V[0] - 17, ROAD_V[1] - ROAD_V[0] - 18, WORLD_W - ROAD_V[1] - 17];
    const ys = [8, ROAD_H[0] + 9, ROAD_H[1] + 9];
    const hs = [ROAD_H[0] - 17, ROAD_H[1] - ROAD_H[0] - 18, WORLD_H - ROAD_H[1] - 17];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) g.roundRect(xs[i], ys[j], ws[i], hs[j], 8).fill(0xf3efe4);
    // 道
    for (const y of ROAD_H) g.rect(0, y - 6, WORLD_W, 12).fill(0xfbf9f3);
    for (const x of ROAD_V) g.rect(x - 6, 0, 12, WORLD_H).fill(0xfbf9f3);
    for (const y of ROAD_H) for (let x = 6; x < WORLD_W; x += 16) g.rect(x, y - 0.6, 7, 1.2).fill(0xd9d3c4);
    for (const x of ROAD_V) for (let y = 6; y < WORLD_H; y += 16) g.rect(x - 0.6, y, 1.2, 7).fill(0xd9d3c4);
    // 公園
    g.roundRect(xs[2] + 6, ys[2] + 6, ws[2] - 12, hs[2] - 12, 8).fill(0xcfe3c1);
    for (const [tx, ty] of [[290, 168], [318, 182], [346, 166], [362, 184]]) g.circle(tx, ty, 7).fill(0x8fbf7f).circle(tx - 2, ty - 2, 3).fill(0xa9d19a);
    this.root.addChild(g);
    // 建物
    for (const key of Object.keys(PLACES) as PlaceKey[]) {
      const p = PLACES[key];
      const b = new Graphics();
      const w = key === 'job' ? 62 : 50;
      const h = 34;
      b.roundRect(p.x - w / 2 + 2, p.y - h / 2 + 3, w, h, 6).fill({ color: 0x000000, alpha: 0.08 });
      b.roundRect(p.x - w / 2, p.y - h / 2, w, h, 6).fill(0xffffff);
      b.roundRect(p.x - w / 2, p.y - h / 2, w, 11, 6).fill(p.color);
      b.rect(p.x - w / 2, p.y - h / 2 + 6, w, 5).fill(p.color);
      for (let i = 0; i < 3; i++) b.roundRect(p.x - w / 2 + 7 + i * ((w - 14 - 8) / 2), p.y - 1, 8, 8, 2).fill({ color: p.color, alpha: 0.28 });
      this.root.addChild(b);
    }
  }

  private makeWalkers() {
    const colors = [0x9aa3ab, 0xb9a48a, 0x8fa9b8, 0xb58fa0];
    for (let i = 0; i < 10; i++) {
      const horizontal = i % 2 === 0;
      const g = new Graphics().circle(0, 0, 2.6).fill(colors[i % colors.length]);
      const w = { g, horizontal, line: i % 4 < 2 ? 0 : 1, pos: (i * 47) % (horizontal ? WORLD_W : WORLD_H), speed: (i % 3 === 0 ? -1 : 1) * (9 + (i % 4) * 3) };
      this.walkers.push(w);
      this.root.addChild(g);
    }
  }

  private tick(dt: number) {
    const scale = this.app.screen.width / WORLD_W;
    this.root.scale.set(scale);
    this.root.y = Math.max(0, (this.app.screen.height - WORLD_H * scale) / 2);
    for (const w of this.walkers) {
      const max = w.horizontal ? WORLD_W : WORLD_H;
      w.pos = (w.pos + w.speed * dt + max) % max;
      const side = w.speed > 0 ? 3 : -3;
      if (w.horizontal) w.g.position.set(w.pos, ROAD_H[w.line] + side);
      else w.g.position.set(ROAD_V[w.line] + side, w.pos);
    }
    // 自分の印は、今日の時間割の順に建物を回る
    const slots = this.view.slots;
    this.clock += dt * (this.view.running ? 6 : 1.6);
    const n = Math.max(1, slots.length);
    const i = Math.floor(this.clock) % n;
    const key = slots.length ? placeOf(slots[i], Math.floor(this.clock / n)) : 'home';
    const target = PLACES[key];
    const tx = target.x;
    const ty = target.y + 24;
    const k = 1 - Math.exp(-dt * 5);
    this.px += (tx - this.px) * k;
    this.py += (ty - this.py) * k;
    this.player.position.set(this.px, this.py);
    this.glow.clear();
    const pulse = 0.5 + 0.5 * Math.sin(this.clock * 3);
    this.glow.roundRect(target.x - 30, target.y - 21, 60, 42, 9).stroke({ width: 2, color: target.color, alpha: 0.25 + 0.35 * pulse });
  }
}
