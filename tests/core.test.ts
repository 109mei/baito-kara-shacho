import { describe, expect, it } from 'vitest';
import raw from '../src/data/balance.json';
import { balance as b, parseBalance } from '../src/data/schema';
import { advanceDay, apply, clone, createGame, needOf, workSlots } from '../src/core/game';
import { botDay, runBot } from '../src/core/bots';
import type { Biz, GameState } from '../src/core/types';

const bizList: Biz[] = ['craft', 'handy', 'dev'];

describe('数値の表', () => {
  it('balance.json が検査を通る', () => {
    expect(() => parseBalance(raw)).not.toThrow();
  });
  it('範囲の外の値は通らない', () => {
    expect(() => parseBalance({ ...raw, player: { ...raw.player, living: -1 } })).toThrow();
  });
});

describe('同じ種なら同じ結果', () => {
  for (const biz of bizList) {
    it(`${biz}：12か月`, () => {
      const a = createGame(42, b);
      const c = createGame(42, b);
      runBot(a, biz, 'normal', 12, b);
      runBot(c, biz, 'normal', 12, b);
      expect(JSON.stringify(a)).toBe(JSON.stringify(c));
      const d = createGame(43, b);
      runBot(d, biz, 'normal', 12, b);
      expect(JSON.stringify(d)).not.toBe(JSON.stringify(a));
    });
  }
});

describe('保存して読み込んでも続きが同じ', () => {
  it('途中で JSON にして戻しても、その先が一致する', () => {
    const a = createGame(7, b);
    runBot(a, 'craft', 'normal', 4, b);
    const c = JSON.parse(JSON.stringify(a)) as GameState;
    runBot(a, 'craft', 'normal', 8, b);
    runBot(c, 'craft', 'normal', 8, b);
    expect(JSON.stringify(c)).toBe(JSON.stringify(a));
  });
});

describe('最初の手ごたえ', () => {
  it('手作りの品：最初の話を受けて1日進めると、お金が入る', () => {
    const s = createGame(1, b);
    apply(s, { type: 'pick', biz: 'craft' }, b);
    const offer = s.orders.find((o) => o.status === 'offer')!;
    expect(offer).toBeTruthy();
    apply(s, { type: 'accept', id: offer.id, quality: 'ok' }, b);
    const cash = s.cash;
    const ev = advanceDay(s, b);
    expect(ev.some((e) => e.type === 'delivered')).toBe(true);
    expect(s.cash).toBeGreaterThan(cash);
  });
  it('便利屋：最初の話を受けて1日進めると、お金が入る', () => {
    const s = createGame(1, b);
    apply(s, { type: 'pick', biz: 'handy' }, b);
    const offer = s.orders.find((o) => o.status === 'offer')!;
    apply(s, { type: 'accept', id: offer.id, quality: 'ok' }, b);
    const ev = advanceDay(s, b);
    expect(ev.some((e) => e.type === 'delivered')).toBe(true);
  });
  it('個人開発：最初の1日で、仕上げの残った作品が発売される', () => {
    const s = createGame(1, b);
    apply(s, { type: 'pick', biz: 'dev' }, b);
    const ev = advanceDay(s, b);
    expect(ev.some((e) => e.type === 'released')).toBe(true);
  });
});

describe('決まり', () => {
  it('アルバイトの枠は動かせず、働く枠は1日12時間まで', () => {
    const s = createGame(1, b);
    apply(s, { type: 'pick', biz: 'craft' }, b);
    apply(s, { type: 'setSlot', kind: 'weekday', index: b.job.startSlot, slot: 'craft' }, b);
    expect(s.templates.weekday[b.job.startSlot]).toBe('job');
    for (let i = 0; i < 16; i++) apply(s, { type: 'setSlot', kind: 'weekday', index: i, slot: 'craft' }, b);
    expect(workSlots(s.templates.weekday)).toBe(b.time.maxWorkSlots);
  });
  it('払えない月が2回続くと、やり直しになる', () => {
    const s = createGame(3, b);
    apply(s, { type: 'pick', biz: 'craft' }, b);
    apply(s, { type: 'quitJob' }, b);
    let restarted = false;
    for (let i = 0; i < 30 * 8 && !restarted; i++) {
      if (s.phase === 'monthEnd') apply(s, { type: 'closeMonth' }, b);
      advanceDay(s, b);
      restarted = s.restarts > 0;
    }
    expect(restarted).toBe(true);
    expect(s.employed).toBe(true);
    expect(s.cash).toBe(b.player.restartCash);
  });
  it('足りないもの：材料がないと「材料」が出る', () => {
    const s = createGame(5, b);
    apply(s, { type: 'pick', biz: 'craft' }, b);
    s.mats = 0;
    const offer = s.orders.find((o) => o.status === 'offer')!;
    apply(s, { type: 'accept', id: offer.id, quality: 'ok' }, b);
    expect(needOf(s, b)).toEqual({ kind: 'mats' });
  });
});

describe('でたらめに遊んでも止まらない', () => {
  it('300回、24か月', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const s = createGame(seed, b);
      const biz = bizList[seed % 3];
      runBot(s, biz, 'random', 24, b, seed);
      expect(s.day).toBe(24 * b.time.daysPerMonth);
      expect(Number.isFinite(s.cash)).toBe(true);
      expect(s.mats).toBeGreaterThanOrEqual(0);
      expect(workSlots(s.templates.weekday)).toBeLessThanOrEqual(b.time.maxWorkSlots);
      expect(workSlots(s.templates.holiday)).toBeLessThanOrEqual(b.time.maxWorkSlots);
      expect(s.reports.length).toBe(24);
    }
  });
  it('clone は元の状態を変えない', () => {
    const s = createGame(9, b);
    runBot(s, 'handy', 'normal', 2, b);
    const c = clone(s);
    botDay(c, 'handy', 'normal', b, () => 0.5);
    expect(c.day).toBe(s.day + 1);
  });
});
