// 5つのタブの中身。状態は読むだけで、書き換えは命令（send）で行う。
import { useState } from 'react';
import { BIZ_LIST, canSetSlot, dayInfo, devForecast, helperFactor, jobCap, minutesUntil, orderMinutesLeft, unitStd, workSlots } from '../core/game';
import type { Biz, GameState, JobKey, Order, OrderBiz, Slot } from '../core/types';
import { balance as b } from '../data/schema';
import { useGame } from '../store/useGame';
import { Bars, BIZ_NAME, Chip, HINT, hoursText, Icon, JOB_NAME, Meter, SLOT_NAME, Stepper, yen } from './bits';

const FACE = ['#c2507a', '#2f7fc1', '#d9822b', '#7b5cc9', '#1d7a63', '#8a8f3a'];

function feasible(s: GameState, o: Order): boolean {
  const before = s.orders.filter((x) => x.status === 'active' && x.biz === o.biz && x.deadline <= o.deadline);
  const load = before.reduce((sum, x) => sum + orderMinutesLeft(s, x, b), 0) + (o.status === 'offer' ? orderMinutesLeft(s, o, b) : 0);
  return load <= minutesUntil(s, o.biz, o.deadline, b) + 1;
}

function OrderCard({ s, o, guide }: { s: GameState; o: Order; guide?: boolean }) {
  const send = useGame((st) => st.send);
  const askMini = useGame((st) => st.askMini);
  const left = o.deadline - s.day;
  const mins = orderMinutesLeft(s, o, b);
  const ok = feasible(s, o);
  const mat = unitStd(s, o.job, b).mat * o.qty;
  return (
    <div className="card" data-order={o.status}>
      <div className="card-head">
        <span className={`badge ${o.biz}`}><Icon name={o.biz} /></span>
        <div className="grow">
          <div className="title">{JOB_NAME[o.job]}<small>×{o.qty}</small></div>
        </div>
        <div className="amount num">{yen(o.qty * o.unitPrice)}</div>
      </div>
      <div className="chips">
        <Chip icon="plan" tone={left <= 1 ? 'bad' : left <= 3 ? 'warn' : undefined} hint="due">納期 あと{left + 1}日</Chip>
        <Chip icon="clock" tone={ok ? undefined : 'warn'}>{hoursText(mins)}</Chip>
        {mat > 0 && <Chip icon="box" hint="mats">材料 {mat}</Chip>}
        {o.status === 'offer' && <Chip tone={o.answerBy - s.day <= 0 ? 'warn' : 'mute'}>返事 あと{o.answerBy - s.day + 1}日</Chip>}
        {o.status === 'active' && o.quality === 'great' && <Chip icon="star" tone="good">上出来</Chip>}
      </div>
      {o.status === 'active' ? (
        <Meter value={(o.doneUnits + o.progress) / o.qty} color={`var(--${o.biz})`} />
      ) : (
        <div className="actions">
          <button className="btn" data-act="decline" onClick={() => send({ type: 'decline', id: o.id })}>断る</button>
          <button className={`btn primary ${guide ? 'pulse' : ''}`} data-act="accept" onClick={() => askMini(o.biz, (q) => send({ type: 'accept', id: o.id, quality: q }))}>受ける</button>
        </div>
      )}
    </div>
  );
}

// 今日：時間割を1本の帯で見せる。1日を進めると、針が朝から夜へ動く
function Today({ s }: { s: GameState }) {
  const setTab = useGame((st) => st.setTab);
  const pulse = useGame((st) => st.pulse);
  const busy = useGame((st) => st.busy);
  const calm = useGame((st) => st.prefs.calm);
  const d = dayInfo(s.day, b);
  const slots = d.weekday ? s.templates.weekday : s.templates.holiday;
  const count: Partial<Record<Slot, number>> = {};
  for (const x of slots) count[x] = (count[x] ?? 0) + 1;
  const kinds = (Object.keys(count) as Slot[]).filter((k) => k !== 'rest');
  return (
    <button className="daycard" data-today onClick={() => setTab('plan')}>
      <span className="today-head">
        <b>今日</b>
        {kinds.map((k) => <span key={k} className="today-kind"><i className={`dot s-${k}`} />{SLOT_NAME[k]} {count[k]}時間</span>)}
        {kinds.length === 0 && <span className="today-kind">休み</span>}
      </span>
      <span className="strip" data-hint={HINT.strip}>
        {slots.map((x, i) => <i key={i} className={`s-${x}`} />)}
        {pulse > 0 && !busy && !calm && <b key={pulse} className="needle" />}
      </span>
      <span className="today-hours num"><span>6時</span><span>10時</span><span>14時</span><span>18時</span><span>22時</span></span>
    </button>
  );
}

