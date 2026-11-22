// 数値の表（balance.json）の形と範囲。読み込むときに必ず検査する。
import { z } from 'zod';
import raw from './balance.json';

const pos = z.number().positive();
const nonneg = z.number().min(0);
const int = z.number().int();

const craftJob = z.object({
  mat: nonneg, price: pos, cut: pos, assemble: pos, finish: pos,
  qtyMin: int.min(1), qtyMax: int.min(1), dueMin: int.min(1), dueMax: int.min(1),
  capBase: nonneg, capFame: nonneg, fameWeight: pos,
  fameFrom: nonneg.optional(), capMax: pos.optional(),
});
const handyJob = z.object({
  mat: nonneg, price: pos, work: pos, move: nonneg,
  dueMin: int.min(1), dueMax: int.min(1),
  capBase: nonneg, capFame: nonneg, fameWeight: pos,
  fameFrom: nonneg.optional(), capMax: pos.optional(),
});
const devWork = z.object({ hours: pos, price: pos, base: nonneg, perFame: nonneg, tail: z.number().min(0).max(0.95) });

export const BalanceSchema = z.object({
  version: int,
  time: z.object({ slotsPerDay: int.min(8).max(24), firstHour: int.min(0).max(12), daysPerMonth: int.min(7), maxWorkSlots: int.min(1), endMonth: int.min(1) }),
  player: z.object({ startCash: nonneg, living: pos, restartCash: nonneg }),
  job: z.object({ wage: pos, hours: int.min(1), startSlot: int.min(0) }),
  helper: z.object({ wage: pos, slowFactor: z.number().min(1), habitHours: pos, max: int.min(0), candidatesPerMonth: int.min(0) }),
  mats: z.object({ unitPrice: pos, perTrip: int.min(1), startTarget: int.min(0) }),
  offer: z.object({ answerDays: int.min(1), fluct: z.number().min(0).max(0.5) }),
  quality: z.object({ great: pos, ok: pos, redo: pos, greatFame: nonneg, failFame: nonneg, idleFame: nonneg }),
  craft: z.object({ tool: z.object({ price: pos, assembleFactor: z.number().min(0.1).max(1) }), sellBonus: int.min(0), small: craftJob, order: craftJob, fameDiv: pos }),
  handy: z.object({ tool: z.object({ price: pos }), sellBonus: int.min(0), tidy: handyJob, clean: handyJob, fameDiv: pos }),
  dev: z.object({
    fee: z.number().min(0).max(0.9), fameCap: pos, soldPerFame: pos, hitMin: pos, hitMax: pos,
    outsource: z.object({ price: pos, timeFactor: z.number().min(0.1).max(1), salesFactor: z.number().min(1) }),
    small: devWork, normal: devWork,
  }),
});

export type Balance = z.infer<typeof BalanceSchema>;

export function parseBalance(data: unknown): Balance {
  return BalanceSchema.parse(data);
}

export const balance: Balance = parseBalance(raw);
