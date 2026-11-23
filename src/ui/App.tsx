// 画面。街の絵は PixiJS が描き、React は上に重ねる表示と札だけを受け持つ。
import { useEffect, useMemo, useRef, useState } from 'react';
import { poiActions, poiTitle, type Act } from '../core/sim';
import { balance as b } from '../data/schema';
import { city, getCore, input, poiOf, useGame } from '../store/useGame';
import { MapView, PIN } from '../world/MapView';
import { drawOverview } from '../world/overview';
import { clockText, Icon, yen } from './bits';
import { buzz, sfx } from './sfx';

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
let overviewCache: HTMLCanvasElement | null = null;
const overview = () => (overviewCache ??= drawOverview(city, 1024, b.world.riverHalf));

function Title() {
  const start = useGame((s) => s.start);
  const hasSave = useGame((s) => s.hasSave);
  const bg = useMemo(() => overview().toDataURL('image/png'), []);
  return (
    <div className="title" data-title>
      <div className="title-map" style={{ backgroundImage: `url(${bg})` }} />
      <div className="title-text">
        <small>ひろい街で、すきに生きる</small>
        <h1>バイトから<br />社長</h1>
      </div>
      <div className="title-btns">
        {hasSave && <button className="btn primary" data-start="continue" onClick={() => { sfx.accept(); start(false); }}>つづきから</button>}
        <button className={`btn ${hasSave ? '' : 'primary'}`} data-start="new" onClick={() => { sfx.accept(); start(true); }}>はじめから</button>
      </div>
    </div>
  );
}

// 小さい地図：自分のまわり 560m。北が上
function Minimap() {
  const ref = useRef<HTMLCanvasElement>(null);
  const hud = useGame((s) => s.hud);
  const open = useGame((s) => s.set);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const x = cv.getContext('2d');
    if (!x) return;
    const s = getCore();
    const P = cv.width;
    const span = 560;
    const src = overview();
    const k = src.width / city.size;
    x.fillStyle = '#e4e0d6';
    x.fillRect(0, 0, P, P);
    x.imageSmoothingEnabled = true;
    x.drawImage(src, (s.x - span / 2) * k, (s.y - span / 2) * k, span * k, span * k, 0, 0, P, P);
    const to = (wx: number, wy: number): [number, number] => [((wx - s.x) / span + 0.5) * P, ((wy - s.y) / span + 0.5) * P];
    const day = Math.floor(s.clock / 1440);
    for (const p of city.pois) {
      if (Math.abs(p.x - s.x) > span / 2 || Math.abs(p.y - s.y) > span / 2) continue;
      if (p.kind === 'house' && (!s.crowbar || (s.cool[p.id] ?? 0) > day)) continue;
      const [px, py] = to(p.x, p.y);
      x.fillStyle = hex(p.kind === 'lot' && s.biz.some((z) => z.poi === p.id) ? PIN.biz.c : PIN[p.kind].c);
      x.beginPath();
      x.arc(px, py, P * 0.035, 0, 6.3);
      x.fill();
      x.lineWidth = P * 0.012;
      x.strokeStyle = '#fff';
      x.stroke();
    }
    for (const c of s.cars) {
      if (c.kind !== 'police' && c.kind !== 'hunter') continue;
      const [px, py] = to(c.x, c.y);
      x.fillStyle = c.kind === 'hunter' ? '#c43a3a' : c.chase ? '#ff3b30' : '#2f6bff';
      x.fillRect(px - P * 0.03, py - P * 0.03, P * 0.06, P * 0.06);
    }
    if (s.way) {
      const [wx, wy] = to(s.way[0], s.way[1]);
      const cx = Math.min(P * 0.92, Math.max(P * 0.08, wx));
      const cy = Math.min(P * 0.92, Math.max(P * 0.08, wy));
      x.fillStyle = '#2f7bff';
      x.beginPath();
      x.arc(cx, cy, P * 0.05, 0, 6.3);
      x.fill();
    }
    x.save();
    x.translate(P / 2, P / 2);
    x.rotate(s.a);
    x.fillStyle = '#1b2330';
    x.strokeStyle = '#fff';
    x.lineWidth = P * 0.02;
    x.beginPath();
    x.moveTo(P * 0.075, 0);
    x.lineTo(-P * 0.05, -P * 0.05);
    x.lineTo(-P * 0.02, 0);
    x.lineTo(-P * 0.05, P * 0.05);
    x.closePath();
    x.fill();
    x.stroke();
    x.restore();
  }, [hud]);
  return (
    <button className="mini-map" data-minimap onClick={() => { sfx.tap(); open({ bigMap: true }); }}>
      <canvas ref={ref} width={248} height={248} />
    </button>
  );
}

