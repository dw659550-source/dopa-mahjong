import { decompose, type ConcealedSet, type Decomposition } from "./agari.ts";
import {
  CHUN,
  EAST,
  HAKU,
  HATSU,
  doraFromIndicatorFor,
  isDragon,
  isHonor,
  isRed,
  isSimple,
  isTerminal,
  isWind,
  isYaochu,
  kindOf,
  numberOf,
  suitOf,
  toCounts,
  type Kind,
  type Tile,
} from "./tiles.ts";

export type MeldType = "chi" | "pon" | "minkan" | "ankan" | "kakan";

export interface Meld {
  type: MeldType;
  tiles: Tile[];
  /** 鳴いた相手の席（暗槓は null） */
  from: number | null;
  /** 鳴いた牌（暗槓は null） */
  calledTile: Tile | null;
}

export function meldIsOpen(m: Meld): boolean {
  return m.type !== "ankan";
}

export function meldIsKan(m: Meld): boolean {
  return m.type === "minkan" || m.type === "ankan" || m.type === "kakan";
}

export function meldBaseKind(m: Meld): Kind {
  return Math.min(...m.tiles.map(kindOf));
}

export interface WinInput {
  /** 和了牌を含む純手牌 */
  hand: Tile[];
  melds: Meld[];
  winTile: Tile;
  isTsumo: boolean;
  seatWind: Kind;
  roundWind: Kind;
  riichi: 0 | 1 | 2; // 0=なし 1=立直 2=両立直
  ippatsu: boolean;
  rinshan: boolean;
  chankan: boolean;
  haitei: boolean;
  houtei: boolean;
  tenhou: boolean;
  chiihou: boolean;
  doraIndicators: Tile[];
  uraIndicators: Tile[];
  aka: boolean;
  kuitan: boolean;
  /** 三人麻雀（ドラ表示の一萬→九萬） */
  sanma?: boolean;
  /** 抜いた北（抜きドラ。ドラ・裏ドラの数え上げにも含める） */
  nuki?: Tile[];
}

export interface YakuItem {
  name: string;
  han: number; // 役満の場合は倍数
}

export interface WinResult {
  yaku: YakuItem[]; // 懸賞役（ドラ等）を含む
  han: number;
  fu: number;
  yakumanMult: number; // 0=通常役
  basePoints: number; // 基本点
  label: string; // 満貫 など（なければ空）
  /** 縛り判定用: 懸賞役を除いた飜数（役満なら13以上扱い） */
  yakuHan: number;
}

type Wait = "tanki" | "ryanmen" | "kanchan" | "penchan" | "shanpon";

interface Group {
  type: "seq" | "trip" | "kan";
  kind: Kind;
  open: boolean; // 副露による面子
  concealed: boolean; // 暗刻・暗槓として扱うか（ロンで完成した刻子は false）
}

const GREEN = new Set<Kind>([19, 20, 21, 23, 25, HATSU]);

function basePointsFor(han: number, fu: number): { base: number; label: string } {
  if (han >= 13) return { base: 8000, label: "数え役満" };
  if (han >= 11) return { base: 6000, label: "三倍満" };
  if (han >= 8) return { base: 4000, label: "倍満" };
  if (han >= 6) return { base: 3000, label: "跳満" };
  if (han >= 5) return { base: 2000, label: "満貫" };
  const b = fu * Math.pow(2, han + 2);
  if (b >= 2000) return { base: 2000, label: "満貫" };
  return { base: b, label: "" };
}

function countDora(input: WinInput, handTiles: Tile[]): { dora: number; ura: number; aka: number; nuki: number } {
  const nukiTiles = input.nuki ?? [];
  const allTiles = [...handTiles, ...nukiTiles];
  const kinds = allTiles.map(kindOf);
  const sanma = !!input.sanma;
  let dora = 0;
  for (const ind of input.doraIndicators) {
    const d = doraFromIndicatorFor(kindOf(ind), sanma);
    dora += kinds.filter((k) => k === d).length;
  }
  let ura = 0;
  if (input.riichi > 0) {
    for (const ind of input.uraIndicators) {
      const d = doraFromIndicatorFor(kindOf(ind), sanma);
      ura += kinds.filter((k) => k === d).length;
    }
  }
  const aka = allTiles.filter((t) => isRed(t, input.aka)).length;
  return { dora, ura, aka, nuki: nukiTiles.length };
}

