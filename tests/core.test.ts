import { describe, expect, it } from 'vitest';
import { findPath, makeCity, nearestNode, solid, wet } from '../src/core/city';
import { turfOf } from '../src/core/city';
import { blocked, roomOf } from '../src/core/rooms';
import { routesOf, spotInfo, spotShown } from '../src/core/sim';
import { apply, createGame, fromSave, nearSpot, poiActions, roomFor, stars, step, toSave } from '../src/core/sim';
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
    expect(city.pois.filter((p) => p.kind === 'gang').map((p) => turfOf(city.size, p.x, p.y)).sort()).toEqual([0, 1, 2, 3, 4, 5]);
    for (const kind of ['home', 'conbini', 'warehouse', 'bike', 'car', 'tool', 'pawn', 'chop', 'bank', 'police', 'lot', 'atm', 'house', 'hideout', 'gang', 'jewel', 'market', 'office', 'apart'] as const) {
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
    s.clock = 10 * 60;
    s.crowbar = true;
    s.dirty = 400000;
    apply(s, city, { type: 'enter', id: bank.id, route: 'front' }, b);
    s.inside!.x = 1.7;
    s.inside!.y = 5.3;
    apply(s, city, { type: 'heist', i: roomFor(s, city)!.spots.findIndex((sp) => sp.h === 'door' && sp.n === 0) }, b); // バールでこじ開ける→警報
    expect(s.inside!.alarm).toBeGreaterThan(0);
    run(s, 30 * (b.heist.bank.alarm + 1));
    expect(stars(s, b)).toBeGreaterThanOrEqual(4);
    apply(s, city, { type: 'leave' }, b);
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

describe('建物の中', () => {
  it('どの部屋も、入口からすべての行動できる場所へ歩いて行ける', () => {
    for (const kind of ['home', 'conbini', 'warehouse', 'bike', 'car', 'tool', 'pawn', 'bank', 'police', 'lot', 'house', 'hideout', 'gang', 'jewel', 'market', 'office', 'apart'] as const) {
      for (const owned of [false, true]) {
        const room = roomOf(kind, owned)!;
        expect(room, kind).toBeTruthy();
        const step2 = 0.25;
        const key = (x: number, y: number) => `${Math.round(x / step2)},${Math.round(y / step2)}`;
        const seen = new Set<string>();
        const queue: [number, number][] = [[room.w / 2, room.h - 1.7]];
        seen.add(key(queue[0][0], queue[0][1]));
        while (queue.length) {
          const [x, y] = queue.pop()!;
          for (const [dx, dy] of [[step2, 0], [-step2, 0], [0, step2], [0, -step2]]) {
            const nx = x + dx;
            const ny = y + dy;
            if (seen.has(key(nx, ny)) || blocked(room, nx, ny, 0.34)) continue;
            seen.add(key(nx, ny));
            queue.push([nx, ny]);
          }
        }
        for (const sp of room.spots) {
          let ok = false;
          for (const k of seen) {
            const [gx, gy] = k.split(',').map(Number);
            if (Math.hypot(gx * step2 - sp.x, gy * step2 - sp.y) < 1.2) ok = true;
          }
          expect(ok, `${kind} ${owned} ${sp.label}`).toBe(true);
        }
      }
    }
  });
  it('入ると中の画面になり、中を歩けて、出口から出られる', () => {
    const s = createGame(7, city, b);
    const shop = city.pois.find((p) => p.kind === 'conbini')!;
    s.x = shop.x;
    s.y = shop.y;
    apply(s, city, { type: 'enter', id: shop.id }, b);
    expect(s.inside?.poi).toBe(shop.id);
    const y0 = s.inside!.y;
    run(s, 30, 0, -1);
    expect(s.inside!.y).toBeLessThan(y0 - 2);
    const room = roomFor(s, city)!;
    const exit = room.spots.findIndex((sp) => sp.exit);
    s.inside!.x = room.spots[exit].x;
    s.inside!.y = room.spots[exit].y;
    expect(nearSpot(s, city)).toBe(exit);
    apply(s, city, { type: 'leave' }, b);
    expect(s.inside).toBeNull();
  });
  it('留守の家：中の物を盗める。長居すると通報される', () => {
    const s = createGame(7, city, b);
    const house = city.pois.find((p) => p.kind === 'house')!;
    s.x = house.x;
    s.y = house.y;
    apply(s, city, { type: 'enter', id: house.id, hits: 3 }, b);
    expect(s.inside).toBeNull(); // バールがないと入れない
    s.crowbar = true;
    apply(s, city, { type: 'enter', id: house.id, hits: 3 }, b);
    expect(s.inside?.alarm).toBe(b.crime.alarmQuiet);
    const room = roomFor(s, city)!;
    const i = room.spots.findIndex((sp) => sp.loot);
    s.inside!.x = room.spots[i].x;
    s.inside!.y = room.spots[i].y;
    apply(s, city, { type: 'loot', i }, b);
    expect(s.loot).toBeGreaterThan(0);
    const loot = s.loot;
    apply(s, city, { type: 'loot', i }, b);
    expect(s.loot).toBe(loot);
    const heat = s.heat;
    run(s, 30 * (b.crime.alarmQuiet + 1));
    expect(s.heat).toBeGreaterThan(heat + 20);
  });
});

describe('組織・アジト・銃', () => {
  it('見張りを倒すと敵のアジトに入れて、金庫と縄張りが手に入る。縄張りは毎日お金を生む', () => {
    const s = createGame(7, city, b);
    const base = city.pois.find((p) => p.kind === 'gang')!;
    const t = turfOf(city.size, base.x, base.y);
    s.x = base.x;
    s.y = base.y + 60;
    s.gun = true;
    run(s, 40);
    expect(s.thugs.length).toBe(b.gang.guards);
    apply(s, city, { type: 'enter', id: base.id }, b);
    expect(s.inside).toBeNull();
    for (let i = 0; i < 30 * 90 && s.thugs.length; i++) {
      s.hp = 100;
      s.heat = 0;
      apply(s, city, { type: 'fire' }, b);
      step(s, city, { mx: 0, my: 0 }, b);
    }
    expect(s.thugs.length).toBe(0);
    s.x = base.x;
    s.y = base.y;
    apply(s, city, { type: 'enter', id: base.id }, b);
    expect(s.inside?.poi).toBe(base.id);
    const dirty = s.dirty;
    apply(s, city, { type: 'poi', id: base.id, act: 'seize' }, b);
    expect(s.turf[t]).toBe(-1);
    expect(s.dirty).toBeGreaterThanOrEqual(dirty + b.gang.seizeMin);
  });
  it('撃たれて体力がなくなると、現金の一部を失って自宅で目を覚ます', () => {
    const s = createGame(7, city, b);
    const base = city.pois.find((p) => p.kind === 'gang')!;
    s.x = base.x;
    s.y = base.y + 10;
    let down = false;
    for (let i = 0; i < 30 * 120 && !down; i++) down = step(s, city, { mx: 0, my: 0 }, b).some((e) => e.type === 'down');
    expect(down).toBe(true);
    expect(s.cash).toBeLessThan(b.money.startCash);
    expect(s.hp).toBe(100);
    expect(Math.hypot(s.x - city.home.x, s.y - city.home.y)).toBeLessThan(10);
  });
  it('アジトの金庫にしまったお金は、逮捕されても取られない', () => {
    const s = createGame(7, city, b);
    const hide = city.pois.find((p) => p.kind === 'hideout')!;
    s.x = hide.x;
    s.y = hide.y;
    s.dirty = b.gang.hideCost + 300000;
    apply(s, city, { type: 'poi', id: hide.id, act: 'buyHide' }, b);
    expect(s.hide).toBe(hide.id);
    apply(s, city, { type: 'poi', id: hide.id, act: 'stashIn' }, b);
    expect(s.stash).toBe(300000);
    s.heat = 90;
    s.catchT = 99;
    const ev = step(s, city, { mx: 0, my: 0 }, b);
    expect(ev.some((e) => e.type === 'busted')).toBe(true);
    expect(s.stash).toBe(300000);
    expect(toSave(fromSave(JSON.parse(JSON.stringify(toSave(s))), city, b)).stash).toBe(300000);
  });
});

// ---- 強盗：脅す・監視カメラ・入り方・鍵と道具
type G = ReturnType<typeof createGame>;
const setHour = (s: G, h: number) => {
  s.clock = Math.floor(s.clock / 1440) * 1440 + h * 60;
};
const at = (s: G, kind: 'conbini' | 'jewel' | 'bank') => {
  const p = city.pois.find((q) => q.kind === kind)!;
  s.x = p.x;
  s.y = p.y;
  return p;
};
const spotOf = (s: G, h: string, n?: number) => roomFor(s, city)!.spots.findIndex((sp) => sp.h === h && (n === undefined || sp.n === n));
// 部屋の中を、点から点へまっすぐ歩く
const walk = (s: G, path: [number, number][]) => {
  for (const [x, y] of path) {
    let ok = false;
    for (let i = 0; i < 30 * 8 && !ok; i++) {
      const dx = x - s.inside!.x;
      const dy = y - s.inside!.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.2) ok = true;
      else step(s, city, { mx: dx / d, my: dy / d }, b);
    }
    if (!ok) return false;
  }
  return true;
};
// カメラの首振りを見て、映らずに行ける時を待ってから歩く
const sneak = (s: G, path: [number, number][]) => {
  for (let w = 0; w < 30 * 40; w++) {
    const trial = structuredClone(s);
    if (walk(trial, path) && trial.inside!.alarm < 0 && !trial.inside!.filmed) return walk(s, path);
    step(s, city, { mx: 0, my: 0 }, b);
  }
  return false;
};
const heist = (s: G, h: string, n?: number, hits?: number) => apply(s, city, { type: 'heist', i: spotOf(s, h, n), hits }, b);

