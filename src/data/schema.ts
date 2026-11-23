// 数値の表の検査。数値はコードに直接書かず、balance.json に置く。
import { z } from 'zod';
import raw from './balance.json';

const n = z.number().finite();
const pos = n.positive();
const rec = (keys: string[]) => z.object(Object.fromEntries(keys.map((k) => [k, n])) as Record<string, typeof n>);

export const BalanceSchema = z.object({
  world: z.object({ size: pos.min(2000).max(20000), arterialHalf: pos, minorHalf: pos, riverHalf: pos }),
  move: z.object({ walk: pos, bike: pos, car: pos, accel: pos, brake: pos, drag: pos, offroad: pos.max(1) }),
  time: z.object({ minutesPerSecond: pos, startHour: n.min(0).max(23) }),
  money: rec(['startCash', 'living', 'wageConbini', 'wageWarehouse', 'shiftHours', 'bike', 'car', 'crowbar', 'laptop', 'pawnRate']),
  biz: rec(['stall', 'stallProfit', 'shop', 'shopProfit', 'upgradeFactor', 'levelProfit', 'maxLevel']),
  heat: rec(['perStar', 'decay', 'stealSeen', 'stealUnseen', 'hitPed', 'hitPolice', 'burgleQuiet', 'burgleLoud', 'burgleDay', 'hackFail', 'hackOk', 'rob', 'fine', 'jailHoursPerStar', 'confiscate']),
  police: z.object({ sight: pos, speed: pos, hunterSpeed: pos, catchDist: pos, catchSpeed: pos, catchTime: pos, patrols: n.min(0), chasers: z.array(n.min(0)).length(6), hunters: n.min(0) }),
  crime: rec(['lootMin', 'lootMax', 'hackMin', 'hackMax', 'robMin', 'robMax', 'chopMin', 'chopMax', 'houseDays', 'atmDays', 'bankDays']),
  traffic: rec(['cars', 'parked', 'peds', 'radius', 'arterialSpeed', 'minorSpeed']),
});
export type Balance = z.infer<typeof BalanceSchema>;
export const balance: Balance = BalanceSchema.parse(raw);