function groupKinds(g: Group): Kind[] {
  if (g.type === "seq") return [g.kind, g.kind + 1, g.kind + 2];
  return [g.kind, g.kind, g.kind];
}

function meldToGroup(m: Meld): Group {
  const kind = meldBaseKind(m);
  if (m.type === "chi") return { type: "seq", kind, open: true, concealed: false };
  if (m.type === "pon") return { type: "trip", kind, open: true, concealed: false };
  return { type: "kan", kind, open: m.type !== "ankan", concealed: m.type === "ankan" };
}

interface Placement {
  groups: Group[]; // 手牌の面子＋副露
  pair: Kind;
  wait: Wait;
}

/** 和了牌がどの面子/雀頭に入ったかのパターンを列挙 */
function placements(dec: { pair: Kind; sets: ConcealedSet[] }, melds: Meld[], winKind: Kind, isTsumo: boolean): Placement[] {
  const meldGroups = melds.map(meldToGroup);
  const base: Group[] = dec.sets.map((s) => ({
    type: s.type,
    kind: s.kind,
    open: false,
    concealed: true,
  }));
  const out: Placement[] = [];
  if (dec.pair === winKind) {
    out.push({ groups: [...base, ...meldGroups], pair: dec.pair, wait: "tanki" });
  }
  const seen = new Set<string>();
  base.forEach((g, idx) => {
    const kinds = groupKinds(g);
    if (!kinds.includes(winKind)) return;
    let wait: Wait;
    if (g.type === "trip") {
      wait = "shanpon";
    } else {
      const pos = winKind - g.kind;
      if (pos === 1) wait = "kanchan";
      else if (pos === 0) wait = numberOf(g.kind) === 7 ? "penchan" : "ryanmen";
      else wait = numberOf(g.kind) === 1 ? "penchan" : "ryanmen";
    }
    const key = `${g.type}${g.kind}${wait}`;
    if (seen.has(key)) return;
    seen.add(key);
    const groups = base.map((x, i) =>
      i === idx && x.type === "trip" && !isTsumo ? { ...x, concealed: false } : x,
    );
    out.push({ groups: [...groups, ...meldGroups], pair: dec.pair, wait });
  });
  return out;
}

function isYakuhaiKind(k: Kind, seatWind: Kind, roundWind: Kind): boolean {
  return isDragon(k) || k === seatWind || k === roundWind;
}

