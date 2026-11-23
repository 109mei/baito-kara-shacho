// 建物の中（部屋）の形。家具の位置と、行動できる場所を決める。画面のことは知らない。
// 単位は m。原点は部屋の左上。出入口は下の壁のまん中。
import type { PoiKind } from './city';

export type FurnType = 'counter' | 'shelf' | 'bed' | 'sofa' | 'table' | 'desk' | 'rug' | 'plant' | 'vault' | 'bike' | 'car' | 'box' | 'cell' | 'tv' | 'safe' | 'drawer' | 'fridge' | 'clerk' | 'goods' | 'wall' | 'case' | 'panel';
export interface Furn { t: FurnType; x: number; y: number; w: number; h: number }
// 強盗でできること：脅す・レジ・鍵を出させる・カメラを止める・扉・金庫・ショーケース・机をさがす・警備員を脅す
export type HeistAct = 'threat' | 'till' | 'key' | 'panel' | 'door' | 'vault' | 'case' | 'desk' | 'guard';
export interface Spot { x: number; y: number; label: string; acts?: string[]; loot?: boolean; exit?: boolean; h?: HeistAct; n?: number }
// 監視カメラ（guard なら警備員）。a を中心に ±sweep だけ首を振る
export interface Cam { x: number; y: number; a: number; sweep: number; range: number; speed: number; guard?: boolean }
export interface Rect { x: number; y: number; w: number; h: number }
export interface Room {
  w: number; h: number; floor: 'wood' | 'tile' | 'concrete' | 'carpet'; f: Furn[]; spots: Spot[];
  heist?: 'conbini' | 'jewel' | 'bank';
  cams?: Cam[]; // 監視カメラと警備員
  doors?: Rect[]; // 鍵のかかった扉（開けるまで通れない・見通せない）
  zones?: Rect[]; // 関係者以外立入禁止
  staff?: { x: number; y: number }[]; // 店員（営業中だけいる）
  back?: { x: number; y: number }; // 裏口
}
export const CAM_FOV = 0.32; // 視界の半分の角度
export const CAM_NEAR = 1.6; // カメラの真下は映らない

const F = (t: FurnType, x: number, y: number, w: number, h: number): Furn => ({ t, x, y, w, h });
const withExit = (r: Room): Room => ({ ...r, spots: [...r.spots, ...(r.back ? [{ x: r.back.x, y: r.back.y, label: '裏口から出る', exit: true }] : []), { x: r.w / 2, y: r.h - 0.8, label: '外へ出る', exit: true }] });

