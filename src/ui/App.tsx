// 画面の骨組み。上の帯・街の絵・タブの中身・時間を進める帯・タブ。
import { useEffect, useRef, useState } from 'react';
import { BIZ_LIST, dayInfo, daysOfCash, needOf } from '../core/game';
import type { Biz, GameState, MonthReport, Slot } from '../core/types';
import { balance as b } from '../data/schema';
import { useGame, type Tab } from '../store/useGame';
import { PLACES, World, WORLD_H, WORLD_W, type PlaceKey } from '../world/World';
import { Bars, BIZ_NAME, Chip, DOW, HINT, Icon, yen } from './bits';
import { MiniGame } from './MiniGame';
import { buzz, sfx } from './sfx';
import { HomeTab, MoneyTab, PeopleTab, PlanTab, WorkTab } from './tabs';

// 数字は、変わった分だけ数えながら動く（大きく変わるほど、少し長く）
function CountUp({ value, className, ...rest }: { value: number; className?: string } & Record<string, unknown>) {
  const calm = useGame((st) => st.prefs.calm);
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (calm || start === value) {
      from.current = value;
      setShown(value);
      return;
    }
    const dur = Math.min(900, 320 + Math.log10(1 + Math.abs(value - start)) * 110);
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - (1 - k) ** 3;
      const cur = Math.round(start + (value - start) * e);
      from.current = cur;
      setShown(cur);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, calm]);
  const moving = shown !== value;
  return <span className={`${className ?? ''} ${moving ? (value > shown ? 'up' : 'down') : ''}`} data-value={value} {...rest}>{yen(shown)}</span>;
}

// 街の絵を置く場所。絵は PixiJS が描き、React は場所を用意して合図を渡すだけ
function Scene({ slots, day, mode }: { slots: Slot[]; day: number; mode: 'title' | 'play' }) {
  const box = useRef<HTMLDivElement>(null);
  const world = useRef<World | null>(null);
  const pulse = useGame((st) => st.pulse);
  const busy = useGame((st) => st.busy);
  const fx = useGame((st) => st.fx);
  const calm = useGame((st) => st.prefs.calm);
  const view = { slots, day, mode, fast: !!busy, calm };
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    const w = new World();
    world.current = w;
    w.setView(viewRef.current);
    if (box.current) void w.init(box.current);
    return () => w.destroy();
  }, []);
  useEffect(() => {
    world.current?.setView(viewRef.current);
  });
  const seen = useRef(pulse);
  useEffect(() => {
    // 1日ぶん進んだときだけ、朝から夜までを見せる（まとめて進めている間は見せない）
    if (pulse !== seen.current && !busy) world.current?.playDay();
    seen.current = pulse;
  }, [pulse, busy]);
  useEffect(() => {
    if (fx) world.current?.burst(fx.place, fx.big);
  }, [fx]);
  return <div className="world-canvas" ref={box} />;
}

// 場所の印：色と絵は、時間割の色と同じ決まり
const PIN: Record<PlaceKey, { icon: string; cls: string }> = {
  home: { icon: 'home', cls: 'p-home' }, job: { icon: 'job', cls: 'p-job' }, mats: { icon: 'shop', cls: 'p-shop' }, market: { icon: 'sell', cls: 'p-sell' },
  c1: { icon: 'handy', cls: 'p-handy' }, c2: { icon: 'handy', cls: 'p-handy' }, c3: { icon: 'handy', cls: 'p-handy' }, tool: { icon: 'tool', cls: 'p-tool' },
};

const PICK_WORD: Record<Biz, string> = { craft: 'つくって、うる', handy: 'でむいて、かたづける', dev: 'つくって、だす' };