function evaluateYakuman(
  input: WinInput,
  dec: Decomposition,
  pl: Placement | null,
  allKinds: Kind[],
  handCounts: number[],
): YakuItem[] {
  const y: YakuItem[] = [];
  const winKind = kindOf(input.winTile);
  const menzen = input.melds.every((m) => !meldIsOpen(m));
  if (input.tenhou) y.push({ name: "天和", han: 1 });
  if (input.chiihou) y.push({ name: "地和", han: 1 });

  if (dec.form === "kokushi") {
    const before = handCounts.slice();
    before[winKind]--;
    const thirteen = before[winKind] === 1 && dec.pair === winKind;
    y.push({ name: thirteen ? "国士無双13面" : "国士無双", han: 1 });
    return y;
  }

  if (allKinds.every(isHonor)) y.push({ name: "字一色", han: 1 });
  if (allKinds.every((k) => GREEN.has(k))) y.push({ name: "緑一色", han: 1 });
  if (allKinds.every(isTerminal)) y.push({ name: "清老頭", han: 1 });

  if (dec.form === "standard" && pl) {
    const trips = pl.groups.filter((g) => g.type !== "seq");
    const dragonTrips = trips.filter((g) => isDragon(g.kind)).length;
    if (dragonTrips === 3) y.push({ name: "大三元", han: 1 });
    const windTrips = trips.filter((g) => isWind(g.kind)).length;
    if (windTrips === 4) y.push({ name: "大四喜", han: 1 });
    else if (windTrips === 3 && isWind(pl.pair)) y.push({ name: "小四喜", han: 1 });
    const concealedTrips = trips.filter((g) => g.concealed).length;
    if (concealedTrips === 4) {
      y.push({ name: pl.wait === "tanki" ? "四暗刻単騎" : "四暗刻", han: 1 });
    }
    if (pl.groups.filter((g) => g.type === "kan").length === 4) y.push({ name: "四槓子", han: 1 });

    // 九蓮宝燈（暗槓があると不成立）
    if (menzen && input.melds.length === 0) {
      const suit = suitOf(allKinds[0]);
      if (suit < 3 && allKinds.every((k) => suitOf(k) === suit)) {
        const c = handCounts.slice(suit * 9, suit * 9 + 9);
        const pattern = [3, 1, 1, 1, 1, 1, 1, 1, 3];
        if (c.every((n, i) => n >= pattern[i])) {
          const before = c.slice();
          before[winKind - suit * 9]--;
          const junsei = before.every((n, i) => n === pattern[i]);
          y.push({ name: junsei ? "純正九蓮宝燈" : "九蓮宝燈", han: 1 });
        }
      }
    }
  }
  return y;
}

interface Candidate {
  yaku: YakuItem[];
  yakuHan: number;
  fu: number;
}

function evaluateStandard(input: WinInput, pl: Placement, allKinds: Kind[]): Candidate {
  const y: YakuItem[] = [];
  const menzen = input.melds.every((m) => !meldIsOpen(m));
  const open = !menzen;
  const groups = pl.groups;
  const seqs = groups.filter((g) => g.type === "seq");
  const trips = groups.filter((g) => g.type !== "seq");
  const { seatWind, roundWind } = input;

  addSituational(input, y, menzen);

  // 役牌
  for (const g of trips) {
    if (g.kind === HAKU) y.push({ name: "役牌 白", han: 1 });
    if (g.kind === HATSU) y.push({ name: "役牌 發", han: 1 });
    if (g.kind === CHUN) y.push({ name: "役牌 中", han: 1 });
    if (g.kind === seatWind) y.push({ name: `自風 ${windName(g.kind)}`, han: 1 });
    if (g.kind === roundWind) y.push({ name: `場風 ${windName(g.kind)}`, han: 1 });
  }

  if (allKinds.every(isSimple) && (menzen || input.kuitan)) y.push({ name: "断幺九", han: 1 });

  const pinfu =
    menzen &&
    seqs.length === 4 &&
    !isYakuhaiKind(pl.pair, seatWind, roundWind) &&
    pl.wait === "ryanmen";
  if (pinfu) y.push({ name: "平和", han: 1 });

  // 一盃口・二盃口
  if (menzen) {
    const seqKeys = seqs.map((g) => g.kind).sort((a, b) => a - b);
    let peiko = 0;
    const used = new Array(seqKeys.length).fill(false);
    for (let i = 0; i < seqKeys.length; i++) {
      if (used[i]) continue;
      for (let j = i + 1; j < seqKeys.length; j++) {
        if (!used[j] && seqKeys[i] === seqKeys[j]) {
          used[i] = used[j] = true;
          peiko++;
          break;
        }
      }
    }
    if (peiko === 2) y.push({ name: "二盃口", han: 3 });
    else if (peiko === 1) y.push({ name: "一盃口", han: 1 });
  }

  // 三色同順
  for (let n = 0; n < 7; n++) {
    if ([0, 1, 2].every((s) => seqs.some((g) => g.kind === s * 9 + n))) {
      y.push({ name: "三色同順", han: open ? 1 : 2 });
      break;
    }
  }
  // 一気通貫
  for (let s = 0; s < 3; s++) {
    if ([0, 3, 6].every((n) => seqs.some((g) => g.kind === s * 9 + n))) {
      y.push({ name: "一気通貫", han: open ? 1 : 2 });
      break;
    }
  }
  // 混全帯幺九 / 純全帯幺九
  const allGroupsYaochu =
    groups.every((g) => groupKinds(g).some(isYaochu)) && isYaochu(pl.pair);
  if (allGroupsYaochu && seqs.length > 0) {
    const hasHonor = allKinds.some(isHonor);
    if (hasHonor) y.push({ name: "混全帯幺九", han: open ? 1 : 2 });
    else y.push({ name: "純全帯幺九", han: open ? 2 : 3 });
  }
  if (trips.length === 4) y.push({ name: "対々和", han: 2 });
  const concealedTrips = trips.filter((g) => g.concealed).length;
  if (concealedTrips === 3) y.push({ name: "三暗刻", han: 2 });
  for (let n = 0; n < 9; n++) {
    if ([0, 1, 2].every((s) => trips.some((g) => g.kind === s * 9 + n))) {
      y.push({ name: "三色同刻", han: 2 });
      break;
    }
  }
  if (groups.filter((g) => g.type === "kan").length === 3) y.push({ name: "三槓子", han: 2 });
  const dragonTrips = trips.filter((g) => isDragon(g.kind)).length;
  if (dragonTrips === 2 && isDragon(pl.pair)) y.push({ name: "小三元", han: 2 });
  if (allKinds.every(isYaochu)) y.push({ name: "混老頭", han: 2 });
  addFlush(y, allKinds, open);

  const yakuHan = y.reduce((a, b) => a + b.han, 0);

  // 符
  let fu: number;
  if (pinfu && input.isTsumo) {
    fu = 20;
  } else {
    fu = 20;
    if (menzen && !input.isTsumo) fu += 10;
    if (input.isTsumo && !pinfu) fu += 2;
    if (pl.wait === "tanki" || pl.wait === "kanchan" || pl.wait === "penchan") fu += 2;
    if (isDragon(pl.pair)) fu += 2;
    if (pl.pair === seatWind) fu += 2;
    if (pl.pair === roundWind) fu += 2;
    for (const g of trips) {
      const yao = isYaochu(g.kind);
      let f = g.type === "kan" ? 8 : 2;
      if (g.concealed) f *= 2;
      if (yao) f *= 2;
      fu += f;
    }
    fu = Math.ceil(fu / 10) * 10;
    if (fu === 20 && !input.isTsumo) fu = 30; // 喰い平和形のロン
    if (fu === 20 && open) fu = 30; // 喰い平和形のツモ
  }
  return { yaku: y, yakuHan, fu };
}