export function roomOf(kind: PoiKind, owned: boolean): Room | null {
  switch (kind) {
    case 'home':
      return withExit({ w: 10, h: 8, floor: 'wood', f: [F('bed', 0.5, 0.5, 2.1, 3.1), F('desk', 7.3, 0.5, 2.2, 1.1), F('tv', 3.9, 0.45, 1.9, 0.5), F('rug', 3.1, 2.1, 3.6, 2.2), F('sofa', 3.6, 3.3, 2.6, 1.0), F('fridge', 0.5, 5.4, 1.0, 1.0), F('table', 7.2, 4.4, 1.7, 1.7), F('plant', 9.0, 6.9, 0.6, 0.6), F('plant', 0.5, 6.9, 0.6, 0.6)], spots: [{ x: 3.1, y: 2.0, label: 'ベッド', acts: ['sleep', 'nap'] }, { x: 6.5, y: 5.2, label: '作業台', acts: ['craftSmall', 'craftOrder'] }, { x: 8.4, y: 2.2, label: '机とPC', acts: ['devSmall', 'devMid', 'dev', 'devOut'] }, { x: 4.9, y: 4.9, label: 'ソファ', acts: ['rest'] }] });
    case 'conbini':
      return withExit({
        w: 12, h: 9, floor: 'tile', heist: 'conbini',
        f: [F('shelf', 1.2, 1.3, 4.2, 0.9), F('shelf', 1.2, 3.4, 4.2, 0.9), F('shelf', 1.2, 5.5, 4.2, 0.9), F('fridge', 0.5, 0.4, 7.4, 0.6), F('counter', 8.8, 2.0, 2.6, 1.0), F('panel', 0.2, 7.2, 0.45, 0.9), F('plant', 11.0, 7.9, 0.6, 0.6)],
        staff: [{ x: 10.1, y: 1.4 }],
        cams: [{ x: 11.6, y: 0.4, a: 2.0, sweep: 0.45, range: 6.5, speed: 0.7 }],
        spots: [{ x: 10.7, y: 3.7, label: 'はたらく', acts: ['work'] }, { x: 9.2, y: 3.8, label: '銃を向けて脅す', h: 'threat' }, { x: 9.2, y: 3.8, label: 'レジの金を出させる', h: 'till' }, { x: 1.2, y: 7.7, label: '監視カメラを止める', h: 'panel' }],
      });
    case 'warehouse':
      return withExit({ w: 14, h: 10, floor: 'concrete', f: [F('box', 0.6, 0.6, 2.4, 2.0), F('box', 3.4, 0.6, 2.0, 1.6), F('box', 0.6, 3.4, 1.8, 2.4), F('box', 10.6, 0.6, 2.8, 2.2), F('box', 11.2, 3.6, 2.2, 1.8), F('shelf', 5.2, 6.4, 4.2, 1.0), F('table', 6.2, 2.6, 2.4, 1.3)], spots: [{ x: 7.4, y: 4.6, label: 'はたらく', acts: ['work'] }] });
    case 'bike':
      return withExit({ w: 11, h: 8, floor: 'tile', f: [F('bike', 0.9, 0.8, 0.7, 1.9), F('bike', 2.2, 0.8, 0.7, 1.9), F('bike', 3.5, 0.8, 0.7, 1.9), F('bike', 4.8, 0.8, 0.7, 1.9), F('bike', 0.9, 4.2, 1.9, 0.7), F('counter', 7.6, 1.6, 2.6, 1.0), F('clerk', 8.5, 0.6, 0.8, 0.8), F('plant', 10.0, 6.9, 0.6, 0.6)], spots: [{ x: 8.9, y: 3.3, label: '自転車を買う', acts: ['buyBike'] }] });
    case 'car':
      return withExit({ w: 15, h: 10, floor: 'tile', f: [F('car', 1.2, 1.0, 2.2, 4.6), F('car', 4.8, 1.0, 2.2, 4.6), F('rug', 0.8, 0.7, 6.6, 5.2), F('desk', 10.8, 1.8, 2.6, 1.2), F('clerk', 11.7, 0.8, 0.8, 0.8), F('plant', 14.0, 8.9, 0.6, 0.6), F('sofa', 10.6, 6.4, 2.6, 1.0)], spots: [{ x: 12.1, y: 3.7, label: '中古車を買う', acts: ['buyCar'] }] });
    case 'tool':
      return withExit({ w: 11, h: 8, floor: 'concrete', f: [F('shelf', 0.6, 0.6, 0.9, 5.0), F('shelf', 2.6, 1.2, 0.9, 4.0), F('shelf', 4.6, 1.2, 0.9, 4.0), F('goods', 0.6, 6.4, 3.4, 0.8), F('counter', 7.4, 1.6, 2.8, 1.0), F('clerk', 8.4, 0.6, 0.8, 0.8)], spots: [{ x: 8.8, y: 3.3, label: '道具を買う', acts: ['mats', 'matsBulk', 'power', 'washer', 'crowbar', 'lockpick', 'laptop', 'drill'] }] });
    case 'pawn':
      return withExit({ w: 9, h: 7, floor: 'carpet', f: [F('counter', 0.6, 1.7, 7.8, 0.9), F('clerk', 4.1, 0.7, 0.8, 0.8), F('safe', 0.7, 0.5, 1.0, 1.0), F('safe', 7.3, 0.5, 1.0, 1.0), F('goods', 0.6, 4.6, 0.8, 1.6), F('goods', 7.6, 4.6, 0.8, 1.6)], spots: [{ x: 4.5, y: 3.3, label: '裏の取引', acts: ['sell', 'wash', 'gun'] }] });
    case 'jewel':
      // 宝石店：下が売り場、上が奥の部屋（金庫・机・防犯パネル）。奥の部屋へは扉か裏口から
      return withExit({
        w: 14, h: 10, floor: 'carpet', heist: 'jewel',
        f: [F('wall', 0, 3.4, 9.6, 0.4), F('wall', 11.0, 3.4, 3.0, 0.4), F('panel', 0.9, 0.2, 0.9, 0.45), F('box', 3.6, 2.0, 1.3, 1.1), F('safe', 6.4, 0.5, 1.5, 1.5), F('desk', 8.6, 0.5, 2.0, 1.1), F('case', 1.2, 5.2, 2.4, 1.1), F('case', 5.0, 5.2, 2.4, 1.1), F('case', 1.2, 7.9, 2.4, 1.1), F('counter', 10.4, 5.4, 2.8, 1.0), F('rug', 4.6, 7.4, 4.8, 1.9), F('plant', 13.1, 8.9, 0.6, 0.6)],
        doors: [{ x: 9.6, y: 3.4, w: 1.4, h: 0.4 }],
        zones: [{ x: 0, y: 0, w: 14, h: 3.4 }],
        staff: [{ x: 11.8, y: 4.7 }],
        back: { x: 12.9, y: 1.3 },
        cams: [{ x: 0.4, y: 0.4, a: 0.45, sweep: 0.75, range: 10, speed: 0.6 }, { x: 13.6, y: 9.6, a: -2.55, sweep: 0.5, range: 11, speed: 0.55 }],
        spots: [
          { x: 11.8, y: 7.2, label: '銃を向けて脅す', h: 'threat' }, { x: 11.8, y: 7.2, label: '鍵を出させる', h: 'key' },
          { x: 2.4, y: 6.9, label: 'ショーケース', h: 'case', n: 0 }, { x: 6.2, y: 6.9, label: 'ショーケース', h: 'case', n: 1 }, { x: 4.2, y: 8.4, label: 'ショーケース', h: 'case', n: 2 },
          { x: 10.3, y: 3.6, label: '扉', h: 'door', n: 0 }, { x: 1.3, y: 1.3, label: '監視カメラを止める', h: 'panel' }, { x: 9.6, y: 2.2, label: '机をさがす', h: 'desk' }, { x: 7.15, y: 2.6, label: '金庫', h: 'vault' },
        ],
      });
    case 'bank':
      // 銀行：下がロビー、左上が事務所（机・防犯パネル・裏口）、右上が金庫室。警備員はロビーの右に立つ
      return withExit({
        w: 16, h: 11, floor: 'tile', heist: 'bank',
        f: [F('wall', 0, 4.4, 1.0, 0.4), F('wall', 2.4, 4.4, 13.6, 0.4), F('wall', 9.6, 0, 0.4, 2.4), F('wall', 9.6, 3.8, 0.4, 0.6), F('panel', 7.6, 0.2, 0.9, 0.45), F('desk', 3.0, 0.5, 2.4, 1.2), F('box', 5.2, 2.2, 1.3, 1.3), F('vault', 12.8, 0.5, 2.8, 2.3), F('counter', 5.0, 6.2, 7.0, 1.0), F('sofa', 0.8, 9.4, 2.6, 1.0), F('rug', 5.6, 8.5, 4.8, 1.7), F('plant', 0.5, 5.2, 0.6, 0.6), F('plant', 15.0, 10.0, 0.6, 0.6)],
        doors: [{ x: 1.0, y: 4.4, w: 1.4, h: 0.4 }, { x: 9.6, y: 2.4, w: 0.4, h: 1.4 }],
        zones: [{ x: 0, y: 0, w: 9.6, h: 4.4 }, { x: 10, y: 0, w: 6, h: 4.4 }],
        staff: [{ x: 6.6, y: 5.5 }, { x: 10.2, y: 5.5 }],
        back: { x: 1.0, y: 1.2 },
        cams: [{ x: 9.2, y: 0.4, a: 2.54, sweep: 0.7, range: 7.8, speed: 0.6 }, { x: 10.4, y: 4.0, a: -0.1, sweep: 0.3, range: 6, speed: 0.5 }, { x: 0.4, y: 5.2, a: 0.35, sweep: 0.5, range: 13, speed: 0.6 }, { x: 14.3, y: 8.6, a: Math.PI, sweep: 0.6, range: 7, speed: 0.5, guard: true }],
        spots: [
          { x: 7.0, y: 8.0, label: '窓口', acts: ['deposit', 'withdraw', 'loan'] },
          { x: 10.2, y: 8.0, label: '銃を向けて脅す', h: 'threat' }, { x: 10.2, y: 8.0, label: '鍵を出させる', h: 'key' }, { x: 15.3, y: 8.6, label: '警備員に銃を向ける', h: 'guard' },
          { x: 1.7, y: 4.6, label: '扉', h: 'door', n: 0 }, { x: 9.8, y: 3.1, label: '金庫室の扉', h: 'door', n: 1 },
          { x: 8.2, y: 1.3, label: '監視カメラを止める', h: 'panel' }, { x: 4.2, y: 2.4, label: '机をさがす', h: 'desk' }, { x: 14.2, y: 3.6, label: '金庫', h: 'vault' },
        ],
      });
    case 'police':
      return withExit({ w: 12, h: 8, floor: 'tile', f: [F('counter', 3.2, 1.9, 5.6, 1.0), F('clerk', 5.6, 0.8, 0.8, 0.8), F('cell', 0.5, 0.5, 2.2, 2.4), F('cell', 9.3, 0.5, 2.2, 2.4), F('sofa', 0.6, 5.8, 2.4, 1.0), F('plant', 11.0, 6.9, 0.6, 0.6)], spots: [{ x: 6.0, y: 3.6, label: '受付', acts: ['fine', 'surrender'] }] });
    case 'lot':
      return owned
        ? withExit({ w: 10, h: 7, floor: 'wood', f: [F('counter', 6.4, 1.6, 2.8, 1.0), F('clerk', 7.4, 0.6, 0.8, 0.8), F('goods', 0.6, 0.6, 4.4, 0.9), F('goods', 0.6, 2.6, 3.2, 0.9), F('table', 1.2, 4.6, 1.4, 1.4), F('plant', 9.0, 5.9, 0.6, 0.6)], spots: [{ x: 7.8, y: 3.3, label: '店のこと', acts: ['tend', 'manage', 'priceUp', 'priceDown', 'ad', 'mix', 'mach0', 'mach1', 'mach2'] }, { x: 3.4, y: 5.3, label: '防犯・たたむ', acts: ['secLock', 'secCam', 'secGuard', 'closeShop'] }] })
        : withExit({ w: 10, h: 7, floor: 'concrete', f: [F('box', 0.6, 0.6, 1.6, 1.4), F('box', 8.0, 0.6, 1.4, 1.2)], spots: [{ x: 5.0, y: 2.8, label: 'ここで店を出す', acts: ['stall', 'shop', 'works'] }] });
    case 'house':
      return withExit({ w: 10, h: 8, floor: 'carpet', f: [F('bed', 0.5, 0.5, 2.1, 3.0), F('drawer', 3.0, 0.5, 1.4, 0.7), F('tv', 5.6, 0.45, 1.9, 0.5), F('safe', 8.5, 0.5, 1.0, 1.0), F('rug', 4.6, 2.2, 3.4, 2.2), F('sofa', 5.0, 3.6, 2.6, 1.0), F('table', 1.0, 5.0, 1.6, 1.6), F('desk', 7.4, 5.6, 2.1, 1.0), F('plant', 0.5, 7.0, 0.6, 0.6)], spots: [{ x: 3.7, y: 1.8, label: '引き出しをあさる', loot: true }, { x: 6.5, y: 1.6, label: 'テレビを持ち出す', loot: true }, { x: 8.6, y: 2.1, label: '金庫をこじ開ける', loot: true }, { x: 8.4, y: 5.0, label: '机をあさる', loot: true }] });
    case 'hideout':
      return owned
        ? withExit({ w: 10, h: 7, floor: 'concrete', f: [F('bed', 0.5, 0.5, 2.0, 3.0), F('safe', 8.4, 0.5, 1.1, 1.1), F('table', 4.2, 2.4, 1.8, 1.4), F('box', 0.6, 5.0, 1.6, 1.4), F('tv', 4.2, 0.45, 1.8, 0.5), F('rug', 3.4, 1.8, 3.4, 2.6)], spots: [{ x: 3.0, y: 1.9, label: 'ベッド', acts: ['sleep', 'nap'] }, { x: 8.6, y: 2.2, label: '金庫', acts: ['stashIn', 'stashOut'] }] })
        : withExit({ w: 10, h: 7, floor: 'concrete', f: [F('box', 0.6, 0.6, 1.8, 1.6), F('box', 7.6, 4.6, 1.6, 1.4)], spots: [{ x: 5.0, y: 2.8, label: 'ここをアジトにする', acts: ['buyHide'] }] });
    case 'market':
      // 売り場（品をあずけて売ってもらう店）
      return withExit({ w: 11, h: 8, floor: 'wood', f: [F('goods', 0.6, 0.6, 4.6, 0.9), F('goods', 0.6, 2.6, 3.4, 0.9), F('goods', 0.6, 4.6, 3.4, 0.9), F('counter', 7.2, 1.6, 2.8, 1.0), F('clerk', 8.2, 0.6, 0.8, 0.8), F('rug', 4.6, 5.2, 3.2, 1.8), F('plant', 10.0, 6.9, 0.6, 0.6)], spots: [{ x: 8.6, y: 3.3, label: '売り場の人', acts: ['sellGoods', 'wholesale', 'pitchCraft', 'pitchHandy'] }] });
    case 'office':
      // 窓口（役所と商工会）
      return withExit({ w: 12, h: 8, floor: 'tile', f: [F('counter', 2.6, 1.9, 6.8, 1.0), F('clerk', 4.2, 0.8, 0.8, 0.8), F('clerk', 7.2, 0.8, 0.8, 0.8), F('sofa', 0.6, 5.6, 2.4, 1.0), F('shelf', 10.6, 0.6, 0.9, 3.4), F('plant', 11.0, 6.9, 0.6, 0.6), F('plant', 0.5, 0.5, 0.6, 0.6)], spots: [{ x: 4.6, y: 3.6, label: '講習と許可', acts: ['lecture', 'busLecture', 'permit_build', 'permit_haul', 'permit_guard'] }, { x: 7.6, y: 3.6, label: '会社の手続き', acts: ['incorp', 'busStart', 'insure', 'hide', 'lawyer'] }, { x: 9.9, y: 4.6, label: '求人の掲示板', acts: ['postPaper', 'postSite', 'postOff'] }, { x: 1.8, y: 4.9, label: '相談する', acts: ['advice'] }] });
    case 'apart':
      return withExit({ w: 9, h: 7, floor: 'wood', f: [F('desk', 3.4, 1.4, 2.4, 1.1), F('clerk', 4.2, 0.4, 0.8, 0.8), F('shelf', 0.5, 0.5, 0.9, 3.0), F('sofa', 5.8, 4.6, 2.4, 1.0), F('plant', 8.0, 0.5, 0.6, 0.6)], spots: [{ x: 4.6, y: 3.2, label: '管理人', acts: ['buyApart', 'rentUp', 'rentDown', 'repair'] }] });
    case 'gang':
      if (owned) return withExit({ w: 12, h: 8, floor: 'concrete', f: [F('vault', 8.6, 0.5, 2.8, 2.2), F('bed', 0.5, 0.5, 2.0, 3.0), F('table', 4.4, 3.4, 2.4, 1.4), F('tv', 4.4, 0.45, 1.8, 0.5), F('box', 0.6, 5.4, 2.0, 1.6), F('rug', 3.6, 2.6, 4.0, 2.8)], spots: [{ x: 3.0, y: 1.9, label: 'ベッド', acts: ['sleep', 'nap'] }, { x: 10.0, y: 3.4, label: '金庫', acts: ['stashIn', 'stashOut'] }] });
      return withExit({ w: 12, h: 8, floor: 'concrete', f: [F('vault', 8.6, 0.5, 2.8, 2.2), F('table', 3.0, 2.8, 2.6, 1.5), F('sofa', 0.6, 0.6, 2.6, 1.0), F('box', 0.6, 5.4, 2.0, 1.6), F('goods', 4.0, 0.5, 3.0, 0.8), F('rug', 2.4, 2.2, 4.0, 2.8)], spots: [{ x: 10.0, y: 3.4, label: '金庫の中身をいただく', acts: ['seize'] }] });
    default:
      return null; // 解体屋と ATM は外で使う
  }
}