// 今月ここまで：3つの数字だけを帯で見せる（くわしくは「お金」）
function MonthSoFar({ s }: { s: GameState }) {
  const setTab = useGame((st) => st.setTab);
  const a = s.acc;
  const jobPay = a.jobH * b.job.wage;
  const wages = s.helpers.reduce((sum, h) => sum + h.workedH * b.helper.wage, 0);
  const sales = a.salesCraft + a.salesHandy;
  const expect = s.cash + jobPay + s.receivable - wages - b.player.living;
  return (
    <button className="stats" data-sofar onClick={() => setTab('money')}>
      <span className="stat"><small>今月の売上</small><b className="num">{yen(sales)}</b></span>
      <span className="stat"><small>アルバイト</small><b className="num">{yen(jobPay)}</b></span>
      <span className={`stat ${expect < 0 ? 'neg' : ''}`}><small>月末の見込み</small><b className="num">{yen(expect)}</b></span>
    </button>
  );
}

export function HomeTab({ s, guide }: { s: GameState; guide: string | null }) {
  const offers = s.orders.filter((o) => o.status === 'offer').sort((x, y) => x.answerBy - y.answerBy || x.id - y.id);
  const active = s.orders.filter((o) => o.status === 'active').sort((x, y) => x.deadline - y.deadline || x.id - y.id);
  const p = s.project;
  const selling = s.titles.filter((t) => t.monthSales >= 1);
  const nothing = !offers.length && !active.length && !p && !selling.length;
  const monthEnd = (Math.floor(s.day / b.time.daysPerMonth) + 1) * b.time.daysPerMonth;
  const coming = (['small', 'order', 'tidy', 'clean'] as JobKey[])
    .map((j) => ({ j, n: s.orders.filter((o) => o.status === 'pending' && o.job === j && o.arriveDay < monthEnd).reduce((sum, o) => sum + o.qty, 0) }))
    .filter((x) => x.n > 0);
  return (
    <>
      {coming.length > 0 && (
        <div className="chips" data-coming style={{ margin: '0 4px 8px' }}>
          <Chip icon="plan" tone="mute">今月これから届く話</Chip>
          {coming.map((x) => <Chip key={x.j}>{JOB_NAME[x.j]} {x.n}</Chip>)}
        </div>
      )}
      {offers.length > 0 && <div className="sec">届いた話 <span className="count num">{offers.length}</span></div>}
      {offers.map((o, i) => <OrderCard key={o.id} s={s} o={o} guide={guide === 'accept' && i === 0} />)}
      {active.length > 0 && <div className="sec">受けた話 <span className="count num">{active.length}</span></div>}
      {active.map((o) => <OrderCard key={o.id} s={s} o={o} />)}
      {(p || selling.length > 0) && <div className="sec">作品</div>}
      {p && (
        <div className="card" data-project>
          <div className="card-head">
            <span className="badge dev"><Icon name="dev" /></span>
            <div className="grow"><div className="title">開発中<small>{p.kind === 'small' ? '小さな作品' : 'ふつうの作品'}</small></div></div>
            <div className="amount num">あと{Math.ceil(p.leftH)}時間</div>
          </div>
          <Meter value={1 - p.leftH / p.totalH} color="var(--dev)" />
        </div>
      )}
      {selling.map((t) => (
        <div className="card" key={t.id}>
          <div className="card-head">
            <span className="badge dev"><Icon name="star" /></span>
            <div className="grow"><div className="title">{t.kind === 'small' ? '小さな作品' : 'ふつうの作品'}<small>累計 {t.sold}本</small></div></div>
            <div className="amount num">今月 {Math.floor(t.monthSales)}本</div>
          </div>
          <div className="chips"><Chip icon="yen" hint="net">手取り {yen(t.net)}/本</Chip></div>
        </div>
      ))}
      {nothing && <div className="empty"><Icon name="clock" size={34} /><span>話を待っている</span></div>}
      <Today s={s} />
      <MonthSoFar s={s} />
    </>
  );
}