function Pick() {
  const send = useGame((st) => st.send);
  const flows: Record<Biz, string[]> = { craft: ['box', 'craft', 'yen'], handy: ['home', 'handy', 'yen'], dev: ['dev', 'star', 'yen'] };
  return (
    <div className="pick">
      <div className="pick-hero">
        <Scene slots={[]} day={0} mode="title" />
        <div className="pick-title">
          <small>アルバイトから、はじめる</small>
          <h1>バイトから<br />社長</h1>
        </div>
      </div>
      <div className="pick-list">
        <p className="pick-ask">なにで かせぐ？</p>
        {BIZ_LIST.map((biz, i) => (
          <button key={biz} className={`pick-card ${biz}`} style={{ animationDelay: `${120 + i * 70}ms` }} data-pick={biz} onClick={() => send({ type: 'pick', biz })}>
            <span className={`badge ${biz}`}><Icon name={biz} size={30} /></span>
            <span className="grow">
              <span className="title">{BIZ_NAME[biz]}</span>
              <span className="pick-word">{PICK_WORD[biz]}</span>
            </span>
            <span className="flow">
              {flows[biz].map((ic, k) => <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{k > 0 && <i>›</i>}<Icon name={ic} size={17} /></span>)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Hud({ s, onNeed }: { s: GameState; onNeed: (t: Tab) => void }) {
  const d = dayInfo(s.day, b);
  const days = daysOfCash(s, b);
  const need = needOf(s, b);
  const needView = !need ? null
    : need.kind === 'cash' ? { icon: 'yen', text: `現金 あと${need.days}日`, tab: 'money' as Tab, tone: '' }
    : need.kind === 'deadline' ? { icon: 'clock', text: '納期に間に合わない', tab: 'home' as Tab, tone: 'warn' }
    : need.kind === 'mats' ? { icon: 'box', text: '材料が足りない', tab: 'plan' as Tab, tone: 'warn' }
    : { icon: 'plan', text: `${BIZ_NAME[need.biz]}の時間がない`, tab: 'plan' as Tab, tone: 'warn' };
  return (
    <>
      <header className="hud">
        <div className="plate">
          <div className="date num"><b>{d.year + 1}年目 {d.monthInYear + 1}月 {d.dayInMonth + 1}日</b>（{DOW[d.dow]}）</div>
          <CountUp value={s.cash} className={`cash num ${s.cash < 0 ? 'neg' : ''}`} data-cash data-hint={HINT.cash} />
          <span className="month-bar" aria-hidden><i style={{ width: `${((d.dayInMonth + 1) / b.time.daysPerMonth) * 100}%` }} /></span>
        </div>
        <div className="hud-side">
          <span className={`state-tag ${s.employed ? '' : 'free'}`}>{s.employed ? 'アルバイト中' : s.achieved ? '独立 達成' : '独立'}</span>
          <span className={`pill num ${days < 14 ? 'bad' : days < 30 ? 'warn' : ''}`} data-hint={HINT.days}><Icon name="yen" size={13} />あと{days > 999 ? '999+' : days}日</span>
        </div>
      </header>
      {needView && (
        <button className={`need ${needView.tone}`} data-need={need!.kind} onClick={() => onNeed(needView.tab)}>
          <Icon name={needView.icon} size={18} /><span>{needView.text}</span><Icon name="play" size={14} />
        </button>
      )}
    </>
  );
}

function WorldPane({ s, onNeed }: { s: GameState; onNeed: (t: Tab) => void }) {
  const d = dayInfo(s.day, b);
  const slots = d.weekday ? s.templates.weekday : s.templates.holiday;
  // 今日の時間割に出てくる場所だけ、印を大きくする
  const today = new Set<PlaceKey>(['home']);
  for (const x of slots) {
    if (x === 'job') today.add('job');
    else if (x === 'sell') today.add('market');
    else if (x === 'shop') today.add('mats');
    else if (x === 'handy') (['c1', 'c2', 'c3'] as PlaceKey[]).forEach((k) => today.add(k));
  }
  return (
    <div className="world" data-world>
      <Scene slots={slots} day={s.day} mode="play" />
      <div className="world-scene">
        {(Object.keys(PLACES) as PlaceKey[]).map((k) => (
          <span key={k} className={`pin ${PIN[k].cls} ${today.has(k) ? 'today' : ''}`} data-pin={k} data-hint={PLACES[k].label} style={{ left: `${(PLACES[k].x / WORLD_W) * 100}%`, top: `${(PLACES[k].y / WORLD_H) * 100}%` }}>
            <Icon name={PIN[k].icon} size={12} />
          </span>
        ))}
      </div>
      <Hud s={s} onNeed={onNeed} />
    </div>
  );
}

function diffLine(r: MonthReport, prev: MonthReport | undefined): string | null {
  if (!prev) return null;
  const items: [string, number][] = [
    ['売上', r.salesCraft + r.salesHandy + r.devEarned - (prev.salesCraft + prev.salesHandy + prev.devEarned)],
    ['材料費', r.materials - prev.materials],
    ['人件費', r.wages - prev.wages],
    ['アルバイト', r.jobPay - prev.jobPay],
  ];
  const top = items.sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]))[0];
  if (Math.abs(top[1]) < 1) return null;
  return `${top[0]} ${top[1] > 0 ? '+' : '−'}${yen(Math.abs(top[1]))}`;
}

function MonthProfit({ value }: { value: number }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setV(value), 260);
    return () => clearTimeout(t);
  }, [value]);
  return <CountUp value={v} className={`big num ${value < 0 ? 'minus' : ''}`} />;
}

