// 画面で共通に使う小さな部品と、名前の表。
import type { CSSProperties, ReactNode } from 'react';
import type { Biz, JobKey, Slot } from '../core/types';

export const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`;
export const hoursText = (min: number) => {
  const h = Math.round((min / 60) * 10) / 10;
  return `${h}時間`;
};

export const BIZ_NAME: Record<Biz, string> = { craft: '手作りの品', handy: '便利屋', dev: '個人開発' };
export const JOB_NAME: Record<JobKey, string> = { small: '小物', order: '注文品', tidy: '片付け', clean: '掃除' };
export const SLOT_NAME: Record<Slot, string> = { rest: '休み', job: 'アルバイト', craft: '作る', handy: '出向く', dev: '開発', sell: '売り込み', shop: '仕入れ' };
export const DOW = ['月', '火', '水', '木', '金', '土', '日'];

// 長押しで出す、言葉の意味（1行）。現実で使われている言葉をそのまま使う。
export const HINT: Record<string, string> = {
  cash: '現金：いま手元にあって、すぐ払えるお金',
  days: '現金が、いまの出費であと何日もつか',
  fame: '知名度：上がると、届く話が増える',
  due: '納期：この日までに納める約束',
  mats: '材料：作るたびに減る。なくなると作れない',
  shop: '仕入れ：店で材料を買う。1回1時間',
  sell: '売り込み：2時間で、届く話が増える',
  profit: '利益：売上から、材料費と人件費を引いた残り',
  sales: '売上：受け取ったお金の合計',
  wage: '時給：1時間働いて受け取るお金',
  habit: '慣れ：その仕事に慣れるほど速くなる',
  living: '生活費：家賃や食費。毎月末に出ていく',
  tool: '道具：買うと、速くなるか、できる仕事が増える',
  outsource: '外注：絵と音を外に頼む。速くなり、売れる数が増える',
  net: '手取り：売り場の手数料30%を引いた残り',
  auto: 'おまかせ：手でやる操作をせず、ふつうの出来になる',
  receivable: '売掛金：売れたが、まだ入金されていないお金',
  forecast: '発売した月に売れる本数の見込み',
};

const PATHS: Record<string, ReactNode> = {
  home: <path d="M4 11.5 12 5l8 6.5V20h-5v-5h-6v5H4z" />,
  work: <><rect x="3.5" y="8" width="17" height="11" rx="2" /><path d="M9 8V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3.5 13h17" /></>,
  plan: <><rect x="4" y="5.5" width="16" height="14" rx="2" /><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" /></>,
  people: <><circle cx="9" cy="9" r="3" /><path d="M3.5 19c.6-3 2.7-4.5 5.5-4.5s4.900 1.500 5.500 4.500M16 6.500a2.500 2.500 0 1 1 0 5M17 14.700c1.900.500 3.100 1.900 3.500 4.300" /></>,
  money: <><circle cx="12" cy="12" r="8.500" /><path d="m9 8 3 4 3-4M12 12v5M9.500 12.500h5M9.500 15h5" /></>,
  craft: <><path d="m14.500 5.500 4 4-9 9H5.500v-4z" /><path d="m12.500 7.500 4 4" /></>,
  handy: <><path d="M12 3.500v9M8 12.500h8l1.500 8h-11z" /><path d="M10 16v2M14 16v2" /></>,
  dev: <><rect x="3.500" y="5" width="17" height="12" rx="2" /><path d="m9.500 9-2 2 2 2M14.500 9l2 2-2 2M9 20h6" /></>,
  job: <><path d="M5 20V9.500L12 5l7 4.500V20" /><path d="M9.500 20v-5h5v5" /></>,
  sell: <><path d="M4.500 10v4l9 4.500v-13z" /><path d="M16.500 9.500a3.500 3.500 0 0 1 0 5M7.500 15.500v3" /></>,
  shop: <><path d="M5.500 8.500h13l-1 11h-11z" /><path d="M9 8.500V7a3 3 0 0 1 6 0v1.500" /></>,
  rest: <path d="M18.500 14.500A7.500 7.500 0 0 1 9.500 5.500a7.500 7.500 0 1 0 9 9z" />,
  clock: <><circle cx="12" cy="12" r="8" /><path d="M12 7.500V12l3 2" /></>,
  box: <><path d="m4 8 8-4 8 4v8l-8 4-8-4z" /><path d="m4 8 8 4 8-4M12 12v8" /></>,
  check: <path d="m5.500 12.500 4.500 4.500 8.500-10" />,
  x: <path d="m6.500 6.500 11 11M17.500 6.500l-11 11" />,
  play: <path d="M8 5.500v13l10-6.500z" />,
  star: <path d="m12 4 2.400 5.200 5.600.600-4.200 3.800 1.200 5.600L12 16.400l-5 2.800 1.200-5.600L4 9.800l5.600-.600z" />,
  lock: <><rect x="6" y="11" width="12" height="8.500" rx="2" /><path d="M8.500 11V8.500a3.500 3.500 0 0 1 7 0V11" /></>,
  alert: <><path d="M12 4.500 20.500 19h-17z" /><path d="M12 10v4.500M12 16.800v.200" /></>,
  plus: <path d="M12 5.500v13M5.500 12h13" />,
  minus: <path d="M5.500 12h13" />,
  yen: <path d="m7.500 5.500 4.500 6.500 4.500-6.500M12 12v7M8 13h8M8 16h8" />,
};

export function Icon({ name, size = 20, style }: { name: string; size?: number; style?: CSSProperties }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.800" strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden="true">
      {PATHS[name] ?? null}
    </svg>
  );
}

export function Chip({ icon, children, tone, hint }: { icon?: string; children: ReactNode; tone?: 'warn' | 'bad' | 'good' | 'mute'; hint?: string }) {
  return (
    <span className={`chip ${tone ?? ''}`} data-hint={hint ? HINT[hint] : undefined}>
      {icon && <Icon name={icon} size={14} />}
      {children}
    </span>
  );
}

export function Meter({ value, color }: { value: number; color?: string }) {
  return (
    <span className="meter">
      <span style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} />
    </span>
  );
}

/** 月ごとの棒グラフ。横の目盛線は引かない。 */
export function Bars({ values, color = 'var(--accent)' }: { values: number[]; color?: string }) {
  const w = 320;
  const h = 96;
  const max = Math.max(1, ...values.map((v) => Math.abs(v)));
  const hasNeg = values.some((v) => v < 0);
  const zero = hasNeg ? h * 0.62 : h - 4;
  const bw = Math.min(26, (w - 8) / Math.max(1, values.length) - 4);
  return (
    <svg className="bars" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="月ごとの推移">
      <line x1="0" x2={w} y1={zero} y2={zero} stroke="var(--line)" strokeWidth="1" />
      {values.map((v, i) => {
        const x = 4 + i * ((w - 8) / values.length) + ((w - 8) / values.length - bw) / 2;
        const len = (Math.abs(v) / max) * (hasNeg ? h * 0.56 : h - 12);
        const last = i === values.length - 1;
        return <rect key={i} x={x} y={v >= 0 ? zero - len : zero} width={bw} height={Math.max(1.500, len)} rx="3" fill={v >= 0 ? color : 'var(--bad)'} opacity={last ? 1 : 0.45} />;
      })}
    </svg>
  );
}

export function Stepper({ value, onChange, step = 1, min = 0, max = 999, unit }: { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; unit?: string }) {
  return (
    <span className="stepper">
      <button aria-label="減らす" onClick={() => onChange(Math.max(min, value - step))}><Icon name="minus" size={16} /></button>
      <b>{value}{unit}</b>
      <button aria-label="増やす" onClick={() => onChange(Math.min(max, value + step))}><Icon name="plus" size={16} /></button>
    </span>
  );
}
