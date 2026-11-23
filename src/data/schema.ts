// 数値の表の検査。数値はコードに直接書かず、balance.json に置く。
import { z } from 'zod';
import raw from './balance.json';

const n = z.number().finite();
const pos = n.positive();
const rec = (keys: string[]) => z.object(Object.fromEntries(keys.map((k) => [k, n])) as Record<string, typeof n>);

// 強盗の的ごとの守り：通報までの秒・店員の通報・手配度・盗める額・金庫にかかる秒
const prof = rec(['alarm', 'silent', 'heat', 'quiet', 'cam', 'min', 'max', 'days', 'drill', 'caseMin', 'caseMax']);

// 仕事の表の1行。行を足せば、仕事が増える
const job = z.object({ trade: z.string(), name: z.string(), kind: z.enum(['make', 'visit', 'title']), mat: n, price: pos, mins: n, fame: n, famePts: n, slots: n, perFame: n, perPitch: n, high: z.boolean(), cap: n, tool: z.string(), decay: n, hours: n });

export const BalanceSchema = z.object({
  world: z.object({ size: pos.min(2000).max(20000), arterialHalf: pos, minorHalf: pos, riverHalf: pos }),
  move: z.object({ walk: pos, bike: pos, car: pos, accel: pos, brake: pos, drag: pos, offroad: pos.max(1) }),
  time: z.object({ minutesPerSecond: pos, startHour: n.min(0).max(23), daysPerMonth: pos.int(), monthsPerYear: pos.int(), quotaScale: pos.max(1) }),
  credit: rec(['start', 'run', 'black', 'paid', 'late', 'red3', 'goodYear', 'taxPaid', 'arrest', 'arrestCap', 'bankruptCap', 'capMonths', 'planGood', 'planBad', 'restartCash', 'bankrupt']),
  corp: rec(['fee', 'capital', 'salary', 'step', 'unit']),
  pro: rec(['buildValue', 'buildCrew', 'buildMonths', 'buildFund', 'buildSkill', 'haulValue', 'haulCrew', 'haulMonths', 'trucks', 'truck', 'haulSkill', 'guardValue', 'guardCrew', 'guardMonths', 'guardFee', 'guardHours', 'big', 'bigJobs', 'bigRank']),
  loan: rec(['rateD', 'rateC', 'rateB', 'rateA', 'startRatio', 'startKnow', 'months', 'bankMonths', 'bankPayShare', 'deferFee']),
  tax: rec(['person', 'corp', 'delayMonths']),
  money: rec(['startCash', 'living', 'wageConbini', 'wageWarehouse', 'shiftHours', 'bike', 'car', 'crowbar', 'laptop', 'pawnRate', 'lockpick', 'drill', 'washRate', 'washCap', 'matPrice', 'power', 'washer', 'devOut']),
  self: rec(['tirePerHour', 'sleep', 'nap', 'restPerHour', 'warn']),
  jobs: z.record(z.string(), job),
  shop: rec(['stallUnit', 'stallCost', 'stallFlow', 'stallCap', 'shopUnit', 'shopCost', 'shopFlow', 'shopCap', 'shopRent', 'depositMonths', 'depositMonthsE', 'selfCap', 'hours', 'ad', 'adGain', 'awareStart', 'awareDecay', 'unseen', 'happy', 'unhappy', 'mouth', 'mix']),
  staff: rec(['market', 'seekers', 'paper', 'site', 'siteFee', 'talk', 'raise', 'quit', 'sign', 'quiet', 'skim', 'skimRate', 'expHours']),
  apart: rec(['price', 'rooms', 'unit', 'upkeep', 'decay', 'repair']),
  permit: rec(['foodFee', 'foodHours']),
  law: rec(['lawyer', 'lawyerCut', 'surrender', 'auditBase', 'auditHide', 'auditMix', 'penalty', 'auditCredit', 'caseHours', 'caseAlarm', 'caseDays']),
  deal: rec(['minJobs', 'value', 'visits', 'months', 'visitMins', 'relPerVisit', 'penalty', 'relLoss', 'maxDeals', 'rate']),
  works: rec(['setup', 'rent', 'cut', 'build', 'finish', 'machine', 'defect', 'standard', 'bulk', 'bulkOff', 'wholesale']),
  bus: rec(['lecture', 'lectureHours', 'price', 'min', 'fare', 'flow', 'share', 'perBus', 'fareK', 'fuel', 'near', 'boost']),
  town: rec(['insure', 'refund', 'eventRate', 'rivalStall', 'rivalShop', 'rivalCut', 'lock', 'cam', 'guardFee', 'secEach', 'burgle', 'burgleUnit', 'burgleLoss', 'burgleRefund']),
  biz: rec(['stall', 'stallProfit', 'shop', 'shopProfit', 'upgradeFactor', 'levelProfit', 'maxLevel']),
  heat: rec(['perStar', 'decay', 'stealSeen', 'stealUnseen', 'hitPed', 'hitPolice', 'burgleQuiet', 'burgleLoud', 'burgleDay', 'hackFail', 'hackOk', 'rob', 'fine', 'jailHoursPerStar', 'confiscate']),
  police: z.object({ sight: pos, speed: pos, hunterSpeed: pos, catchDist: pos, catchSpeed: pos, catchTime: pos, patrols: n.min(0), chasers: z.array(n.min(0)).length(6), hunters: n.min(0) }),
  crime: rec(['lootMin', 'lootMax', 'hackMin', 'hackMax', 'robMin', 'robMax', 'chopMin', 'chopMax', 'houseDays', 'atmDays', 'bankDays', 'alarmQuiet', 'alarmLoud']),
  gang: rec(['hideCost', 'gunCost', 'turfIncome', 'seizeMin', 'seizeMax', 'retake', 'raid', 'guards', 'thugHp', 'gunDamage', 'gunHit', 'gunRange', 'thugHit', 'thugDamage', 'shotSeen', 'shotUnseen', 'downLoss', 'war', 'warnDist', 'pvpDamage']),
  heist: z.object({ seeTime: pos, conbini: prof, jewel: prof, bank: prof }),
  traffic: rec(['cars', 'parked', 'peds', 'radius', 'arterialSpeed', 'minorSpeed']),
});
export type Balance = z.infer<typeof BalanceSchema>;
export const balance: Balance = BalanceSchema.parse(raw);
