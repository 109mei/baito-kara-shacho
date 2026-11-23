// 経営のお金の決まり：暦、月末の締め、信用、借入、税、払えないとき。画面のことは知らない。
// 仕様書の 2章（時間）・4章（お金）・5章（信用）を、いまの街の時間（1か月＝数日）に合わせて入れた物。
import type { Balance } from '../data/schema';

export interface Loan { id: number; kind: 'start' | 'bank'; amount: number; left: number; pay: number; rate: number; n: number } // n＝残りの回数
export interface Bill { what: string; amount: number }
// 月ごとの記録（月次レポートにも使う）
export interface MonthRec {
  month: number; // 始めてからの月（0 から）
  sales: number; cost: number; wage: number; rent: number; // 商売の売上と、原価・経費、給料、家賃
  profit: number; // 商売のもうけ
  repay: number; living: number; tax: number; // 返済、生活費、納めた税
  money: number; // 締めたあとの現金＋預金
  credit: number; creditDiff: number;
  unpaid: Bill[]; // 払えずに、来月へ回した物
  notes: string[];
}
export interface Eco {
  days: number; // 締めた日の数
  credit: number; // 信用（0〜1000）
  cap: number; capUntil: number; // 信用の上限と、それが続く月（倒産・逮捕のあと）
  loans: Loan[]; nextLoan: number;
  owed: Bill[]; // 待ってもらっている支払い。次の月末にも払えないと倒産
  tax: { amount: number; due: number }[]; // 決まった税と、納める月
  yearProfit: number; // 今年のもうけ（税の計算に使う）
  m: { sales: number; cost: number }; // 今月の売上と、原価・経費
  red: number; // 赤字が続いた月の数
  closings: number; // 決算の回数
  plan: number; // 計画した月の売上（0＝計画なし）
  infl: number; // 物価（年に 2% 上がる）
  know: Record<string, number>; // 業種ごとの知識（0〜100）
  fatigue: number; // 疲れ（0〜100）
  hist: MonthRec[];
}

export const newEco = (bal: Balance): Eco => ({
  days: 0, credit: bal.credit.start, cap: 1000, capUntil: 0, loans: [], nextLoan: 1, owed: [], tax: [], yearProfit: 0, m: { sales: 0, cost: 0 }, red: 0, closings: 0, plan: 0, infl: 1, know: {}, fatigue: 0, hist: [],
});

export const RANKS = ['E', 'D', 'C', 'B', 'A'] as const;
export type Rank = (typeof RANKS)[number];
export const rankIndex = (credit: number) => Math.max(0, Math.min(4, Math.floor(credit / 200)));
export const rankOf = (credit: number): Rank => RANKS[rankIndex(credit)];
export const monthOf = (e: Eco, bal: Balance) => Math.floor(e.days / bal.time.daysPerMonth);
// 暦：何年目・何月・何日
export const dateOf = (e: Eco, bal: Balance) => {
  const m = monthOf(e, bal);
  return { year: Math.floor(m / bal.time.monthsPerYear) + 1, month: (m % bal.time.monthsPerYear) + 1, day: (e.days % bal.time.daysPerMonth) + 1 };
};
export function addCredit(e: Eco, n: number, bal: Balance) {
  const cap = monthOf(e, bal) < e.capUntil ? e.cap : 1000;
  e.credit = Math.max(0, Math.min(cap, e.credit + n));
}
// 信用の上限をつける（倒産・逮捕）
export function capCredit(e: Eco, cap: number, bal: Balance) {
  e.cap = Math.min(monthOf(e, bal) < e.capUntil ? e.cap : 1000, cap);
  e.capUntil = monthOf(e, bal) + bal.credit.capMonths;
  e.credit = Math.min(e.credit, e.cap);
}
export const maxKnow = (e: Eco) => Math.max(0, ...Object.values(e.know));
export function learn(e: Eco, field: string, n: number) {
  e.know[field] = Math.min(100, (e.know[field] ?? 0) + n);
}