function evaluateChiitoi(input: WinInput, allKinds: Kind[]): Candidate {
  const y: YakuItem[] = [];
  addSituational(input, y, true);
  y.push({ name: "七対子", han: 2 });
  if (allKinds.every(isSimple)) y.push({ name: "断幺九", han: 1 });
  if (allKinds.every(isYaochu)) y.push({ name: "混老頭", han: 2 });
  addFlush(y, allKinds, false);
  return { yaku: y, yakuHan: y.reduce((a, b) => a + b.han, 0), fu: 25 };
}

function addSituational(input: WinInput, y: YakuItem[], menzen: boolean) {
  if (input.riichi === 2) y.push({ name: "両立直", han: 2 });
  else if (input.riichi === 1) y.push({ name: "立直", han: 1 });
  if (input.ippatsu && input.riichi > 0) y.push({ name: "一発", han: 1 });
  if (menzen && input.isTsumo) y.push({ name: "門前清自摸和", han: 1 });
  if (input.chankan) y.push({ name: "槍槓", han: 1 });
  if (input.rinshan) y.push({ name: "嶺上開花", han: 1 });
  if (input.haitei && input.isTsumo && !input.rinshan) y.push({ name: "海底摸月", han: 1 });
  if (input.houtei && !input.isTsumo) y.push({ name: "河底撈魚", han: 1 });
}

