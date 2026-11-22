// 画面の骨組み。上の帯・街の絵・タブの中身・時間を進める帯・タブ。
import { useEffect, useRef, useState } from 'react';
import { BIZ_LIST, dayInfo, daysOfCash, needOf } from '../core/game';
import type { Biz, GameState, MonthReport } from '../core/types';
import { balance as b } from '../data/schema';
import { useGame, type Tab } from '../store/useGame';
import { PLACES, World, WORLD_H, WORLD_W, type PlaceKey } from '../world/World';
import { Bars, BIZ_NAME, Chip, DOW, HINT, Icon, yen } from './bits';
import { MiniGame } from './MiniGame';
import { HomeTab, MoneyTab, PeopleTab, PlanTab, WorkTab } from './tabs';

function Pick() {
  const send = useGame((st) => st.send);
  const flows: Record<Biz, string[]> = { craft: ['box', 'craft', 'yen'], handy: ['home', 'handy', 'yen'], dev: ['dev', 'star', 'yen'] };
  return (
    <div className="pick">
      <h1>バイトから社長</h1>
      {BIZ_LIST.map((biz) => (
        <button key={biz} className="pick-card" data-pick={biz} onClick={() => send({ type: 'pick', biz })}>
          <span className={`badge ${biz}`}><Icon name={biz} size={28} /></span>
          <span className="grow">
            <span className="title">{BIZ_NAME[biz]}</span>
            <span className="flow">
              {flows[biz].map((ic, i) => <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{i > 0 && <i>›</i>}<Icon name={ic} size={18} /></span>)}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

function TopBar({ s, onNeed }: { s: GameState; onNeed: (t: Tab) => void }) {
  const d = dayInfo(s.day, b);
  const days = daysOfCash(s, b);
  const need = needOf(s, b);
  const needView = !need ? null
    : need.kind === 'cash' ? { icon: 'yen', text: `現金 あと${need.days}日`, tab: 'money' as Tab, tone: '' }
    : need.kind === 'deadline' ? { icon: 'clock', text: '納期に間に合わない', tab: 'home' as Tab, tone: 'warn' }
    : need.kind === 'mats' ? { icon: 'box', text: '材料が足りない', tab: 'plan' as Tab, tone: 'warn' }
    : { icon: 'plan', text: `${BIZ_NAME[need.biz]}の時間がない`, tab: 'plan' as Tab, tone: 'warn' };
  return (
    <header className="top">
      <div className="top-row">
        <div>
          <div className="date num"><b>{d.year + 1}年目 {d.monthInYear + 1}月 {d.dayInMonth + 1}日</b>（{DOW[d.dow]}）</div>
          <div className="cash-row">
            <span className={`cash num ${s.cash < 0 ? 'neg' : ''}`} data-cash data-hint={HINT.cash}>{yen(s.cash)}</span>
            <span className={`pill num ${days < 14 ? 'bad' : days < 30 ? 'warn' : ''}`} data-hint={HINT.days}>あと{days > 999 ? '999+' : days}日</span>
          </div>
        </div>
        <span className={`state-tag ${s.employed ? '' : 'free'}`}>{s.employed ? 'アルバイト中' : s.achieved ? '独立 達成' : '独立'}</span>
      </div>
      {needView && (
        <button className={`need ${needView.tone}`} data-need={need!.kind} onClick={() => onNeed(needView.tab)}>
          <Icon name={needView.icon} size={18} /><span>{needView.text}</span><Icon name="play" size={14} />
        </button>
      )}
    </header>
  );
}

function WorldPane({ s }: { s: GameState }) {
  const box = useRef<HTMLDivElement>(null);
  const world = useRef<World | null>(null);
  const pulse = useGame((st) => st.pulse);
  const [running, setRunning] = useState(false);
  const d = dayInfo(s.day, b);
  const slots = d.weekday ? s.templates.weekday : s.templates.holiday;
  useEffect(() => {
    const w = new World();
    world.current = w;
    if (box.current) void w.init(box.current);
    return () => w.destroy();
  }, []);
  useEffect(() => {
    if (pulse === 0) return;
    setRunning(true);
    const t = setTimeout(() => setRunning(false), 700);
    return () => clearTimeout(t);
  }, [pulse]);
  useEffect(() => {
    world.current?.setView({ slots, running });
  });
  return (
    <div className="world" data-world>
      <div className="world-canvas" ref={box} />
      {(Object.keys(PLACES) as PlaceKey[]).filter((k) => PLACES[k].label).map((k) => (
        <span key={k} className="world-label" style={{ left: `${(PLACES[k].x / WORLD_W) * 100}%`, top: `${((PLACES[k].y + 19) / WORLD_H) * 100}%` }}>{PLACES[k].label}</span>
      ))}
      <div className="strip">{slots.map((x, i) => <i key={i} className={`s-${x}`} />)}</div>
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
          <div className="row"><span data-hint={HINT.profit}>商売の利益</span><b className={`big num ${r.bizProfit < 0 ? 'minus' : ''}`}>{yen(r.bizProfit)}</b></div>
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
  const mini = useGame((st) => st.mini);
  const toasts = useGame((st) => st.toasts);
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
    document.addEventListener('pointerdown', down);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
    return () => {
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
    };
  }, []);

  if (s.phase === 'pick') return <Pick />;

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
    <div className="app">
      <TopBar s={s} onNeed={setTab} />
      <WorldPane s={s} />
      <main className="sheet" data-tab={tab}>
        {tab === 'home' && <HomeTab s={s} guide={guide} />}
        {tab === 'work' && <WorkTab s={s} />}
        {tab === 'plan' && <PlanTab s={s} guide={guide} />}
        {tab === 'people' && <PeopleTab s={s} />}
        {tab === 'money' && <MoneyTab s={s} />}
      </main>
      <div className="timebar">
        <button className={`btn primary ${guide === 'day' ? 'pulse' : ''}`} data-adv="day" onClick={() => advance('day')}><Icon name="play" size={16} />1日</button>
        <button className="btn" data-adv="week" onClick={() => advance('week')}>1週</button>
        <button className="btn" data-adv="month" onClick={() => advance('month')}>月末まで</button>
      </div>
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={`${tab === t.key ? 'on' : ''} ${guideTab === t.key && tab !== t.key ? 'pulse' : ''}`} data-tabbtn={t.key} onClick={() => setTab(t.key)}>
            <Icon name={t.icon} size={22} />{t.label}
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
