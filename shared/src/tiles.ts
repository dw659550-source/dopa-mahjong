// 牌の表現
// Tile（牌ID）: 0〜135。4枚ずつ同じ種類。
// Kind（牌種）: 0〜33。0-8=萬子1-9、9-17=筒子1-9、18-26=索子1-9、27-30=東南西北、31-33=白發中
// 赤ドラは各色の5の1枚目（牌ID 16, 52, 88）。

export type Tile = number;
export type Kind = number;

export const NUM_KINDS = 34;
export const EAST = 27;
export const SOUTH = 28;
export const WEST = 29;
export const NORTH = 30;
export const HAKU = 31;
export const HATSU = 32;
export const CHUN = 33;

export const RED_TILES: readonly Tile[] = [16, 52, 88];

export function kindOf(tile: Tile): Kind {
  return Math.floor(tile / 4);
}

export function isRed(tile: Tile, akaEnabled: boolean): boolean {
  return akaEnabled && RED_TILES.includes(tile);
}

/** 0=萬子,1=筒子,2=索子,3=字牌 */
export function suitOf(kind: Kind): number {
  return kind < 27 ? Math.floor(kind / 9) : 3;
}

/** 数牌の数字(1-9)。字牌は0。 */
export function numberOf(kind: Kind): number {
  return kind < 27 ? (kind % 9) + 1 : 0;
}

export function isHonor(kind: Kind): boolean {
  return kind >= 27;
}

export function isTerminal(kind: Kind): boolean {
  return kind < 27 && (kind % 9 === 0 || kind % 9 === 8);
}

export function isYaochu(kind: Kind): boolean {
  return isHonor(kind) || isTerminal(kind);
}

export function isSimple(kind: Kind): boolean {
  return !isYaochu(kind);
}

export function isWind(kind: Kind): boolean {
  return kind >= EAST && kind <= NORTH;
}

export function isDragon(kind: Kind): boolean {
  return kind >= HAKU;
}

export const YAOCHU_KINDS: readonly Kind[] = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

/** ドラ表示牌からドラの牌種を求める */
export function doraFromIndicator(indicatorKind: Kind): Kind {
  if (indicatorKind < 27) {
    const suitBase = Math.floor(indicatorKind / 9) * 9;
    return suitBase + ((indicatorKind - suitBase + 1) % 9);
  }
  if (indicatorKind <= NORTH) return EAST + ((indicatorKind - EAST + 1) % 4);
  return HAKU + ((indicatorKind - HAKU + 1) % 3);
}

/** 三人麻雀で使わない牌種（二萬〜八萬） */
export function isSanmaRemoved(kind: Kind): boolean {
  return kind >= 1 && kind <= 7;
}

/** ドラ表示牌からドラの牌種を求める（三人麻雀では一萬の次は九萬、九萬の次は一萬） */
export function doraFromIndicatorFor(indicatorKind: Kind, sanma: boolean): Kind {
  if (sanma && indicatorKind === 0) return 8;
  if (sanma && indicatorKind === 8) return 0;
  return doraFromIndicator(indicatorKind);
}

export function toCounts(tiles: readonly Tile[]): number[] {
  const counts = new Array<number>(NUM_KINDS).fill(0);
  for (const t of tiles) counts[kindOf(t)]++;
  return counts;
}

export function kindsToCounts(kinds: readonly Kind[]): number[] {
  const counts = new Array<number>(NUM_KINDS).fill(0);
  for (const k of kinds) counts[k]++;
  return counts;
}

const HONOR_NAMES = ["東", "南", "西", "北", "白", "發", "中"];
const NUM_KANJI = ["一", "二", "三", "四", "伍", "六", "七", "八", "九"];
const SUIT_NAMES = ["萬", "筒", "索"];

/** 表示用の名前（例: 五萬, 東） */
export function kindName(kind: Kind): string {
  if (kind >= 27) return HONOR_NAMES[kind - 27];
  return NUM_KANJI[kind % 9] + SUIT_NAMES[Math.floor(kind / 9)];
}

/** 短い表記（例: 5m, 3p, 7s, 東） */
export function kindShort(kind: Kind): string {
  if (kind >= 27) return HONOR_NAMES[kind - 27];
  return `${(kind % 9) + 1}${"mps"[Math.floor(kind / 9)]}`;
}

/**
 * テスト・デバッグ用: "123m456p789s11z" 形式の文字列を牌種の配列にする。
 * z は 1=東 2=南 3=西 4=北 5=白 6=發 7=中。0 は赤5（牌種は5として扱う）。
 */
export function parseKinds(s: string): Kind[] {
  const out: Kind[] = [];
  let digits: number[] = [];
  for (const ch of s.replace(/\s/g, "")) {
    if (/[0-9]/.test(ch)) {
      digits.push(Number(ch));
      continue;
    }
    const base = ch === "m" ? 0 : ch === "p" ? 9 : ch === "s" ? 18 : ch === "z" ? 27 : -1;
    if (base < 0) throw new Error(`bad tile string: ${s}`);
    for (const d of digits) out.push(base + (d === 0 ? 5 : d) - 1);
    digits = [];
  }
  return out;
}

/** テスト用: 文字列から実際の牌IDを割り当てる（赤5は "0" で指定）。 */
export function parseTiles(s: string): Tile[] {
  const used = new Set<Tile>();
  const out: Tile[] = [];
  let digits: number[] = [];
  for (const ch of s.replace(/\s/g, "")) {
    if (/[0-9]/.test(ch)) {
      digits.push(Number(ch));
      continue;
    }
    const base = ch === "m" ? 0 : ch === "p" ? 9 : ch === "s" ? 18 : 27;
    for (const d of digits) {
      const kind = base + (d === 0 ? 5 : d) - 1;
      let chosen = -1;
      if (d === 0) {
        chosen = kind * 4;
      } else {
        // 赤(copy 0)は明示指定時のみ使う
        for (let c = 1; c < 4; c++) {
          if (!used.has(kind * 4 + c)) {
            chosen = kind * 4 + c;
            break;
          }
        }
        if (chosen < 0 && !used.has(kind * 4)) chosen = kind * 4;
      }
      if (chosen < 0 || used.has(chosen)) throw new Error(`too many tiles of ${kind} in ${s}`);
      used.add(chosen);
      out.push(chosen);
    }
    digits = [];
  }
  return out;
}
