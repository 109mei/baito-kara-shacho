// 数値の調整に使うシミュレーション。ルール本体と同じコードで回す。
import { describe, expect, it } from 'vitest';
import { balance as b } from '../src/data/schema';
import { createGame } from '../src/core/game';
import { runBot, type BotKind } from '../src/core/bots';
import type { Biz } from '../src/core/types';

const N = 200;
function batch(biz: Biz, kind: BotKind, months: number) {
  const rs = Array.from({ length: N }, (_, i) => runBot(createGame(i + 1, b), biz, kind, months, b, i + 1));
  const med = (xs: number[]) => xs.slice().sort((x, y) => x - y)[Math.floor(xs.length / 2)];
  const quit = rs.filter((r) => r.quitMonth !== null).map((r) => r.quitMonth as number);
  return {
    quitRate: quit.length / N,
    quitMedian: quit.length ? med(quit) : null,
    achieved12: rs.filter((r) => r.achievedMonth !== null && r.achievedMonth <= 12).length / N,
    achieved: rs.filter((r) => r.achievedMonth !== null).length / N,
    restart: rs.filter((r) => r.restartMonth !== null).length / N,
    cashMedian: med(rs.map((r) => r.cashEnd)),
    profitMedian: med(rs.map((r) => r.lastProfit)),
  };
}

describe('手触りの目安', () => {
  const table: Record<string, ReturnType<typeof batch>> = {};
  const row = (name: string, biz: Biz, kind: BotKind, months: number) => (table[name] = batch(biz, kind, months));
  it('結果の表', () => {
    row('手作り ふつう 12か月', 'craft', 'normal', 12);
    row('手作り 道具なし 12か月', 'craft', 'noTool', 12);
    row('手作り すぐ辞める 12か月', 'craft', 'rash', 12);
    row('便利屋 ふつう 12か月', 'handy', 'normal', 12);
    row('便利屋 道具なし 12か月', 'handy', 'noTool', 12);
    row('便利屋 すぐ辞める 12か月', 'handy', 'rash', 12);
    row('開発 ふつう 24か月', 'dev', 'normal', 24);
    row('開発 外に頼む 24か月', 'dev', 'outsource', 24);
    row('開発 小さい作品だけ 24か月', 'dev', 'smallOnly', 24);
    row('開発 すぐ辞める 12か月', 'dev', 'rash', 12);
    row('でたらめ 12か月', 'craft', 'random', 12);
    console.table(table);
    expect(Object.keys(table).length).toBe(11);
  });
  it('ふつうに遊ぶと、手作りの品と便利屋は6割以上が12か月以内に達成する', () => {
    expect(table['手作り ふつう 12か月'].achieved12).toBeGreaterThanOrEqual(0.6);
    expect(table['便利屋 ふつう 12か月'].achieved12).toBeGreaterThanOrEqual(0.6);
  });
  it('個人開発は6割以上が24か月以内に達成する', () => {
    expect(table['開発 ふつう 24か月'].achieved).toBeGreaterThanOrEqual(0.6);
  });
  it('1か月目で辞めると、8割以上がやり直しになる', () => {
    expect(table['手作り すぐ辞める 12か月'].restart).toBeGreaterThanOrEqual(0.8);
    expect(table['便利屋 すぐ辞める 12か月'].restart).toBeGreaterThanOrEqual(0.8);
    expect(table['開発 すぐ辞める 12か月'].restart).toBeGreaterThanOrEqual(0.8);
  });
});