// 床に出す、その場所の短い名前
const TAGS: Record<HeistAct, string> = { threat: '店員', key: '店員', till: 'レジ', panel: '防犯パネル', door: '扉', vault: '金庫', case: 'ショーケース', desk: '机', guard: '警備員' };
const LOOT_TAGS: [string, string][] = [['引き出し', '引き出し'], ['テレビ', 'テレビ'], ['金庫', '金庫'], ['机', '机']];
export function spotTag(sp: Spot): string {
  if (sp.exit) return sp.label.startsWith('裏口') ? '裏口' : '出口';
  if (sp.h) return sp.h === 'door' ? sp.label : TAGS[sp.h];
  if (sp.loot) return LOOT_TAGS.find(([k]) => sp.label.includes(k))?.[1] ?? '物';
  return sp.label.replace(/^ここ(で|を)/, '');
}

// 部屋の中で通れない所か（壁・家具・閉じた扉）。じゅうたんは通れる。open＝開けた扉の番号（省くと全部開いている扱い）
export function blocked(room: Room, x: number, y: number, r: number, open?: number[]): boolean {
  if (x < r || y < r || x > room.w - r || y > room.h - r) return true;
  for (const f of room.f) {
    if (f.t === 'rug') continue;
    if (x + r > f.x && x - r < f.x + f.w && y + r > f.y && y - r < f.y + f.h) return true;
  }
  if (open && room.doors) for (let i = 0; i < room.doors.length; i++) {
    const d = room.doors[i];
    if (!open.includes(i) && x + r > d.x && x - r < d.x + d.w && y + r > d.y && y - r < d.y + d.h) return true;
  }
  return false;
}

