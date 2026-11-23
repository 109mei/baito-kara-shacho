import { describe, expect, it } from 'vitest';
import { findPath, makeCity, nearestNode, solid, wet } from '../src/core/city';
import { apply, createGame, fromSave, poiActions, stars, step, toSave } from '../src/core/sim';
import { balance as b } from '../src/data/schema';

const city = makeCity(20261123, b);
const run = (s: ReturnType<typeof createGame>, n: number, mx = 0, my = 0) => {
  for (let i = 0; i < n; i++) step(s, city, { mx, my }, b);
};

describe('街', () => {
  it('同じ種なら同じ街になる', () => {
    const c2 = makeCity(20261123, b);
    expect(c2.xs).toEqual(city.xs);
    expect(c2.pois.map((p) => [p.kind, Math.round(p.x), Math.round(p.y)])).toEqual(city.pois.map((p) => [p.kind, Math.round(p.x), Math.round(p.y)]));
  });
  it('広さと中身：道・区画・場所がそろっている', () => {
    expect(city.size).toBe(8000);
    expect(city.xs.length).toBeGreaterThan(35);
    expect(city.blocks.filter((k) => k.b.length > 0).length).toBeGreaterThan(900);
    for (const kind of ['home', 'conbini', 'warehouse', 'bike', 'car', 'tool', 'pawn', 'chop', 'bank', 'police', 'lot', 'atm', 'house'] as const) {
      expect(city.pois.filter((p) => p.kind === kind).length, kind).toBeGreaterThan(0);
    }
    expect(city.bridges.length).toBeGreaterThan(3);
  });
  it('どの場所も、自宅から道をたどって行ける。立てる所にある', () => {
    const from = nearestNode(city, city.home.x, city.home.y);
    for (const p of city.pois) {
      const to = nearestNode(city, p.x, p.y);
      const path = findPath(city, from, to);
      expect(path[path.length - 1], `${p.kind} ${p.id}`).toBe(to);
      expect(solid(city, p.x, p.y, 1.4), `${p.kind} ${p.id}`).toBe(false);
    }
  });
  it('川は橋の上だけ渡れる', () => {
    const y = city.bridges[0];
    expect(wet(city, city.river(y), y)).toBe(false);
    expect(wet(city, city.river(y + 200), y + 200)).toBe(true);
  });
});

describe('ルール', () => {
  it('同じ種と同じ操作なら、同じ結果になる', () => {
    const a = createGame(7, city, b);
    const c = createGame(7, city, b);
    run(a, 900, 1, 0.2);
    run(c, 900, 1, 0.2);
    expect(toSave(a)).toEqual(toSave(c));
    expect(a.cars.length).toBe(c.cars.length);
  });
  it('歩ける。建物と水は通れない', () => {
    const s = createGame(7, city, b);
    const x0 = s.x;
    run(s, 60, 1, 0);
    expect(s.x).toBeGreaterThan(x0 + 5);
    for (let i = 0; i < 3000; i++) step(s, city, { mx: -1, my: 0 }, b);
    expect(wet(city, s.x, s.y)).toBe(false);
    expect(solid(city, s.x, s.y, 1)).toBe(false);
  });
  it('はたらくとお金が入り、時間が進む', () => {
    const s = createGame(7, city, b);
    const job = city.pois.find((p) => p.kind === 'conbini')!;
    s.x = job.x;
    s.y = job.y;
    const clock = s.clock;
    apply(s, city, { type: 'poi', id: job.id, act: 'work' }, b);
    expect(s.cash).toBe(b.money.startCash + b.money.wageConbini * b.money.shiftHours);
    expect(s.clock).toBe(clock + b.money.shiftHours * 60);
  });
  it('車を盗むと手配度が上がり、見られていなければ下がる', () => {
    const s = createGame(7, city, b);
    run(s, 300);
    const car = s.cars.find((c) => c.kind === 'parked' || c.kind === 'npc')!;
    expect(car).toBeTruthy();
    s.x = car.x + 2;
    s.y = car.y;
    car.v = 0;
    s.cars = s.cars.filter((c) => c.kind !== 'police');
    apply(s, city, { type: 'ride' }, b);
    expect(s.ride).toBe(car.id);
    expect(s.heat).toBeGreaterThan(0);
    s.cars = [car];
    s.spawnT = 9999;
    run(s, 30 * 20);
    expect(s.heat).toBe(0);
  });
  it('強盗すると星4以上になり、捕まると罰金と没収で警察署から出る', () => {
    const s = createGame(7, city, b);
    const bank = city.pois.find((p) => p.kind === 'bank')!;
    s.x = bank.x;
    s.y = bank.y;
    apply(s, city, { type: 'poi', id: bank.id, act: 'rob' }, b);
    expect(stars(s, b)).toBeGreaterThanOrEqual(4);
    expect(s.dirty).toBeGreaterThanOrEqual(b.crime.robMin);
    let busted = false;
    for (let i = 0; i < 30 * 120 && !busted; i++) busted = step(s, city, { mx: 0, my: 0 }, b).some((e) => e.type === 'busted');
    expect(busted).toBe(true);
    expect(s.dirty).toBe(0);
    expect(s.heat).toBe(0);
    expect(s.record).toBe(1);
    expect(city.pois.some((p) => p.kind === 'police' && Math.hypot(p.x - s.x, p.y - s.y) < 10)).toBe(true);
  });
  it('事業は、きれいなお金でだけ始められ、1日の終わりに利益が入り、汚れたお金がきれいになる', () => {
    const s = createGame(7, city, b);
    const lot = city.pois.find((p) => p.kind === 'lot')!;
    s.x = lot.x;
    s.y = lot.y;
    s.dirty = 500000;
    s.cash = 1000;
    expect(poiActions(s, city, lot, b).find((a) => a.id === 'stall')!.ok).toBe(false);
    s.cash = b.biz.stall;
    apply(s, city, { type: 'poi', id: lot.id, act: 'stall' }, b);
    expect(s.biz.length).toBe(1);
    const bank = s.bank;
    s.x = city.home.x;
    s.y = city.home.y;
    apply(s, city, { type: 'poi', id: city.home.id, act: 'sleep' }, b);
    expect(s.bank).toBeGreaterThan(bank);
    expect(s.dirty).toBeLessThan(500000);
  });
  it('保存して読み込んでも、中身が変わらない', () => {
    const s = createGame(7, city, b);
    run(s, 200, 0.5, 1);
    s.cash = 123456;
    s.crowbar = true;
    const d = JSON.parse(JSON.stringify(toSave(s)));
    expect(toSave(fromSave(d, city, b))).toEqual(toSave(s));
  });
  it('でたらめに動き回っても止まらない', () => {
    const s = createGame(99, city, b);
    let k = 0;
    for (let i = 0; i < 30 * 240; i++) {
      if (i % 45 === 0) k = (k * 7 + 3) % 8;
      const a = (k / 8) * Math.PI * 2;
      step(s, city, { mx: Math.cos(a), my: Math.sin(a) }, b);
      if (i % 200 === 0) apply(s, city, { type: 'ride' }, b);
    }
    expect(Number.isFinite(s.x + s.y + s.cash + s.heat)).toBe(true);
  });
});