const LEGEND: (keyof typeof PIN)[] = ['home', 'conbini', 'bike', 'bank', 'police', 'lot', 'biz', 'pawn'];
const LEGEND_NAME: Record<string, string> = { home: '自宅', conbini: '仕事', bike: '店', bank: '銀行', police: '警察署', lot: '空き店舗', biz: '自分の店', pawn: '裏の取引' };

// 全体地図：さわった所へ道案内を出す
function BigMap() {
  const ref = useRef<HTMLCanvasElement>(null);
  const set = useGame((s) => s.set);
  const send = useGame((s) => s.send);
  const way = useGame((s) => s.hud.way);
  const prefs = useGame((s) => s.prefs);
  const setPrefs = useGame((s) => s.setPrefs);
  const start = useGame((s) => s.start);
  const [sure, setSure] = useState(false);
  useEffect(() => {
    const cv = ref.current;
    const x = cv?.getContext('2d');
    if (!cv || !x) return;
    const s = getCore();
    const P = cv.width;
    const k = P / city.size;
    x.drawImage(overview(), 0, 0, P, P);
    const day = Math.floor(s.clock / 1440);
    for (const p of city.pois) {
      if (p.kind === 'atm' && !s.laptop) continue;
      if (p.kind === 'house' && (!s.crowbar || (s.cool[p.id] ?? 0) > day)) continue;
      const small = p.kind === 'house' || p.kind === 'atm';
      x.fillStyle = hex(p.kind === 'lot' && s.biz.some((z) => z.poi === p.id) ? PIN.biz.c : PIN[p.kind].c);
      x.beginPath();
      x.arc(p.x * k, p.y * k, small ? 5 : 9, 0, 6.3);
      x.fill();
      x.lineWidth = 2;
      x.strokeStyle = '#fff';
      x.stroke();
    }
    if (s.way) {
      x.strokeStyle = '#2f7bff';
      x.lineWidth = 5;
      x.beginPath();
      x.moveTo(s.x * k, s.y * k);
      for (let i = 1; i < s.route.length; i++) x.lineTo(city.xs[s.route[i] % city.xs.length] * k, city.ys[Math.floor(s.route[i] / city.xs.length)] * k);
      x.lineTo(s.way[0] * k, s.way[1] * k);
      x.stroke();
    }
    x.fillStyle = '#ffc94a';
    x.strokeStyle = '#1b2330';
    x.lineWidth = 4;
    x.beginPath();
    x.arc(s.x * k, s.y * k, 12, 0, 6.3);
    x.fill();
    x.stroke();
  }, [way]);
  const tap = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    send({ type: 'way', x: ((e.clientX - r.left) / r.width) * city.size, y: ((e.clientY - r.top) / r.height) * city.size });
    sfx.tap();
  };
  return (
    <div className="veil" data-bigmap>
      <div className="bigmap">
        <div className="bigmap-head">
          <b>街の地図</b><span>8km 四方・さわった所へ道案内</span>
          <button className="round" data-close onClick={() => set({ bigMap: false })}><Icon name="x" /></button>
        </div>
        <canvas ref={ref} width={1024} height={1024} onPointerDown={tap} data-mapcanvas />
        <div className="legend">
          {LEGEND.map((k) => <span key={k}><i style={{ background: hex(PIN[k].c) }} />{LEGEND_NAME[k]}</span>)}
          <span><i className="me-dot" />自分</span>
        </div>
        <div className="bigmap-foot">
          {way && <button className="btn small" data-noway onClick={() => send({ type: 'noway' })}>道案内を消す</button>}
          <button className="btn small" data-sound onClick={() => setPrefs({ sound: !prefs.sound })}><Icon name={prefs.sound ? 'sound' : 'mute'} size={17} />音 {prefs.sound ? 'あり' : 'なし'}</button>
          {sure
            ? <button className="btn small danger" data-reset="yes" onClick={() => start(true)}>本当に最初から</button>
            : <button className="btn small" data-reset onClick={() => setSure(true)}>最初から</button>}
        </div>
      </div>
    </div>
  );
}