// ---- 見通し（監視カメラと警備員）
const TALL: FurnType[] = ['wall', 'shelf', 'box', 'vault', 'cell'];
function segHits(x0: number, y0: number, x1: number, y1: number, r: Rect): boolean {
  let t0 = 0;
  let t1 = 1;
  const axes: [number, number, number, number][] = [[x0, x1 - x0, r.x, r.x + r.w], [y0, y1 - y0, r.y, r.y + r.h]];
  for (const [p, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (p < lo || p > hi) return false;
    } else {
      const a = (lo - p) / d;
      const b = (hi - p) / d;
      t0 = Math.max(t0, Math.min(a, b));
      t1 = Math.min(t1, Math.max(a, b));
      if (t0 > t1) return false;
    }
  }
  return true;
}
// 2点の間に、壁・背の高い家具・閉じた扉がないか
export function sightClear(room: Room, open: number[], x0: number, y0: number, x1: number, y1: number): boolean {
  for (const f of room.f) if (TALL.includes(f.t) && segHits(x0, y0, x1, y1, f)) return false;
  if (room.doors) for (let i = 0; i < room.doors.length; i++) if (!open.includes(i) && segHits(x0, y0, x1, y1, room.doors[i])) return false;
  return true;
}
export const camAngle = (c: Cam, t: number) => c.a + Math.sin(t * c.speed) * c.sweep;
// そのカメラ（警備員）に、いま見えているか
export function camSees(room: Room, open: number[], c: Cam, t: number, x: number, y: number): boolean {
  const d = Math.hypot(x - c.x, y - c.y);
  if (d > c.range || (!c.guard && d < CAM_NEAR)) return false;
  let da = Math.atan2(y - c.y, x - c.x) - camAngle(c, t);
  da = Math.atan2(Math.sin(da), Math.cos(da));
  return Math.abs(da) < CAM_FOV && sightClear(room, open, c.x, c.y, x, y);
}
// 視界の線がどこまで届くか（絵のため）
export function rayLen(room: Room, open: number[], c: Cam, ang: number): number {
  let lo = 0;
  let hi = c.range;
  const cx = Math.cos(ang);
  const sy = Math.sin(ang);
  for (let d = 0.4; d <= c.range; d += 0.4) {
    const x = c.x + cx * d;
    const y = c.y + sy * d;
    if (x < 0 || y < 0 || x > room.w || y > room.h || !sightClear(room, open, c.x, c.y, x, y)) {
      hi = d;
      break;
    }
    lo = d;
  }
  // さえぎる物の手前まで、細かく詰める（扇の端がぎざぎざにならないように）
  if (hi < c.range || lo < c.range) {
    let a = lo;
    let b = Math.min(hi, c.range);
    for (let k = 0; k < 5; k++) {
      const m = (a + b) / 2;
      const x = c.x + cx * m;
      const y = c.y + sy * m;
      if (x < 0 || y < 0 || x > room.w || y > room.h || !sightClear(room, open, c.x, c.y, x, y)) b = m;
      else a = m;
    }
    return a;
  }
  return c.range;
}