function CapChips({ s, biz }: { s: GameState; biz: OrderBiz }) {
  const jobs: JobKey[] = biz === 'craft' ? ['small', 'order'] : ['tidy', 'clean'];
  return (
    <div className="chips">
      {jobs.map((j) => {
        const cap = Math.round(jobCap(s, j, b));
        const def = biz === 'craft' ? b.craft[j as 'small' | 'order'] : b.handy[j as 'tidy' | 'clean'];
        const locked = cap <= 0;
        return locked ? (
          <Chip key={j} icon="lock" tone="mute">{JOB_NAME[j]} 知名度{def.fameFrom ?? 0}{j === 'clean' && !s.biz.handy.tool ? '・道具' : ''}</Chip>
        ) : (
          <Chip key={j}>{JOB_NAME[j]} {yen(def.price)} 月{cap}{biz === 'craft' ? '個' : '件'}</Chip>
        );
      })}
    </div>
  );
}

function DevStart({ s }: { s: GameState }) {
  const send = useGame((st) => st.send);
  const askMini = useGame((st) => st.askMini);
  const [out, setOut] = useState(false);
  const canOut = s.cash >= b.dev.outsource.price;
  const go = (kind: 'small' | 'normal') => askMini('dev', (q) => send({ type: 'startProject', kind, outsource: out && kind === 'normal', quality: q }));
  return (
    <>
      <div className="row">
        <span data-hint={HINT.outsource}>外注 {yen(b.dev.outsource.price)}</span>
        <span className="seg">
          <button className={!out ? 'on' : ''} onClick={() => setOut(false)}>なし</button>
          <button className={out ? 'on' : ''} disabled={!canOut} onClick={() => setOut(true)}>あり</button>
        </span>
      </div>
      <div className="actions">
        {(['small', 'normal'] as const).map((k) => {
          const f = devForecast(s, k, out && k === 'normal', b);
          const h = Math.round(b.dev[k].hours * (out && k === 'normal' ? b.dev.outsource.timeFactor : 1));
          return (
            <button key={k} className="btn" style={{ flexDirection: 'column', minHeight: 64, gap: 0 }} data-start={k} onClick={() => go(k)}>
              <span>{k === 'small' ? '小さな作品' : 'ふつうの作品'}</span>
              <small className="num" style={{ color: 'var(--sub)', fontWeight: 700 }} data-hint={HINT.forecast}>{h}時間・{f[0]}〜{f[1]}本</small>
            </button>
          );
        })}
      </div>
    </>
  );
}

