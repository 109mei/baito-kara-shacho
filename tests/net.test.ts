import { describe, expect, it } from 'vitest';
import { makeCity } from '../src/core/city';
import { apply, createGame, step } from '../src/core/sim';
import { balance as b } from '../src/data/schema';
import { Net, type RoomLike } from '../src/net/room';

// にせの room：送った物を覚えておき、こちらから「届いた一覧」を流せる
const fake = () => {
  const sent: Record<string, unknown>[] = [];
  let push: (c: { peers: never[] }) => void = () => {};
  const room: RoomLike = {
    presence: async (p) => {
      sent.push(p);
    },
    onPeers: (h) => {
      push = h as never;
      return () => {};
    },
  };
  return { room, sent, deliver: (peers: unknown[]) => push({ peers: peers as never[] }) };
};
const me = { peer: 'me1', isMe: true, sameTab: true, kind: 'viewer', presence: {} };
const other = (presence: Record<string, unknown>, peer = 'p2') => ({ peer, isMe: false, sameTab: false, kind: 'viewer', presence });

describe('ほかの人と一緒に遊ぶ', () => {
  it('つながらない所（ほかの置き場）では、何もしないで 1人用のまま動く', async () => {
    const net = new Net();
    expect(await net.start(() => null, 8000)).toBe(false);
    expect(net.online).toBe(false);
    net.send({ x: 1, y: 2, a: 0, ride: 0, stars: 0, turfs: 0, inside: false, hp: 100 });
    net.step(0.1);
    expect(net.mates.size).toBe(0);
  });
  it('自分の位置と様子を送り、相手の位置を受け取る。おかしな値は範囲に収める', async () => {
    const net = new Net();
    const f = fake();
    expect(await net.start(async () => f.room, 8000)).toBe(true);
    net.send({ x: 1234.56, y: 789.01, a: 1.2345, ride: 2, stars: 3, turfs: 1, inside: false, hp: 80.4 });
    expect(f.sent[0]).toEqual({ g: 1, x: 1234.6, y: 789, a: 1.23, r: 2, s: 3, t: 1, i: 0, h: 80, f: null });
    f.deliver([me, other({ g: 1, x: 500, y: 600, a: 0.5, r: 1, s: 99, t: -4, i: 0, h: 1e9 }), other({ x: 1, y: 1 }, 'p3'), other({ g: 1, x: 'a', y: 5 }, 'p4'), { ...other({ g: 1, x: 5, y: 5 }, 'bot'), kind: 'agent' }]);
    expect(net.me).toBe('me1');
    expect([...net.mates.keys()]).toEqual(['p2']); // 印のない物・数でない物・人でない物は出さない
    const m = net.mates.get('p2')!;
    expect([m.x, m.y, m.ride, m.stars, m.turfs, m.hp]).toEqual([500, 600, 1, 5, 0, 100]);
    f.deliver([me, other({ g: 1, x: 510, y: 600 })]);
    net.step(0.05);
    expect(m.x).toBeGreaterThan(500);
    expect(m.x).toBeLessThan(510);
    f.deliver([me]); // いなくなった
    expect(net.mates.size).toBe(0);
  });
  it('撃たれるのは、相手の「撃った回数」が増えて、的が自分のときだけ（入った時点の古い分は数えない）', async () => {
    const net = new Net();
    const f = fake();
    await net.start(async () => f.room, 8000);
    let hits = 0;
    net.onHit = () => {
      hits++;
    };
    f.deliver([me, other({ g: 1, x: 10, y: 10, f: { to: 'me1', n: 7 } })]);
    expect(hits).toBe(0);
    f.deliver([me, other({ g: 1, x: 10, y: 10, f: { to: 'me1', n: 8 } })]);
    expect(hits).toBe(1);
    f.deliver([me, other({ g: 1, x: 10, y: 10, f: { to: 'me1', n: 8 } })]);
    expect(hits).toBe(1);
    f.deliver([me, other({ g: 1, x: 10, y: 10, f: { to: 'someone', n: 9 } })]);
    expect(hits).toBe(1);
    f.deliver([me, other({ g: 1, x: 10, y: 10, f: { to: 'me1', n: 500 } })]); // 一度に増えすぎても 3発まで
    expect(hits).toBe(4);
    net.fireAt('p2');
    net.send({ x: 0, y: 0, a: 0, ride: 0, stars: 0, turfs: 0, inside: false, hp: 100 });
    expect(f.sent.at(-1)!.f).toEqual({ to: 'p2', n: 1 });
  });
  it('ルール本体：人を狙って撃つと手配度が上がる。撃たれると体力が減り、0 で自宅に戻る', () => {
    const city = makeCity(20261123, b);
    const s = createGame(7, city, b);
    apply(s, city, { type: 'shoot', x: s.x + 30, y: s.y }, b);
    expect(s.shots.length).toBe(0); // 銃がない
    s.gun = true;
    apply(s, city, { type: 'shoot', x: s.x + 30, y: s.y }, b);
    expect(s.shots.length).toBe(1);
    expect(s.heat).toBeGreaterThan(0);
    apply(s, city, { type: 'hurt', amount: b.gang.pvpDamage, x: s.x + 30, y: s.y }, b);
    expect(s.hp).toBe(100 - b.gang.pvpDamage);
    for (let i = 0; i < 6; i++) apply(s, city, { type: 'hurt', amount: 9999, x: s.x, y: s.y }, b); // 1発は 50 まで
    expect(step(s, city, { mx: 0, my: 0 }, b).some((e) => e.type === 'down')).toBe(true);
    expect(s.hp).toBe(100);
  });
});