function MonthEnd({ s }: { s: GameState }) {
  const send = useGame((st) => st.send);
  const r = s.reports[s.reports.length - 1];
  const prev = s.reports[s.reports.length - 2];
  if (!r) return null;
  const sales = r.salesCraft + r.salesHandy;
  const moved = diffLine(r, prev);
  return (
    <div className="veil">
      <div className="modal" data-monthend>
        <h2><span className="num">{r.month}か月目の締め</span>
          {r.restarted ? <span className="stamp bad"><Icon name="alert" size={16} />やり直し</span>
            : r.achievedNow ? <span className="stamp"><Icon name="star" size={16} />独立 達成</span>
            : r.unpaid ? <span className="stamp bad"><Icon name="alert" size={16} />支払いが足りない</span> : null}
        </h2>
        <div className="card">
          <div className="row"><span data-hint={HINT.profit}>商売の利益</span><MonthProfit value={r.bizProfit} /></div>
          {moved && <div className="chips" style={{ marginTop: 0, marginBottom: 6 }}><Chip icon="alert" tone="warn">先月から {moved}</Chip></div>}
          <Bars values={s.reports.slice(-12).map((x) => x.bizProfit)} />
        </div>
        <div className="card">
          {sales > 0 && <div className="row"><span>売上</span><b className="num plus">{yen(sales)}</b></div>}
          {r.devEarned > 0 && <div className="row"><span data-hint={HINT.receivable}>作品の売上（来月末に入金）</span><b className="num">{yen(r.devEarned)}</b></div>}
          {r.devPaid > 0 && <div className="row"><span>作品の入金</span><b className="num plus">{yen(r.devPaid)}</b></div>}
          {r.jobPay > 0 && <div className="row"><span>アルバイト</span><b className="num plus">{yen(r.jobPay)}</b></div>}
          {r.materials > 0 && <div className="row"><span>材料費</span><b className="num minus">−{yen(r.materials)}</b></div>}
          {r.tools > 0 && <div className="row"><span>道具・外注</span><b className="num minus">−{yen(r.tools)}</b></div>}
          {r.wages > 0 && <div className="row"><span>人件費</span><b className="num minus">−{yen(r.wages)}</b></div>}
          <div className="row"><span data-hint={HINT.living}>生活費</span><b className="num minus">−{yen(r.living)}</b></div>
          <div className="row total"><span>現金</span><b className={`num ${r.cashEnd < 0 ? 'minus' : ''}`}>{yen(r.cashStart)} → {yen(r.restarted ? s.cash : r.cashEnd)}</b></div>
        </div>
        <div className="chips" style={{ margin: '0 4px 12px' }}>
          {BIZ_LIST.filter((k) => s.biz[k].started).map((k) => (
            <Chip key={k} icon={k} hint="fame">知名度 {Math.floor(r.fame[k])}{prev ? `（${r.fame[k] - prev.fame[k] >= 0 ? '+' : '−'}${Math.abs(Math.round((r.fame[k] - prev.fame[k]) * 10) / 10)}）` : ''}</Chip>
          ))}
        </div>
        <div className="actions">
          {s.employed && !r.restarted && <button className="btn" data-quit onClick={() => send({ type: 'quitJob' })}>アルバイトを辞める</button>}
          <button className="btn go" data-next onClick={() => send({ type: 'closeMonth' })}>次の月へ</button>
        </div>
      </div>
    </div>
  );
}

function Ended({ s }: { s: GameState }) {
  const send = useGame((st) => st.send);
  const best = Math.max(...s.reports.map((r) => r.bizProfit));
  return (
    <div className="veil">
      <div className="modal" data-ended>
        <h2>{b.time.endMonth}か月の記録 {s.achieved && <span className="stamp"><Icon name="star" size={16} />独立 達成</span>}</h2>
        <div className="card">
          <div className="row"><span>現金</span><b className="big num">{yen(s.cash)}</b></div>
          <div className="row"><span>いちばん稼いだ月の利益</span><b className="num">{yen(best)}</b></div>
          <div className="row"><span>やり直し</span><b className="num">{s.restarts}回</b></div>
          <Bars values={s.reports.map((r) => r.cashEnd)} />
        </div>
        <div className="actions"><button className="btn go" onClick={() => send({ type: 'continue' })}>続ける</button></div>
      </div>
    </div>
  );
}

const TABS: { key: Tab; icon: string; label: string }[] = [
  { key: 'home', icon: 'home', label: 'ホーム' },
  { key: 'work', icon: 'work', label: '商売' },
  { key: 'plan', icon: 'plan', label: '時間割' },
  { key: 'people', icon: 'people', label: '人' },
  { key: 'money', icon: 'money', label: 'お金' },
];