export function WorkTab({ s }: { s: GameState }) {
  const send = useGame((st) => st.send);
  const both = s.biz.craft.started && s.biz.handy.started;
  return (
    <>
      {BIZ_LIST.map((biz) => {
        const st = s.biz[biz];
        return (
          <div className="card" key={biz} data-biz={biz}>
            <div className="card-head">
              <span className={`badge ${st.started ? biz : 'mute'}`}><Icon name={biz} /></span>
              <div className="grow"><div className="title">{BIZ_NAME[biz]}</div></div>
              {st.started ? (
                <div className="amount num" data-hint={HINT.fame}>知名度 {Math.floor(st.fame)}</div>
              ) : (
                <button className="btn small primary" data-startbiz={biz} onClick={() => send({ type: 'startBiz', biz })}>始める</button>
              )}
            </div>
            {st.started && biz !== 'dev' && <CapChips s={s} biz={biz} />}
            {st.started && biz !== 'dev' && (
              <div className="row" style={{ marginTop: 8 }}>
                <span data-hint={HINT.tool}>{biz === 'craft' ? '電動の道具' : '洗浄の道具'}</span>
                {st.tool ? <Chip icon="check" tone="good">あり</Chip> : (
                  <button className="btn small" data-tool={biz} disabled={s.cash < b[biz].tool.price} onClick={() => send({ type: 'buyTool', biz })}>買う {yen(b[biz].tool.price)}</button>
                )}
              </div>
            )}
            {st.started && biz === 'dev' && (s.project ? (
              <div className="chips"><Chip icon="clock">開発中 あと{Math.ceil(s.project.leftH)}時間</Chip>{s.receivable > 0 && <Chip icon="yen" hint="receivable">売掛金 {yen(s.receivable)}</Chip>}</div>
            ) : <DevStart s={s} />)}
          </div>
        );
      })}
      {(s.biz.craft.started || s.biz.handy.started) && (
        <div className="card">
          <div className="row">
            <span data-hint={HINT.mats}><b>材料</b> {s.mats}</span>
            <span data-hint={HINT.shop} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <small style={{ color: 'var(--sub)', fontWeight: 700 }}>仕入れの目安</small>
              <Stepper value={s.shopTarget} step={10} max={400} onChange={(v) => send({ type: 'setShopTarget', value: v })} />
            </span>
          </div>
          {both && (
            <div className="row">
              <span data-hint={HINT.sell}>売り込み先</span>
              <span className="seg">
                {(['craft', 'handy'] as const).map((k) => <button key={k} className={s.sellTarget === k ? 'on' : ''} onClick={() => send({ type: 'setSellTarget', biz: k })}>{BIZ_NAME[k]}</button>)}
              </span>
            </div>
          )}
        </div>
      )}
    </>
  );
}