// ---- 借入
export const loanRate = (credit: number, bal: Balance) => [0, bal.loan.rateD, bal.loan.rateC, bal.loan.rateB, bal.loan.rateA][rankIndex(credit)];
// 毎月同じ額を返す。月の返済額 ＝ 借りた額 × 月の利率 ÷（1 −（1 + 月の利率）の −回数 乗）
export const monthlyPay = (amount: number, yearRate: number, months: number) => {
  const r = yearRate / 12;
  return Math.round(r === 0 ? amount / months : (amount * r) / (1 - Math.pow(1 + r, -months)));
};
export interface Cond { label: string; ok: boolean }
export interface Offer { kind: 'start' | 'bank'; label: string; ok: boolean; conds: Cond[]; max: number; rate: number; months: number }
const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`;
// 借りられる融資の一覧。審査に運はなく、条件をすべて満たせば必ず通る
export function loanOffers(e: Eco, own: number, expert: boolean, bal: Balance): Offer[] {
  const L = bal.loan;
  const ri = rankIndex(e.credit);
  const rate = loanRate(e.credit, bal);
  const know = maxKnow(e);
  const startMax = Math.floor((own * L.startRatio) / 10000) * 10000;
  const start: Cond[] = [
    { label: `信用のランクが D 以上（いま ${rankOf(e.credit)}）`, ok: ri >= 1 },
    { label: `自己資金が、借りる額の 3分の1 以上（表のお金 ${yen(own)}）`, ok: startMax >= 10000 },
    { label: `商売の知識が ${L.startKnow} 以上か、経験者を雇っている（いま ${Math.floor(know)}）`, ok: know >= L.startKnow || expert },
    { label: '創業の融資を、まだ借りていない', ok: !e.loans.some((l) => l.kind === 'start') },
  ];
  // 銀行：月の返済額の合計が、月のもうけ（直近3か月の平均）の半分まで
  const last = e.hist.slice(-3);
  const avg = last.length ? last.reduce((a, h) => a + h.profit, 0) / last.length : 0;
  const room = Math.max(0, avg * L.bankPayShare - e.loans.reduce((a, l) => a + l.pay, 0));
  const r = rate / 12;
  const bankMax = Math.floor((r > 0 ? (room * (1 - Math.pow(1 + r, -L.bankMonths))) / r : 0) / 10000) * 10000;
  const bank: Cond[] = [
    { label: `決算を 1回以上している（いま ${e.closings}回）`, ok: e.closings >= 1 },
    { label: `信用のランクが C 以上（いま ${rankOf(e.credit)}）`, ok: ri >= 2 },
    { label: `月の返済が、月のもうけの半分まで（もうけの平均 ${yen(avg)}）`, ok: bankMax >= 10000 },
  ];
  return [
    { kind: 'start', label: '創業の融資', conds: start, ok: start.every((c) => c.ok), max: startMax, rate, months: L.months },
    { kind: 'bank', label: '銀行の融資', conds: bank, ok: bank.every((c) => c.ok), max: bankMax, rate, months: L.bankMonths },
  ];
}
export function takeLoan(e: Eco, kind: 'start' | 'bank', amount: number, own: number, expert: boolean, bal: Balance): Loan | null {
  const o = loanOffers(e, own, expert, bal).find((x) => x.kind === kind);
  if (!o || !o.ok || amount < 10000 || amount > o.max) return null;
  const loan: Loan = { id: e.nextLoan++, kind, amount, left: amount, pay: monthlyPay(amount, o.rate, o.months), rate: o.rate, n: o.months };
  e.loans.push(loan);
  return loan;
}
// 月末に出ていくお金の見込み（商売の給料と家賃は呼ぶ側が足す）
export const monthBills = (e: Eco, living: number, bal: Balance) =>
  e.owed.reduce((a, b) => a + b.amount, 0) + e.loans.reduce((a, l) => a + Math.min(l.pay, l.left + Math.round((l.left * l.rate) / 12)), 0) + living + e.tax.filter((t) => t.due <= monthOf(e, bal)).reduce((a, t) => a + t.amount, 0);

// ---- 月末の締め
export interface CloseIn { cash: number; bank: number; living: number; wages: number; rent: number; hasBiz: boolean }
export interface CloseOut { cash: number; bank: number; rec: MonthRec; bankrupt: boolean }
// 払う順：待ってもらっていた分 → 給料 → 家賃と光熱費 → 返済と利息 → 生活費 → 税。現金、預金の順に引く。
// 払えない物は来月へ回る（3% 上乗せ・信用が下がる）。回した物が次の月末にも払えないと、倒産。
export function closeMonth(e: Eco, w: CloseIn, bal: Balance): CloseOut {
  const month = monthOf(e, bal) - 1; // いま締める月
  const C = bal.credit;
  let cash = w.cash;
  let bank = w.bank;
  let bankrupt = false;
  const before = e.credit;
  const unpaid: Bill[] = [];
  const notes: string[] = [];
  const payBill = (what: string, amount: number, wasLate: boolean) => {
    if (amount <= 0) return true;
    const a = Math.min(cash, amount);
    cash -= a;
    const b2 = Math.min(Math.max(0, bank), amount - a);
    bank -= b2;
    const rest = amount - a - b2;
    if (rest <= 0) return true;
    if (wasLate) bankrupt = true;
    else unpaid.push({ what, amount: Math.round(rest * (1 + bal.loan.deferFee)) });
    return false;
  };
  for (const b of e.owed) payBill(b.what, b.amount, true);
  payBill('給料', w.wages, false);
  payBill('家賃と光熱費', w.rent, false);
  let repay = 0;
  for (const l of e.loans) {
    const interest = Math.round((l.left * l.rate) / 12);
    const due = l.n <= 1 ? l.left + interest : Math.min(l.pay, l.left + interest); // 最後の回で、端数まで払い切る
    l.n -= 1;
    l.left = Math.max(0, l.left + interest - due);
    repay += due;
    payBill('返済', due, false);
  }
  e.loans = e.loans.filter((l) => l.left > 0);
  payBill('生活費', w.living, false);
  let tax = 0;
  for (const t of e.tax.filter((x) => x.due <= month)) {
    tax += t.amount;
    if (payBill('税', t.amount, false)) addCredit(e, C.taxPaid, bal);
  }
  e.tax = e.tax.filter((x) => x.due > month);
  e.owed = bankrupt ? [] : unpaid;

  // 商売のもうけ（給料と家賃は商売の経費）
  const profit = e.m.sales - e.m.cost - w.wages - w.rent;
  e.yearProfit += profit;
  if (w.hasBiz) {
    addCredit(e, C.run, bal);
    if (profit > 0) addCredit(e, C.black, bal);
    e.red = profit < 0 ? e.red + 1 : 0;
    if (e.red >= 3) {
      addCredit(e, C.red3, bal);
      e.red = 0;
      notes.push('赤字が 3か月 続いた');
    }
    if (e.plan > 0) {
      const gap = Math.abs(e.m.sales - e.plan) / e.plan;
      if (gap <= 0.15) addCredit(e, C.planGood, bal);
      else if (gap > 0.3) {
        addCredit(e, C.planBad, bal);
        notes.push('売上が、計画から 3割より大きくずれた');
      }
    }
  }
  if (!unpaid.length && !bankrupt) addCredit(e, C.paid, bal);
  else addCredit(e, C.late * unpaid.length, bal);

  // 年末：決算。税は 2か月後に納める。物の値段は年に 2% 上がる
  const mInYear = (month % bal.time.monthsPerYear) + 1;
  if (mInYear === bal.time.monthsPerYear) {
    const t = Math.round(Math.max(0, e.yearProfit) * bal.tax.person);
    if (t > 0) e.tax.push({ amount: t, due: month + bal.tax.delayMonths });
    if (e.yearProfit > 0) addCredit(e, C.goodYear, bal);
    notes.push(`決算：今年のもうけ ${yen(e.yearProfit)}${t > 0 ? `、税 ${yen(t)}（${bal.tax.delayMonths}か月後に納める）` : ''}`);
    e.closings += 1;
    e.yearProfit = 0;
    e.infl = Math.round(e.infl * 1.02 * 1000) / 1000;
  } else if (mInYear > bal.time.monthsPerYear - bal.tax.delayMonths && e.yearProfit > 0) {
    notes.push(`税の見込み ${yen(e.yearProfit * bal.tax.person)}（年末の決算のあと）`);
  }
  const rec: MonthRec = { month, sales: e.m.sales, cost: e.m.cost, wage: w.wages, rent: w.rent, profit, repay, living: w.living, tax, money: cash + Math.max(0, bank), credit: e.credit, creditDiff: e.credit - before, unpaid, notes };
  e.hist.push(rec);
  if (e.hist.length > 36) e.hist.shift();
  e.m = { sales: 0, cost: 0 };
  return { cash, bank, rec, bankrupt };
}
