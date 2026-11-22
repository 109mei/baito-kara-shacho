// ルール本体が持つ状態の形。すべて JSON にできる値だけで作る（保存のため）。
export type Biz = 'craft' | 'handy' | 'dev';
export type OrderBiz = 'craft' | 'handy';
export type JobKey = 'small' | 'order' | 'tidy' | 'clean';
export type Slot = 'rest' | 'job' | 'craft' | 'handy' | 'dev' | 'sell' | 'shop';
export type Quality = 'great' | 'ok' | 'redo';
export type OrderStatus = 'pending' | 'offer' | 'active' | 'done' | 'failed' | 'gone';

export interface Order {
  id: number;
  biz: OrderBiz;
  job: JobKey;
  qty: number;
  unitPrice: number;
  arriveDay: number; // 話が届く日（通しの日数）
  answerBy: number; // この日の終わりまでに返事をしないと流れる
  deadline: number; // この日の終わりまでに納める
  status: OrderStatus;
  doneUnits: number;
  progress: number; // いま作っている1つの進み（標準の分）
  matPaid: boolean; // いま作っている1つの材料を出したか
  quality: Quality;
}

export interface Project {
  kind: 'small' | 'normal';
  totalH: number;
  leftH: number;
  outsource: boolean;
  hit: number; // 売れ行きの当たり外れ（始めたときに決まる）
  quality: Quality;
}

export interface Title {
  id: number;
  kind: 'small' | 'normal';
  monthSales: number; // 次の月末に数える本数
  net: number; // 1本の手取り
  tail: number;
  sold: number;
  releasedDay: number;
}

export interface Helper {
  id: number;
  face: number;
  speed: number; // 育つ速さ
  habit: Record<Biz, number>; // 慣れ 0〜1
  biz: Biz | null;
  hours: number; // 1日に働く時間
  workedH: number; // 今月働いた時間
}

export interface MonthAcc {
  jobH: number;
  salesCraft: number;
  salesHandy: number;
  devRevenue: number;
  materials: number;
  tools: number;
  delivered: Record<JobKey, number>;
  failed: Record<OrderBiz, number>;
  great: Record<OrderBiz, number>;
  sellTrips: number;
}

export interface MonthReport {
  month: number; // 1から
  jobPay: number;
  salesCraft: number;
  salesHandy: number;
  devPaid: number; // 今月入金された作品の売上
  devEarned: number; // 今月売れた分（入金は来月末）
  materials: number;
  wages: number;
  tools: number;
  living: number;
  bizProfit: number; // 商売のもうけ（売上 − 材料 − 給料）
  cashStart: number;
  cashEnd: number;
  fame: Record<Biz, number>;
  employed: boolean;
  unpaid: boolean;
  restarted: boolean;
  achievedNow: boolean;
}

export type GameEvent =
  | { type: 'offer'; id: number }
  | { type: 'delivered'; id: number; amount: number }
  | { type: 'failed'; id: number }
  | { type: 'short'; what: 'mats' | 'cash' }
  | { type: 'released'; titleId: number; first: number }
  | { type: 'monthEnd' };

export type Phase = 'pick' | 'play' | 'monthEnd' | 'ended';

export interface BizState {
  started: boolean;
  fame: number;
  tool: boolean;
}

export interface GameState {
  v: number;
  seed: number;
  rng: number;
  day: number; // 通しの日数（0から）
  phase: Phase;
  employed: boolean;
  cash: number;
  mats: number;
  shopTarget: number;
  sellTarget: OrderBiz;
  sellProgress: number;
  biz: Record<Biz, BizState>;
  templates: { weekday: Slot[]; holiday: Slot[] };
  orders: Order[];
  nextId: number;
  project: Project | null;
  titles: Title[];
  devSold: number;
  receivable: number; // 次の月末に入る作品の売上
  helpers: Helper[];
  candidates: Helper[];
  acc: MonthAcc;
  reports: MonthReport[];
  unpaidStreak: number;
  goodStreak: number;
  achieved: boolean;
  restarts: number;
  endedShown: boolean;
  lastOutflow: number; // 先月出ていったお金
  autoQuality: boolean; // 手でやる操作を「おまかせ」にする
}

export type Command =
  | { type: 'pick'; biz: Biz }
  | { type: 'startBiz'; biz: Biz }
  | { type: 'accept'; id: number; quality: Quality }
  | { type: 'decline'; id: number }
  | { type: 'setSlot'; kind: 'weekday' | 'holiday'; index: number; slot: Slot }
  | { type: 'setTemplate'; kind: 'weekday' | 'holiday'; slots: Slot[] }
  | { type: 'setShopTarget'; value: number }
  | { type: 'setSellTarget'; biz: OrderBiz }
  | { type: 'buyTool'; biz: OrderBiz }
  | { type: 'startProject'; kind: 'small' | 'normal'; outsource: boolean; quality: Quality }
  | { type: 'hire'; id: number }
  | { type: 'dismiss'; id: number }
  | { type: 'assign'; id: number; biz: Biz | null; hours: number }
  | { type: 'quitJob' }
  | { type: 'returnJob' }
  | { type: 'setAuto'; value: boolean }
  | { type: 'closeMonth' }
  | { type: 'continue' };