export default function App() {
  const s = useGame((st) => st.s);
  const tab = useGame((st) => st.tab);
  const setTab = useGame((st) => st.setTab);
  const advance = useGame((st) => st.advance);
  const stop = useGame((st) => st.stop);
  const busy = useGame((st) => st.busy);
  const left = useGame((st) => st.left);
  const mini = useGame((st) => st.mini);
  const toasts = useGame((st) => st.toasts);
  const calm = useGame((st) => st.prefs.calm);
  const [hint, setHint] = useState<string | null>(null);

  // 長押しで、その言葉の意味を1行だけ出す
  useEffect(() => {
    let timer = 0;
    let hide = 0;
    const down = (e: PointerEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.('[data-hint]') as HTMLElement | null;
      if (!el?.dataset.hint) return;
      timer = window.setTimeout(() => {
        setHint(el.dataset.hint ?? null);
        window.clearTimeout(hide);
        hide = window.setTimeout(() => setHint(null), 2600);
      }, 450);
    };
    const up = () => window.clearTimeout(timer);
    // 押した瞬間に、音と小さな振動を返す
    const press = (e: PointerEvent) => {
      const btn = (e.target as HTMLElement | null)?.closest?.('button') as HTMLButtonElement | null;
      if (!btn || btn.disabled || btn.dataset.tabbtn || btn.dataset.adv) return;
      sfx.tap();
      buzz(8);
    };
    document.addEventListener('pointerdown', press);
    document.addEventListener('pointerdown', down);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
    return () => {
      document.removeEventListener('pointerdown', press);
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
    };
  }, []);

  if (s.phase === 'pick') return <div className={calm ? 'calm' : ''}><Pick /></div>;

  const offers = s.orders.filter((o) => o.status === 'offer').length;
  const hasWork = s.orders.some((o) => o.status === 'active') || !!s.project;
  const firstDay = s.day === 0 && s.reports.length === 0;
  const need = needOf(s, b);
  const hasShop = [...s.templates.weekday, ...s.templates.holiday].includes('shop');
  // 最初に触れるものを1つだけ光らせる
  let guide: string | null = null;
  if (firstDay && offers > 0 && !hasWork) guide = 'accept';
  else if (firstDay && hasWork) guide = 'day';
  else if (need?.kind === 'mats' && !hasShop) guide = 'shop';
  const guideTab: Tab | null = guide === 'accept' ? 'home' : guide === 'shop' ? 'plan' : null;

  return (
    <div className={`app ${calm ? 'calm' : ''}`}>
      <WorldPane s={s} onNeed={setTab} />
      <main className="sheet" data-tab={tab}>
        {tab === 'home' && <HomeTab s={s} guide={guide} />}
        {tab === 'work' && <WorkTab s={s} />}
        {tab === 'plan' && <PlanTab s={s} guide={guide} />}
        {tab === 'people' && <PeopleTab s={s} />}
        {tab === 'money' && <MoneyTab s={s} />}
      </main>
      <div className="timebar">
        {busy ? (
          <button className="btn stop" data-adv="stop" onClick={stop}><span className="spin" /><span>止める</span><small className="num">あと{left}日</small></button>
        ) : (
          <>
            <button className={`btn primary ${guide === 'day' ? 'pulse' : ''}`} data-adv="day" onClick={() => { buzz(10); advance('day'); }}><Icon name="play" size={16} />1日</button>
            <button className="btn" data-adv="week" onClick={() => { sfx.tap(); advance('week'); }}>1週</button>
            <button className="btn" data-adv="month" onClick={() => { sfx.tap(); advance('month'); }}>月末まで</button>
          </>
        )}
      </div>
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={`${tab === t.key ? 'on' : ''} ${guideTab === t.key && tab !== t.key ? 'pulse' : ''}`} data-tabbtn={t.key} onClick={() => setTab(t.key)}>
            <Icon name={t.icon} size={22} /><span>{t.label}</span>
            {t.key === 'home' && offers > 0 && <span className="dotnum num">{offers}</span>}
          </button>
        ))}
      </nav>
      <div className="toasts">{toasts.map((t) => <div key={t.id} className={`toast num ${t.tone}`}>{t.text}</div>)}</div>
      {hint && <div className="hint">{hint}</div>}
      {s.phase === 'monthEnd' && <MonthEnd s={s} />}
      {s.phase === 'ended' && <Ended s={s} />}
      {mini && <MiniGame key={String(mini.done)} />}
    </div>
  );
}