// 場所の札：できることを並べる
function Panel({ id }: { id: number }) {
  useGame((s) => s.hud);
  const act = useGame((s) => s.act);
  const set = useGame((s) => s.set);
  const p = poiOf(id);
  const s = getCore();
  const acts: Act[] = poiActions(s, city, p, b);
  return (
    <div className="veil" data-panel={p.kind} onClick={(e) => { if (e.target === e.currentTarget) set({ panel: null }); }}>
      <div className="sheet">
        <div className="sheet-head">
          <span className="pin-dot" style={{ background: hex(PIN[p.kind].c) }}>{PIN[p.kind].t}</span>
          <b>{poiTitle(s, p)}</b>
          {p.kind === 'lot' && <small>人通り {p.traffic >= 1.5 ? '多い' : p.traffic >= 1 ? 'ふつう' : '少ない'}</small>}
          <button className="round" data-close onClick={() => set({ panel: null })}><Icon name="x" /></button>
        </div>
        {acts.map((a) => (
          <button key={a.id} className={`act ${a.crime ? 'crime' : ''}`} data-act={a.id} disabled={!a.ok} onClick={() => { buzz(10); act(id, a.id, !!a.mini); if (['sleep', 'work', 'rob', 'chop'].includes(a.id)) set({ panel: null }); }}>
            <span className="act-label">{a.label}</span>
            <span className="act-sub">{a.ok ? a.sub : a.why}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// 手でやる操作：動く印を、色の帯の上で3回止める
function Mini() {
  const mini = useGame((s) => s.mini)!;
  const done = useGame((s) => s.miniDone);
  const [hits, setHits] = useState<boolean[]>([]);
  const mark = useRef<HTMLDivElement>(null);
  const pos = useRef(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const loop = (now: number) => {
      const t = ((now - t0) / 1000) * (1.1 + hits.length * 0.25);
      pos.current = 0.5 + 0.5 * Math.sin(t * 2.6);
      if (mark.current) mark.current.style.left = `${pos.current * 100}%`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [hits.length]);
  const tap = () => {
    if (hits.length >= 3) return;
    const ok = Math.abs(pos.current - 0.5) < 0.13;
    if (ok) sfx.hit();
    else sfx.miss();
    buzz(ok ? 8 : 25);
    const next = [...hits, ok];
    setHits(next);
    if (next.length === 3) window.setTimeout(() => done(next.filter(Boolean).length), 450);
  };
  return (
    <div className="veil mini" data-mini={mini.act} onPointerDown={tap}>
      <div className="mini-box">
        <b>{mini.act === 'hack' ? 'すきまを ねらって 止める' : '音を立てずに こじ開ける'}</b>
        <div className="lane"><span className="zone" /><div className="mark" ref={mark} /></div>
        <div className="dots">{[0, 1, 2].map((i) => <i key={i} className={hits[i] === undefined ? '' : hits[i] ? 'hit' : 'miss'} />)}</div>
        <small>画面をタップ（3回のうち2回 当てる）</small>
      </div>
    </div>
  );
}

function Game() {
  const stage = useRef<HTMLDivElement>(null);
  const hud = useGame((s) => s.hud);
  const panel = useGame((s) => s.panel);
  const mini = useGame((s) => s.mini);
  const bigMap = useGame((s) => s.bigMap);
  const busted = useGame((s) => s.busted);
  const toasts = useGame((s) => s.toasts);
  const fade = useGame((s) => s.fade);
  const action = useGame((s) => s.action);
  const openPoi = useGame((s) => s.openPoi);
  const set = useGame((s) => s.set);
  const guide = useGame((s) => s.guide);
  const [moved, setMoved] = useState(false);
  const [stick, setStick] = useState<{ x: number; y: number; dx: number; dy: number } | null>(null);
  const origin = useRef<{ x: number; y: number; id: number } | null>(null);

  useEffect(() => {
    const view = new MapView(city, b, getCore);
    if (stage.current) void view.init(stage.current);
    return () => view.destroy();
  }, []);

  // キーボード（パソコンで試すとき）：矢印か WASD で動く、E か空白で乗り降り、F で入る、M で地図
  useEffect(() => {
    const keys = new Set<string>();
    const sync = () => {
      if (origin.current) return;
      input.mx = (keys.has('ArrowRight') || keys.has('d') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('a') ? 1 : 0);
      input.my = (keys.has('ArrowDown') || keys.has('s') ? 1 : 0) - (keys.has('ArrowUp') || keys.has('w') ? 1 : 0);
    };
    const down = (e: KeyboardEvent) => {
      if (e.repeat) return;
      keys.add(e.key);
      const st = useGame.getState();
      if (e.key === 'e' || e.key === ' ') st.action();
      if (e.key === 'f') st.openPoi();
      if (e.key === 'm') st.set({ bigMap: !st.bigMap });
      if (e.key.startsWith('Arrow') || 'wasd'.includes(e.key)) setMoved(true);
      sync();
    };
    const up = (e: KeyboardEvent) => {
      keys.delete(e.key);
      sync();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      input.mx = input.my = 0;
    };
  }, []);

  // 画面のどこでも、指を置いた所がスティックの中心になる
  const down = (e: React.PointerEvent) => {
    if (origin.current) return;
    origin.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
    setStick({ x: e.clientX, y: e.clientY, dx: 0, dy: 0 });
  };
  const move = (e: React.PointerEvent) => {
    const o = origin.current;
    if (!o || o.id !== e.pointerId) return;
    let dx = e.clientX - o.x;
    let dy = e.clientY - o.y;
    const d = Math.hypot(dx, dy);
    if (d > 52) {
      dx = (dx / d) * 52;
      dy = (dy / d) * 52;
    }
    input.mx = dx / 52;
    input.my = dy / 52;
    if (d > 20 && !moved) setMoved(true);
    setStick({ x: o.x, y: o.y, dx, dy });
  };
  const up = (e: React.PointerEvent) => {
    if (origin.current?.id !== e.pointerId) return;
    origin.current = null;
    input.mx = input.my = 0;
    setStick(null);
  };

  const riding = hud.ride !== 'foot';
  return (
    <div className="app" data-app data-ride={hud.ride}>
      <div className="stage" ref={stage} data-stage onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
      {stick && <div className="stick" style={{ left: stick.x, top: stick.y }}><i style={{ transform: `translate(${stick.dx}px, ${stick.dy}px)` }} /></div>}
      <div key={fade} className={fade ? 'flash' : ''} />

      <header className="hud">
        <div className="plate">
          <span className="date num">{hud.day}日目 <b>{clockText(hud.hour)}</b>　{hud.rank}</span>
          <span className="cash num" data-cash data-value={hud.cash}>{yen(hud.cash)}</span>
          <span className="subs num">
            {hud.dirty > 0 && <i className="dirty" data-dirty>汚 {yen(hud.dirty)}</i>}
            {hud.bank !== 0 && <i className={hud.bank < 0 ? 'neg' : ''}>預金 {yen(hud.bank)}</i>}
            {hud.loot > 0 && <i className="dirty">盗品 {yen(hud.loot)}</i>}
          </span>
        </div>
        <div className="hud-right">
          <Minimap />
          {hud.stars > 0 && <span className={`stars ${hud.seen ? 'seen' : ''}`} data-stars={hud.stars}>{'★'.repeat(hud.stars)}<i>{'★'.repeat(5 - hud.stars)}</i></span>}
        </div>
      </header>

      <button className="goal" data-goal onClick={guide}><Icon name="flag" size={15} /><span>{hud.goal}</span></button>
      {!moved && <div className="howto" data-howto>画面に指を置いて、動かす</div>}

      <div className="toasts">{toasts.map((t) => <div key={t.id} className={`toast ${t.tone}`}>{t.text}</div>)}</div>

      <div className="pad">
        {riding && <span className="speed num"><b>{hud.kmh}</b>km/h</span>}
        <span className="grow" />
        {hud.nearPoi !== null && (
          <button className="ctx poi" data-ctx="poi" onClick={openPoi}><Icon name="door" size={22} /><span>{hud.nearName}</span></button>
        )}
        {(riding || hud.nearCar) && (
          <button className={`ctx ${hud.nearCar === '盗む' ? 'crime' : ''}`} data-ctx="ride" onClick={action}><Icon name="car" size={22} /><span>{riding ? '降りる' : hud.nearCar}</span></button>
        )}
      </div>

      {panel !== null && <Panel id={panel} />}
      {mini && <Mini />}
      {bigMap && <BigMap />}
      {busted && (
        <div className="veil center" data-busted>
          <div className="busted">
            <h2>逮捕</h2>
            <p className="num">罰金 {yen(busted.fine)}<br />没収 {yen(busted.lost)}<br />{busted.hours}時間、出られなかった</p>
            <button className="btn primary" data-ok onClick={() => set({ busted: null })}>警察署を出る</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function App() {
  const phase = useGame((s) => s.phase);
  return phase === 'title' ? <Title /> : <Game />;
}