function addFlush(y: YakuItem[], allKinds: Kind[], open: boolean) {
  const suits = new Set(allKinds.filter((k) => !isHonor(k)).map(suitOf));
  const hasHonor = allKinds.some(isHonor);
  if (suits.size === 1) {
    if (hasHonor) y.push({ name: "混一色", han: open ? 2 : 3 });
    else y.push({ name: "清一色", han: open ? 5 : 6 });
  }
}

function windName(k: Kind): string {
  return ["東", "南", "西", "北"][k - EAST];
}

/**
 * 和了の評価。和了形でない、または役がない場合は null。
 * 役が複数の解釈を持つ場合、最も高い点数になる解釈を採用する。
 */
export function evaluateWin(input: WinInput): WinResult | null {
  const handCounts = toCounts(input.hand);
  const meldCount = input.melds.length;
  const decs = decompose(handCounts, meldCount);
  if (decs.length === 0) return null;

  const allTiles = [...input.hand, ...input.melds.flatMap((m) => m.tiles)];
  const allKinds = allTiles.map(kindOf);
  const winKind = kindOf(input.winTile);

  // 役満
  let bestYakuman: YakuItem[] = [];
  for (const dec of decs) {
    const pls = dec.form === "standard" ? placements(dec, input.melds, winKind, input.isTsumo) : [null];
    for (const pl of pls) {
      const ym = evaluateYakuman(input, dec, pl, allKinds, handCounts);
      if (sumHan(ym) > sumHan(bestYakuman)) bestYakuman = ym;
    }
  }
  if (bestYakuman.length > 0) {
    const mult = sumHan(bestYakuman);
    return {
      yaku: bestYakuman,
      han: 13 * mult,
      fu: 0,
      yakumanMult: mult,
      basePoints: 8000 * mult,
      label: mult >= 2 ? `${mult}倍役満` : "役満",
      yakuHan: 13 * mult,
    };
  }

  const candidates: Candidate[] = [];
  for (const dec of decs) {
    if (dec.form === "kokushi") continue;
    if (dec.form === "chiitoi") {
      candidates.push(evaluateChiitoi(input, allKinds));
      continue;
    }
    for (const pl of placements(dec, input.melds, winKind, input.isTsumo)) {
      candidates.push(evaluateStandard(input, pl, allKinds));
    }
  }

  const { dora, ura, aka, nuki } = countDora(input, allTiles);
  let best: WinResult | null = null;
  for (const c of candidates) {
    if (c.yakuHan < 1) continue;
    const yaku = c.yaku.slice();
    if (dora > 0) yaku.push({ name: "ドラ", han: dora });
    if (aka > 0) yaku.push({ name: "赤ドラ", han: aka });
    if (ura > 0) yaku.push({ name: "裏ドラ", han: ura });
    if (nuki > 0) yaku.push({ name: "抜きドラ", han: nuki });
    const han = c.yakuHan + dora + aka + ura + nuki;
    const { base, label } = basePointsFor(han, c.fu);
    const r: WinResult = { yaku, han, fu: c.fu, yakumanMult: 0, basePoints: base, label, yakuHan: c.yakuHan };
    if (
      !best ||
      r.basePoints > best.basePoints ||
      (r.basePoints === best.basePoints && (r.han > best.han || (r.han === best.han && r.fu > best.fu)))
    ) {
      best = r;
    }
  }
  return best;
}

function sumHan(y: YakuItem[]): number {
  return y.reduce((a, b) => a + b.han, 0);
}

function ceil100(n: number): number {
  return Math.ceil(n / 100) * 100;
}

/** ロンの支払額（積み棒を除く） */
export function ronPoints(base: number, isDealer: boolean): number {
  return ceil100(base * (isDealer ? 6 : 4));
}

/** ツモの支払額（積み棒を除く）。[親の支払い, 子の支払い]。親の和了なら両方同じ。 */
export function tsumoPoints(base: number, isDealer: boolean): { fromDealer: number; fromChild: number } {
  if (isDealer) {
    const each = ceil100(base * 2);
    return { fromDealer: each, fromChild: each };
  }
  return { fromDealer: ceil100(base * 2), fromChild: ceil100(base) };
}