describe('強盗', () => {
  it('どの店も、扉を開ければ裏口からすべての場所へ歩いて行ける', () => {
    for (const kind of ['jewel', 'bank'] as const) {
      const room = roomOf(kind, false)!;
      const q = 0.25;
      const key = (x: number, y: number) => `${Math.round(x / q)},${Math.round(y / q)}`;
      const seen = new Set<string>([key(room.back!.x, room.back!.y)]);
      const todo: [number, number][] = [[room.back!.x, room.back!.y]];
      while (todo.length) {
        const [x, y] = todo.pop()!;
        for (const [dx, dy] of [[q, 0], [-q, 0], [0, q], [0, -q]]) {
          if (seen.has(key(x + dx, y + dy)) || blocked(room, x + dx, y + dy, 0.34)) continue;
          seen.add(key(x + dx, y + dy));
          todo.push([x + dx, y + dy]);
        }
      }
      for (const sp of room.spots) {
        const ok = [...seen].some((k) => Math.hypot(Number(k.split(',')[0]) * q - sp.x, Number(k.split(',')[1]) * q - sp.y) < 1.2);
        expect(ok, `${kind} ${sp.label}`).toBe(true);
      }
    }
  });
  it('コンビニ：銃がないと脅せない。脅せばレジの金が手に入る。カメラを止めてからだと手配度が低い', () => {
    const rob = (hack: boolean, gun = true) => {
      const s = createGame(7, city, b);
      const p = at(s, 'conbini');
      s.gun = gun;
      s.laptop = true;
      apply(s, city, { type: 'enter', id: p.id }, b);
      if (hack) {
        walk(s, [[6, 7.6], [1.3, 7.7]]);
        heist(s, 'panel', undefined, 3);
        expect(s.inside!.camsOff).toBe(true);
        walk(s, [[6, 7.6], [9.2, 4.2]]);
      } else walk(s, [[9.2, 4.2]]);
      expect(spotShown(s, roomFor(s, city)!, spotOf(s, 'threat'))).toBe(true); // 銃がなくても場所は見える
      expect(spotInfo(s, city, roomFor(s, city)!, spotOf(s, 'threat'), b).ok).toBe(gun); // 押せるのは銃があるときだけ
      heist(s, 'threat');
      run(s, 60);
      heist(s, 'till');
      const got = s.dirty;
      apply(s, city, { type: 'leave' }, b);
      return { got, heat: s.heat };
    };
    expect(rob(false, false).got).toBe(0);
    const loud = rob(false);
    const quiet = rob(true);
    expect(loud.got).toBeGreaterThanOrEqual(b.heist.conbini.min);
    expect(quiet.heat).toBeLessThan(loud.heat);
    expect(quiet.heat).toBeLessThan(b.heat.perStar); // 手薄：うまくやれば星もつかない
  });
  it('入り方：正面は営業中だけ開く。閉店中と裏口は、鍵・ピッキング道具・バールのどれかが要る', () => {
    const s = createGame(7, city, b);
    const p = at(s, 'bank');
    setHour(s, 10);
    expect(routesOf(s, p).map((r) => [r.id, r.ok, r.how])).toEqual([['front', true, 'open'], ['back', false, 'none']]);
    setHour(s, 2);
    expect(routesOf(s, p).every((r) => !r.ok)).toBe(true);
    apply(s, city, { type: 'enter', id: p.id, route: 'front' }, b);
    expect(s.inside).toBeNull();
    s.lockpick = true;
    expect(routesOf(s, p)[1].how).toBe('pick');
    apply(s, city, { type: 'enter', id: p.id, route: 'back', hits: 0 }, b); // ピッキングに失敗：入れるが、警報が鳴る
    expect(s.inside!.alarm).toBeGreaterThan(0);
    apply(s, city, { type: 'leave' }, b);
    expect(s.heat).toBeGreaterThan(0);
    s.heat = 0;
    s.keys.push(p.id);
    expect(routesOf(s, p)[1].how).toBe('key');
    apply(s, city, { type: 'enter', id: p.id, route: 'back' }, b);
    expect(s.inside!.alarm).toBe(-1);
    expect(s.inside!.staff).toBe(false);
    const room = roomFor(s, city)!;
    expect(Math.hypot(s.inside!.x - room.back!.x, s.inside!.y - room.back!.y)).toBeLessThan(0.1);
  });
  it('監視カメラ：視界に立ち続けると見つかる。箱のかげと、カメラの真下は映らない', () => {
    const stand = (x: number, y: number) => {
      const s = createGame(7, city, b);
      const p = at(s, 'bank');
      setHour(s, 2);
      s.keys.push(p.id);
      apply(s, city, { type: 'enter', id: p.id, route: 'back' }, b);
      s.inside!.x = x;
      s.inside!.y = y;
      run(s, 30 * 14);
      return s.inside!;
    };
    expect(stand(6.9, 2.0).alarm).toBeGreaterThanOrEqual(0);
    expect(stand(6.9, 2.0).filmed).toBe(true);
    expect(stand(4.6, 3.3).alarm).toBe(-1); // 箱のかげ
    expect(stand(8.2, 1.3).alarm).toBe(-1); // カメラの真下
    expect(stand(1.0, 1.2).alarm).toBe(-1); // 裏口（カメラが届かない）
  });
  it('金庫と扉：ドリルがないと金庫は破れない。扉は、道具がないと開かない', () => {
    const s = createGame(7, city, b);
    const p = at(s, 'bank');
    setHour(s, 2);
    s.keys.push(p.id);
    apply(s, city, { type: 'enter', id: p.id, route: 'back' }, b);
    s.keys = [];
    const room = roomFor(s, city)!;
    s.inside!.x = 9.1;
    s.inside!.y = 3.1;
    expect(spotInfo(s, city, room, spotOf(s, 'door', 1), b).ok).toBe(false);
    heist(s, 'door', 1);
    expect(s.inside!.open).toEqual([]);
    expect(blocked(room, 9.8, 3.1, 0.34, s.inside!.open)).toBe(true);
    s.lockpick = true;
    heist(s, 'door', 1, 3);
    expect(s.inside!.open).toEqual([1]);
    expect(s.inside!.alarm).toBe(-1);
    s.inside!.camsOff = true;
    s.inside!.guardDown = true;
    walk(s, [[10.5, 3.1], [14.2, 3.6]]);
    heist(s, 'vault');
    expect(s.inside!.drill).toBe(-1);
    s.drill = true;
    heist(s, 'vault');
    expect(s.inside!.drill).toBe(b.heist.bank.drill);
    walk(s, [[10.5, 3.1]]); // 離れると進まない
    run(s, 30 * 12);
    expect(s.dirty).toBe(0);
    walk(s, [[14.2, 3.6]]);
    run(s, 30 * (b.heist.bank.drill + 1));
    expect(s.dirty).toBeGreaterThanOrEqual(b.heist.bank.min);
  });
  it('銀行・夜の静かな仕事：裏口から入り、カメラを止め、机の鍵で扉を開け、警備員を脅してから金庫を破ると、星がつかない', () => {
    const s = createGame(7, city, b);
    const p = at(s, 'bank');
    setHour(s, 2);
    Object.assign(s, { lockpick: true, laptop: true, drill: true, gun: true });
    apply(s, city, { type: 'enter', id: p.id, route: 'back', hits: 3 }, b);
    expect(sneak(s, [[4.6, 3.3]])).toBe(true); // 箱のかげへ
    expect(sneak(s, [[4.6, 3.95], [6.95, 3.95], [8.2, 1.35]])).toBe(true); // カメラの真下へ
    heist(s, 'panel', undefined, 3);
    expect(s.inside!.camsOff).toBe(true);
    expect(walk(s, [[6.95, 3.95], [4.6, 3.95], [4.2, 2.45]])).toBe(true);
    heist(s, 'desk');
    expect(s.keys).toContain(p.id);
    expect(walk(s, [[1.7, 3.9]])).toBe(true);
    heist(s, 'door', 0);
    expect(walk(s, [[1.7, 5.4], [15.3, 5.4], [15.3, 8.4]])).toBe(true); // カウンターの裏を通って、警備員の後ろへ
    heist(s, 'guard');
    expect(s.inside!.guardDown).toBe(true);
    expect(walk(s, [[15.3, 5.4], [1.7, 5.4], [1.7, 3.9], [4.6, 3.95], [6.95, 3.95], [9.1, 3.1]])).toBe(true);
    heist(s, 'door', 1);
    expect(walk(s, [[10.5, 3.1], [14.2, 3.6]])).toBe(true);
    heist(s, 'vault');
    run(s, 30 * (b.heist.bank.drill + 1));
    expect(s.dirty).toBeGreaterThanOrEqual(b.heist.bank.min);
    expect(s.inside!.alarm).toBe(-1);
    expect(s.inside!.filmed).toBe(false);
    apply(s, city, { type: 'leave' }, b);
    expect(s.heat).toBe(b.heist.bank.quiet); // 脅された警備員が、あとで通報するぶんだけ
    expect(stars(s, b)).toBeLessThanOrEqual(1);
    // 同じ銀行は、しばらく警戒していて盗めない
    apply(s, city, { type: 'enter', id: p.id, route: 'back' }, b);
    expect(s.inside!.fresh).toBe(false);
    expect(spotShown(s, roomFor(s, city)!, spotOf(s, 'vault'))).toBe(false);
  });
  it('銀行・昼の強引な仕事：店員を脅すと通報ボタンを押される。金庫までやり切ると星4以上', () => {
    const s = createGame(7, city, b);
    const p = at(s, 'bank');
    setHour(s, 10);
    Object.assign(s, { drill: true, gun: true });
    apply(s, city, { type: 'enter', id: p.id, route: 'front' }, b);
    expect(s.inside!.staff).toBe(true);
    walk(s, [[10.2, 8.0]]);
    heist(s, 'threat');
    expect(s.inside!.held).toBe(true);
    expect(s.inside!.alarm).toBeGreaterThan(0);
    heist(s, 'key');
    walk(s, [[1.7, 8.0], [1.7, 5.3]]);
    heist(s, 'door', 0);
    walk(s, [[1.7, 3.9], [4.6, 3.95], [6.95, 3.95], [9.1, 3.1]]);
    heist(s, 'door', 1);
    walk(s, [[10.5, 3.1], [14.2, 3.6]]);
    heist(s, 'vault');
    run(s, 30 * (b.heist.bank.drill + 1));
    expect(s.dirty).toBeGreaterThanOrEqual(b.heist.bank.min);
    run(s, 30 * 30);
    apply(s, city, { type: 'leave' }, b);
    expect(stars(s, b)).toBeGreaterThanOrEqual(4);
  });
  it('宝石店：鍵があればショーケースは静かに開く。バールで割ると警報が鳴る。奥の部屋へ映らずに行ける道がある', () => {
    const night = (key: boolean) => {
      const s = createGame(7, city, b);
      const p = at(s, 'jewel');
      setHour(s, 2);
      s.keys.push(p.id);
      s.crowbar = true;
      apply(s, city, { type: 'enter', id: p.id, route: 'front' }, b);
      if (!key) s.keys = [];
      s.inside!.camsOff = true;
      walk(s, [[6.2, 7.0]]);
      heist(s, 'case', 1);
      return s;
    };
    expect(night(true).loot).toBeGreaterThanOrEqual(b.heist.jewel.caseMin);
    expect(night(true).inside!.alarm).toBe(-1);
    expect(night(false).inside!.alarm).toBe(b.heist.jewel.alarm);
    const s = createGame(7, city, b);
    const p = at(s, 'jewel');
    setHour(s, 2);
    Object.assign(s, { lockpick: true, laptop: true, drill: true });
    apply(s, city, { type: 'enter', id: p.id, route: 'back', hits: 3 }, b);
    expect(sneak(s, [[11, 2.6], [5.6, 2.9]])).toBe(true); // 箱のかげへ
    expect(sneak(s, [[5.4, 1.6], [3.0, 1.5], [1.35, 1.35]])).toBe(true); // カメラの真下へ
    heist(s, 'panel', undefined, 3);
    expect(walk(s, [[3.0, 1.5], [5.4, 1.6], [5.6, 2.6], [7.15, 2.6]])).toBe(true);
    heist(s, 'vault');
    run(s, 30 * (b.heist.jewel.drill + 1));
    expect(s.dirty).toBeGreaterThanOrEqual(b.heist.jewel.min);
    apply(s, city, { type: 'leave' }, b);
    expect(stars(s, b)).toBe(0);
  });
  it('道具と鍵は、保存して読み込んでも残る', () => {
    const s = createGame(7, city, b);
    Object.assign(s, { lockpick: true, drill: true, keys: [12, 40] });
    const t = fromSave(JSON.parse(JSON.stringify(toSave(s))), city, b);
    expect([t.lockpick, t.drill, t.keys]).toEqual([true, true, [12, 40]]);
  });
});