export function PlanTab({ s, guide }: { s: GameState; guide: string | null }) {
  const send = useGame((st) => st.send);
  const [brush, setBrush] = useState<Slot>('rest');
  const kinds: Slot[] = ['rest', ...BIZ_LIST.filter((k) => s.biz[k].started), ...(s.biz.craft.started || s.biz.handy.started ? (['sell', 'shop'] as Slot[]) : [])];
  return (
    <>
      <div className="palette">
        {kinds.map((k) => (
          <button key={k} className={`${brush === k ? 'on' : ''} ${guide === 'shop' && k === 'shop' ? 'pulse' : ''}`} data-brush={k} onClick={() => setBrush(k)}
            data-hint={k === 'sell' ? HINT.sell : k === 'shop' ? HINT.shop : undefined}>
            <span className={`dot s-${k}`} />{SLOT_NAME[k]}
          </button>
        ))}
      </div>
      {(['weekday', 'holiday'] as const).map((kind) => {
        const t = s.templates[kind];
        return (
          <div className="card" key={kind}>
            <div className="card-head" style={{ marginBottom: 8 }}>
              <div className="grow"><div className="title">{kind === 'weekday' ? '平日' : '休日'}<small>{kind === 'weekday' ? '月〜金' : '土・日'}</small></div></div>
              <Chip tone={workSlots(t) >= b.time.maxWorkSlots ? 'warn' : undefined}>働く {workSlots(t)}/{b.time.maxWorkSlots}時間</Chip>
            </div>
            <div className="grid">
              {t.map((slot, i) => (
                <button key={i} className={`cell s-${slot} ${slot === 'rest' ? 'rest' : ''} ${slot === 'job' ? 'locked' : ''}`} data-cell={`${kind}-${i}`}
                  onClick={() => {
                    const next = slot === brush ? 'rest' : brush;
                    if (canSetSlot(s, kind, i, next, b)) send({ type: 'setSlot', kind, index: i, slot: next });
                  }}>
                  <span className="num">{b.time.firstHour + i}</span>
                  {slot !== 'rest' && <Icon name={slot} size={15} />}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

export function PeopleTab({ s }: { s: GameState }) {
  const send = useGame((st) => st.send);
  const started = BIZ_LIST.filter((k) => s.biz[k].started);
  return (
    <>
      <div className="sec">働いている人 <span className="count num">{s.helpers.length}/{b.helper.max}</span></div>
      {s.helpers.length === 0 && <div className="empty"><Icon name="people" size={40} /></div>}
      {s.helpers.map((h) => (
        <div className="card" key={h.id} data-helper>
          <div className="card-head">
            <span className="face" style={{ background: FACE[h.face % FACE.length] }}><Icon name="people" /></span>
            <div className="grow">
              <div className="title num" data-hint={HINT.wage}>時給 {yen(b.helper.wage)}</div>
              <div className="chips" style={{ marginTop: 4 }}>
                <Chip>今月 {yen(h.workedH * b.helper.wage)}</Chip>
                {h.biz && <Chip icon="clock" hint="habit">速さ ×{(1 / helperFactor(h, h.biz, b)).toFixed(2)}</Chip>}
              </div>
            </div>
            <button className="btn small danger" onClick={() => send({ type: 'dismiss', id: h.id })}><Icon name="x" size={16} /></button>
          </div>
          {h.biz && <Meter value={h.habit[h.biz]} color={`var(--${h.biz})`} />}
          <div className="row" style={{ marginTop: 8 }}>
            <span className="seg">
              {started.map((k) => <button key={k} className={h.biz === k ? 'on' : ''} onClick={() => send({ type: 'assign', id: h.id, biz: k, hours: h.hours })}><Icon name={k} size={15} />{BIZ_NAME[k]}</button>)}
            </span>
            <Stepper value={h.hours} max={8} unit="時間" onChange={(v) => send({ type: 'assign', id: h.id, biz: h.biz, hours: v })} />
          </div>
        </div>
      ))}
      <div className="sec">応募 <span className="count num">{s.candidates.length}</span></div>
      {s.candidates.map((c) => (
        <div className="card" key={c.id} data-candidate>
          <div className="card-head">
            <span className="face" style={{ background: FACE[c.face % FACE.length] }}><Icon name="people" /></span>
            <div className="grow">
              <div className="title num">時給 {yen(b.helper.wage)}</div>
              <div className="chips" style={{ marginTop: 4 }}><Chip hint="habit">育つ速さ ×{c.speed.toFixed(1)}</Chip></div>
            </div>
            <button className="btn small primary" data-hire disabled={s.helpers.length >= b.helper.max} onClick={() => send({ type: 'hire', id: c.id })}>雇う</button>
          </div>
        </div>
      ))}
    </>
  );
}

function Confirm({ label, tone, onYes, id }: { label: string; tone?: string; onYes: () => void; id?: string }) {
  const [armed, setArmed] = useState(false);
  return (
    <button className={`btn ${armed ? 'danger' : tone ?? ''}`} data-confirm={id}
      onClick={() => {
        if (armed) onYes();
        setArmed(!armed);
      }}>
      {armed ? 'もう一度押す' : label}
    </button>
  );
}

export function MoneyTab({ s }: { s: GameState }) {
  const send = useGame((st) => st.send);
  const reset = useGame((st) => st.reset);
  const exportSave = useGame((st) => st.exportSave);
  const importSave = useGame((st) => st.importSave);
  const toast = useGame((st) => st.toast);
  const prefs = useGame((st) => st.prefs);
  const setPrefs = useGame((st) => st.setPrefs);
  const [io, setIo] = useState<string | null>(null);
  const a = s.acc;
  const jobPay = a.jobH * b.job.wage;
  const wages = s.helpers.reduce((sum, h) => sum + h.workedH * b.helper.wage, 0);
  const sales = a.salesCraft + a.salesHandy;
  const expect = s.cash + jobPay + s.receivable - wages - b.player.living;
  const cashSeries = [...s.reports.slice(-11).map((r) => r.cashEnd), s.cash];
  return (
    <>
      <div className="card" data-money>
        <div className="row"><span data-hint={HINT.sales}>売上</span><b className="num plus">{yen(sales)}</b></div>
        {s.receivable > 0 && <div className="row"><span data-hint={HINT.receivable}>売掛金（月末に入金）</span><b className="num plus">{yen(s.receivable)}</b></div>}
        {s.employed && <div className="row"><span data-hint={HINT.wage}>アルバイト（月末）</span><b className="num plus">{yen(jobPay)}</b></div>}
        <div className="row"><span>材料費</span><b className="num minus">−{yen(a.materials)}</b></div>
        {a.tools > 0 && <div className="row"><span>道具・外注</span><b className="num minus">−{yen(a.tools)}</b></div>}
        {wages > 0 && <div className="row"><span>人件費（月末）</span><b className="num minus">−{yen(wages)}</b></div>}
        <div className="row"><span data-hint={HINT.living}>生活費（月末）</span><b className="num minus">−{yen(b.player.living)}</b></div>
        <div className="row total"><span>月末の現金（見込み）</span><b className={`num ${expect < 0 ? 'minus' : ''}`}>{yen(expect)}</b></div>
      </div>
      <div className="sec">現金の推移</div>
      <div className="card"><Bars values={cashSeries} /></div>
      {s.reports.length > 0 && <div className="sec">これまで</div>}
      {s.reports.length > 0 && (
        <div className="card">
          {s.reports.slice(-6).reverse().map((r) => (
            <div className="row" key={r.month}>
              <span className="num">{r.month}か月目</span>
              <span className="num" data-hint={HINT.profit}>利益 {yen(r.bizProfit)}</span>
              <b className="num">{yen(r.cashEnd)}</b>
            </div>
          ))}
        </div>
      )}
      <div className="sec">働き方</div>
      <div className="card">
        <div className="card-head">
          <span className="badge job"><Icon name="job" /></span>
          <div className="grow"><div className="title">{s.employed ? 'アルバイト中' : '独立'}<small className="num">{s.employed ? `時給 ${yen(b.job.wage)}` : ''}</small></div></div>
        </div>
        <div className="actions">
          {s.employed
            ? <Confirm id="quit" label="アルバイトを辞める" onYes={() => send({ type: 'quitJob' })} />
            : <Confirm id="return" label="アルバイトに戻る" onYes={() => send({ type: 'returnJob' })} />}
        </div>
      </div>
      <div className="sec">設定</div>
      <div className="card">
        <div className="row">
          <span data-hint={HINT.auto}>手でやる操作</span>
          <span className="seg">
            <button className={!s.autoQuality ? 'on' : ''} onClick={() => send({ type: 'setAuto', value: false })}>自分で</button>
            <button className={s.autoQuality ? 'on' : ''} data-auto onClick={() => send({ type: 'setAuto', value: true })}>おまかせ</button>
          </span>
        </div>
        <div className="row">
          <span>音</span>
          <span className="seg">
            <button className={prefs.sound ? 'on' : ''} data-sound="on" onClick={() => setPrefs({ sound: true })}>あり</button>
            <button className={!prefs.sound ? 'on' : ''} data-sound="off" onClick={() => setPrefs({ sound: false })}>なし</button>
          </span>
        </div>
        <div className="row">
          <span>動き</span>
          <span className="seg">
            <button className={!prefs.calm ? 'on' : ''} data-calm="off" onClick={() => setPrefs({ calm: false })}>ふつう</button>
            <button className={prefs.calm ? 'on' : ''} data-calm="on" onClick={() => setPrefs({ calm: true })}>少なめ</button>
          </span>
        </div>
        <div className="actions">
          <button className="btn small" onClick={() => setIo(exportSave())}>セーブを書き出す</button>
          <button className="btn small" onClick={() => setIo('')}>読み込む</button>
          <Confirm id="reset" label="最初から" onYes={reset} />
        </div>
        {io !== null && (
          <div style={{ marginTop: 8 }}>
            <textarea className="save" value={io} onChange={(e) => setIo(e.target.value)} />
            <div className="actions">
              <button className="btn small" onClick={() => setIo(null)}>閉じる</button>
              <button className="btn small primary" onClick={() => { if (importSave(io)) { setIo(null); toast('読み込んだ', 'good'); } else toast('読み込めない', 'bad'); }}>このセーブを読み込む</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export type { Biz };
