// 手でやる操作（10秒ほど）。並べる・なぞる・タップの3種類。
// 結果は「上出来・ふつう・やり直し」の3段。失うのは時間だけで、お金は減らない。
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { Quality } from '../core/types';
import { useGame } from '../store/useGame';
import { Icon } from './bits';

const LIMIT = 10_000;
const LABEL: Record<Quality, string> = { great: '上出来', ok: 'できた', redo: 'やり直し' };

function shuffled<T>(xs: T[]): T[] {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const SPOTS = [[22, 30], [72, 26], [48, 48], [24, 70], [76, 68], [50, 82]];

function OrderGame({ color, onDone }: { color: string; onDone: (q: Quality) => void }) {
  const places = useMemo(() => shuffled(SPOTS).slice(0, 4), []);
  const [next, setNext] = useState(1);
  const [miss, setMiss] = useState(0);
  const [shake, setShake] = useState(0);
  const tap = (n: number) => {
    if (n < next) return;
    if (n === next) {
      if (n === 4) onDone(miss === 0 ? 'great' : miss === 1 ? 'ok' : 'redo');
      setNext(n + 1);
    } else {
      setMiss(miss + 1);
      setShake(n);
      setTimeout(() => setShake(0), 220);
    }
  };
  return (
    <>
      <div className="slots-row">
        {[1, 2, 3, 4].map((n) => <i key={n} style={{ background: n < next ? color : undefined }}>{n < next ? n : ''}</i>)}
      </div>
      {places.map(([x, y], i) => (
        <button key={i} className={`piece ${i + 1 < next ? 'done' : ''} ${shake === i + 1 ? 'miss' : ''}`} data-piece={i + 1}
          style={{ left: `calc(${x}% - 36px)`, top: `calc(${y}% - 36px)`, background: color }} onPointerDown={() => tap(i + 1)}>
          {i + 1}
        </button>
      ))}
    </>
  );
}

function TraceGame({ onDone }: { onDone: (q: Quality) => void }) {
  const places = useMemo(() => shuffled(SPOTS), []);
  const [clean, setClean] = useState<boolean[]>(() => places.map(() => false));
  const start = useRef(performance.now());
  const down = useRef(false);
  const ref = useRef<HTMLDivElement>(null);
  const wipe = (e: RPointerEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    let changed = false;
    const next = clean.map((c, i) => {
      if (c) return true;
      const dx = px - (places[i][0] / 100) * r.width;
      const dy = py - (places[i][1] / 100) * r.height;
      if (dx * dx + dy * dy < 40 * 40) {
        changed = true;
        return true;
      }
      return false;
    });
    if (!changed) return;
    setClean(next);
    if (next.every(Boolean)) {
      const t = performance.now() - start.current;
      onDone(t <= 3500 ? 'great' : t <= 7000 ? 'ok' : 'redo');
    }
  };
  return (
    <div ref={ref} className="tapzone" data-trace
      onPointerDown={(e) => { down.current = true; wipe(e); }}
      onPointerMove={(e) => { if (down.current) wipe(e); }}
      onPointerUp={() => { down.current = false; }}>
      {places.map(([x, y], i) => <span key={i} className={`spot ${clean[i] ? 'clean' : ''}`} style={{ left: `${x}%`, top: `${y}%` }} />)}
    </div>
  );
}

function TapGame({ onDone }: { onDone: (q: Quality) => void }) {
  const mark = useRef<HTMLSpanElement>(null);
  const pos = useRef(0);
  const [hits, setHits] = useState<('core' | 'hit' | 'miss')[]>([]);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const loop = (now: number) => {
      const phase = ((now - t0) / 1100) % 2;
      pos.current = phase < 1 ? phase : 2 - phase;
      if (mark.current) mark.current.style.left = `${pos.current * 100}%`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  const tap = () => {
    if (hits.length >= 3) return;
    const p = pos.current;
    const kind = p >= 0.44 && p <= 0.56 ? 'core' : p >= 0.32 && p <= 0.68 ? 'hit' : 'miss';
    const next = [...hits, kind] as typeof hits;
    setHits(next);
    if (next.length === 3) {
      const inZone = next.filter((h) => h !== 'miss').length;
      const core = next.filter((h) => h === 'core').length;
      onDone(inZone === 3 && core >= 2 ? 'great' : inZone >= 2 ? 'ok' : 'redo');
    }
  };
  return (
    <div className="tapzone" data-tap onPointerDown={tap}>
      <div className="bugs">{[0, 1, 2].map((i) => <i key={i} className={hits[i] ?? ''} />)}</div>
      <div className="lane">
        <span className="zone" style={{ left: '32%', width: '36%' }} />
        <span className="core" style={{ left: '44%', width: '12%' }} />
        <span className="mark" ref={mark} />
      </div>
    </div>
  );
}

export function MiniGame() {
  const mini = useGame((st) => st.mini);
  const close = useGame((st) => st.closeMini);
  const [result, setResult] = useState<Quality | null>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const finished = useRef(false);
  const finish = (q: Quality) => {
    if (finished.current || !mini) return;
    finished.current = true;
    setResult(q);
    setTimeout(() => {
      mini.done(q);
      close();
    }, 700);
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const loop = (now: number) => {
      const left = 1 - (now - t0) / LIMIT;
      if (bar.current) bar.current.style.width = `${Math.max(0, left) * 100}%`;
      if (left <= 0) finishRef.current('redo');
      else raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  if (!mini) return null;
  const color = `var(--${mini.biz})`;
  return (
    <div className="mini" data-mini={mini.kind}>
      <div className="mini-top">
        <span className={`badge ${mini.biz}`}><Icon name={mini.biz} /></span>
        <span className="timer"><span ref={bar} /></span>
        <button className="btn small" data-skip onClick={() => finish('ok')}>おまかせ</button>
      </div>
      <div className="stage">
        {mini.kind === 'order' && <OrderGame color={color} onDone={finish} />}
        {mini.kind === 'trace' && <TraceGame onDone={finish} />}
        {mini.kind === 'tap' && <TapGame onDone={finish} />}
        {result && <div className={`result ${result}`}>{LABEL[result]}</div>}
      </div>
    </div>
  );
}