describe('縄張りの勢力図', () => {
  it('奪ったアジトは拠点になる（寝る・金庫）。見張りとの撃ち合いは、半分ほどの体力で勝てる強さ', () => {
    const left: number[] = [];
    for (let seed = 1; seed <= 12; seed++) {
      const s = createGame(seed, city, b);
      const base = city.pois.find((p) => p.kind === 'gang')!;
      s.x = base.x;
      s.y = base.y + 45;
      s.gun = true;
      run(s, 40);
      let n = 0;
      // 0.5 秒に 1 回ずつ撃つ人（急がない人）で試す
      for (let i = 0; i < 30 * 60 && s.thugs.length && s.hp > 0; i++) {
        if (i % 15 === 0) apply(s, city, { type: 'fire' }, b);
        if (step(s, city, { mx: 0, my: 0 }, b).some((e) => e.type === 'down')) n = -1;
      }
      left.push(n < 0 ? 0 : s.hp);
      if (seed === 1 && n === 0) {
        s.x = base.x;
        s.y = base.y;
        apply(s, city, { type: 'enter', id: base.id }, b);
        apply(s, city, { type: 'poi', id: base.id, act: 'seize' }, b);
        apply(s, city, { type: 'leave' }, b);
        apply(s, city, { type: 'enter', id: base.id }, b);
        expect(poiActions(s, city, base, b).map((a) => a.id)).toEqual(['sleep', 'nap', 'stashIn', 'stashOut']);
        expect(roomFor(s, city)!.spots.some((sp) => sp.acts?.includes('stashIn'))).toBe(true);
      }
    }
    const wins = left.filter((h) => h > 0).length;
    const mid = [...left].sort((a, c) => a - c)[6];
    expect(wins).toBeGreaterThanOrEqual(10);
    expect(mid).toBeGreaterThan(25);
    expect(mid).toBeLessThan(85);
  });
  it('組織どうしが縄張りを奪い合い、勢力図が動く。同じ種なら同じ動きになる', () => {
    const sim = () => {
      const s = createGame(7, city, b);
      const news: string[] = [];
      for (let d = 0; d < 40; d++) {
        s.x = city.home.x;
        s.y = city.home.y;
        for (const e of apply(s, city, { type: 'poi', id: city.home.id, act: 'sleep' }, b)) if (e.type === 'day' && e.news) news.push(e.news);
      }
      return { turf: [...s.turf], news };
    };
    const a = sim();
    expect(a.news.length).toBeGreaterThan(2);
    expect(a.turf).not.toEqual([0, 1, 2, 1, 2, 0]);
    expect(a.turf.every((t) => t >= 0 && t <= 2)).toBe(true);
    expect(sim()).toEqual(a);
  });
  it('夜まで休むと 22 時になる（夜の仕事のため）', () => {
    const s = createGame(7, city, b);
    s.x = city.home.x;
    s.y = city.home.y;
    apply(s, city, { type: 'poi', id: city.home.id, act: 'nap' }, b);
    expect(Math.floor((s.clock % 1440) / 60)).toBe(22);
    expect(poiActions(s, city, city.home, b).find((a) => a.id === 'nap')!.ok).toBe(false);
  });
  it('道具屋では、強盗に要る道具が全部買える。質屋では、汚れたお金を手数料つきで洗える', () => {
    const s = createGame(7, city, b);
    const tool = city.pois.find((p) => p.kind === 'tool')!;
    s.x = tool.x;
    s.y = tool.y;
    s.dirty = 1000000;
    apply(s, city, { type: 'enter', id: tool.id }, b);
    const all = roomFor(s, city)!.spots[0].acts!;
    expect(all.every((a) => poiActions(s, city, tool, b).some((x) => x.id === a))).toBe(true); // 札に出る物は、全部買える物
    const acts = ['crowbar', 'lockpick', 'laptop', 'drill'];
    expect(acts.every((a) => all.includes(a))).toBe(true);
    for (const a of acts) apply(s, city, { type: 'poi', id: tool.id, act: a }, b);
    expect([s.crowbar, s.lockpick, s.laptop, s.drill]).toEqual([true, true, true, true]);
    apply(s, city, { type: 'leave' }, b);
    const pawn = city.pois.find((p) => p.kind === 'pawn')!;
    s.x = pawn.x;
    s.y = pawn.y;
    expect(roomOf('pawn', false)!.spots[0].acts).toContain('wash');
    const [dirty, cash] = [s.dirty, s.cash];
    apply(s, city, { type: 'poi', id: pawn.id, act: 'wash' }, b);
    expect(s.dirty).toBe(dirty - b.money.washCap);
    expect(s.cash).toBe(cash + b.money.washCap * b.money.washRate);
    apply(s, city, { type: 'poi', id: pawn.id, act: 'wash' }, b); // 同じ店では 1日 1回
    expect(s.dirty).toBe(dirty - b.money.washCap);
  });
});
