// CPUの思考
// 弱い: 牌効率のみ / 普通: 牌効率＋簡単な押し引き / 強い: 押し引きと鳴き判断を強化
import {
  ankanOptions,
  baseHand,
  callOptions,
  canKyuushu,
  canNuki,
  doraIndicatorsShown,
  isSanma,
  isMenzen,
  kakanOptions,
  legalDiscards,
  removeTiles,
  riichiDiscards,
  roundWindKind,
  seatWindKind,
} from "./query.ts";
import { hashUnit } from "./rng.ts";
import { shanten } from "./shanten.ts";
import {
  YAOCHU_KINDS,
  doraFromIndicatorFor,
  isDragon,
  isHonor,
  isRed,
  isYaochu,
  kindOf,
  numberOf,
  suitOf,
  toCounts,
  type Kind,
  type Tile,
} from "./tiles.ts";
import type { Action, CpuLevel, GameState } from "./types.ts";

const DELAY: Record<CpuLevel, [number, number]> = {
  weak: [1500, 3000],
  normal: [1000, 2000],
  strong: [500, 1000],
};

export function cpuDelayMs(s: GameState, seat: number, salt: number): number {
  const [lo, hi] = DELAY[s.seats[seat].cpuLevel];
  return Math.round(lo + (hi - lo) * hashUnit(s.seed, seat, salt, s.kyokuSerial));
}

/** 自分から見えている牌の枚数（手牌・全員の河・副露・ドラ表示牌） */
function visibleCounts(s: GameState, seat: number): number[] {
  const k = s.kyoku!;
  const c = toCounts(k.players[seat].hand);
  for (const p of k.players) {
    for (const r of p.river) if (r.calledBy === null) c[kindOf(r.tile)]++;
    for (const m of p.melds) for (const t of m.tiles) c[kindOf(t)]++;
    for (const t of p.nuki ?? []) c[kindOf(t)]++;
  }
  // 三人麻雀で使わない牌は「すべて見えている」扱いにする（有効牌に数えない）
  if (isSanma(s)) for (let kd = 1; kd <= 7; kd++) c[kd] = 4;
  for (const t of doraIndicatorsShown(s)) c[kindOf(t)]++;
  return c;
}

function ukeire(counts: number[], meldCount: number, visible: number[], base: number): number {
  let n = 0;
  for (let kd = 0; kd < 34; kd++) {
    if (counts[kd] >= 4) continue;
    counts[kd]++;
    if (shanten(counts, meldCount) < base) n += Math.max(0, 4 - visible[kd]);
    counts[kd]--;
  }
  return n;
}

function threats(s: GameState, seat: number, level: CpuLevel): number[] {
  const k = s.kyoku!;
  const out: number[] = [];
  for (let i = 0; i < k.players.length; i++) {
    if (i === seat) continue;
    const p = k.players[i];
    if (p.riichi > 0) out.push(i);
    else if (level === "strong" && p.melds.filter((m) => m.type !== "ankan").length >= 3) out.push(i);
  }
  return out;
}

/** 牌の安全度（大きいほど安全） */
function safety(s: GameState, kind: Kind, threatSeats: number[], visible: number[]): number {
  const k = s.kyoku!;
  let min = Infinity;
  for (const t of threatSeats) {
    const p = k.players[t];
    const riverKinds = new Set(p.river.map((r) => kindOf(r.tile)));
    let v = 0;
    if (riverKinds.has(kind)) v = 100;
    else if (isHonor(kind)) v = 40 + visible[kind] * 15;
    else {
      const n = numberOf(kind);
      const suji: Kind[] = [];
      if (n - 3 >= 1) suji.push(kind - 3);
      if (n + 3 <= 9) suji.push(kind + 3);
      const sujiSafe = suji.length > 0 && suji.every((x) => riverKinds.has(x));
      const halfSuji = suji.some((x) => riverKinds.has(x));
      if (sujiSafe) v = 55;
      else if (halfSuji) v = 30;
      if (n === 1 || n === 9) v += 15;
      else if (n === 2 || n === 8) v += 8;
      v += visible[kind] * 4;
    }
    min = Math.min(min, v);
  }
  return min === Infinity ? 0 : min;
}

function doraKinds(s: GameState): Kind[] {
  return doraIndicatorsShown(s).map((t) => doraFromIndicatorFor(kindOf(t), isSanma(s)));
}

function isYakuhai(s: GameState, seat: number, kind: Kind): boolean {
  return isDragon(kind) || kind === seatWindKind(s, seat) || kind === roundWindKind(s);
}

interface DiscardEval {
  tile: Tile;
  shanten: number;
  ukeire: number;
  score: number;
}

function evaluateDiscards(s: GameState, seat: number, candidates: Tile[], level: CpuLevel): DiscardEval[] {
  const k = s.kyoku!;
  const p = k.players[seat];
  const visible = visibleCounts(s, seat);
  const doras = doraKinds(s);
  const byKind = new Map<Kind, Tile>();
  for (const t of candidates) {
    const kd = kindOf(t);
    const prev = byKind.get(kd);
    // 同じ牌種なら赤ドラ以外を優先して捨てる
    if (prev === undefined || (isRed(prev, s.rules.aka) && !isRed(t, s.rules.aka))) byKind.set(kd, t);
  }
  const out: DiscardEval[] = [];
  for (const [kd, t] of byKind) {
    const rest = toCounts(removeTiles(p.hand, [t]));
    const sh = shanten(rest, p.melds.length);
    const uk = ukeire(rest, p.melds.length, visible, sh);
    let score = -sh * 1000 + uk * 10;
    // 孤立した字牌・端牌から切る、ドラ・赤・役牌は残す
    if (isHonor(kd)) score += isYakuhai(s, seat, kd) && rest[kd] >= 1 ? -8 : 6;
    else if (isYaochu(kd)) score += 3;
    if (doras.includes(kd)) score -= level === "weak" ? 2 : 12;
    if (isRed(t, s.rules.aka)) score -= level === "weak" ? 2 : 12;
    out.push({ tile: t, shanten: sh, ukeire: uk, score });
  }
  return out;
}

export function cpuChooseSelfAction(s: GameState, seat: number): Action {
  const k = s.kyoku!;
  const p = k.players[seat];
  const level = s.seats[seat].cpuLevel;

  // 北は抜けるときは常に抜く（抜きドラ）
  if (canNuki(s, seat)) return { type: "nuki", seat };

  if (p.riichi > 0) {
    const ak = ankanOptions(s, seat);
    if (ak.length > 0 && level !== "weak") return { type: "ankan", seat, kind: ak[0] };
    return { type: "discard", seat, tile: p.drawn ?? legalDiscards(s, seat)[0] };
  }

  if (canKyuushu(s, seat)) {
    const counts = toCounts(p.hand);
    const kinds = YAOCHU_KINDS.filter((kd) => counts[kd] > 0).length;
    if (level === "weak" || kinds < 11) return { type: "kyuushu", seat };
  }

  const th = threats(s, seat, level);
  const curShanten = shanten(toCounts(p.hand), p.melds.length);

  // 暗槓・加槓（リーチ者がいるときは控える）
  if (th.length === 0 || level === "weak") {
    for (const kd of ankanOptions(s, seat)) {
      const after = p.hand.filter((t) => kindOf(t) !== kd);
      if (shanten(toCounts(after), p.melds.length + 1) <= curShanten) return { type: "ankan", seat, kind: kd };
    }
    if (level !== "weak") {
      for (const kd of kakanOptions(s, seat)) return { type: "kakan", seat, kind: kd };
    }
  }

  const legal = legalDiscards(s, seat);
  const evals = evaluateDiscards(s, seat, legal, level);
  evals.sort((a, b) => b.score - a.score);
  let choice = evals[0];

  // 押し引き
  if (level !== "weak" && th.length > 0) {
    const bestShanten = Math.min(...evals.map((e) => e.shanten));
    const doras = doraKinds(s);
    const value =
      p.hand.filter((t) => doras.includes(kindOf(t)) || isRed(t, s.rules.aka)).length +
      p.melds.filter((m) => isYakuhai(s, seat, kindOf(m.tiles[0])) && m.type !== "chi").length;
    const fold = level === "normal" ? bestShanten >= 2 : bestShanten >= 2 || (bestShanten === 1 && value < 2);
    if (fold) {
      const visible = visibleCounts(s, seat);
      const safest = evals
        .map((e) => ({ e, safe: safety(s, kindOf(e.tile), th, visible) }))
        .sort((a, b) => b.safe - a.safe || b.e.score - a.e.score);
      choice = safest[0].e;
    }
  }

  // 立直判断
  const rd = riichiDiscards(s, seat);
  if (rd.includes(choice.tile) && choice.shanten === 0) {
    const wantRiichi = level !== "strong" || k.wall.length >= 4 || th.length === 0;
    if (wantRiichi) return { type: "discard", seat, tile: choice.tile, riichi: true };
  }
  return { type: "discard", seat, tile: choice.tile };
}

function flushSuit(kinds: Kind[]): number | null {
  const bySuit = [0, 0, 0];
  let honors = 0;
  for (const kd of kinds) {
    if (isHonor(kd)) honors++;
    else bySuit[suitOf(kd)]++;
  }
  const best = bySuit.indexOf(Math.max(...bySuit));
  return bySuit[best] + honors >= kinds.length - 3 ? best : null;
}

export function cpuChooseCall(s: GameState, seat: number, from: number): Action | null {
  const k = s.kyoku!;
  const p = k.players[seat];
  const level = s.seats[seat].cpuLevel;
  const opts = callOptions(s, seat).filter((o) => o.from === from && o.type !== "minkan");
  if (opts.length === 0) return null;
  const base = baseHand(p);
  if (!base) return null;
  const curShanten = shanten(toCounts(base), p.melds.length);
  const th = threats(s, seat, level);
  const allKinds = [...base, ...p.melds.flatMap((m) => m.tiles)].map(kindOf);
  const hasYakuhaiMeld = p.melds.some((m) => m.type !== "chi" && isYakuhai(s, seat, kindOf(m.tiles[0])));
  const doras = doraKinds(s);

  let best: { action: Action; shanten: number } | null = null;
  for (const o of opts) {
    const targetKind = kindOf(o.target);
    const rest = removeTiles(base, o.tiles);
    const afterKinds = [...rest.map(kindOf), ...p.melds.flatMap((m) => m.tiles).map(kindOf), targetKind, ...o.tiles.map(kindOf)];
    let after = Infinity;
    for (const d of rest) {
      const sh = shanten(toCounts(removeTiles(rest, [d])), p.melds.length + 1);
      if (sh < after) after = sh;
    }
    const yakuhaiPon = o.type === "pon" && isYakuhai(s, seat, targetKind);
    let allowed = false;
    if (yakuhaiPon) allowed = true;
    else if (level !== "weak") {
      const tanyao = s.rules.kuitan && afterKinds.every((kd) => !isYaochu(kd));
      const flush = level === "strong" && flushSuit(allKinds) !== null && afterKinds.every((kd) => isHonor(kd) || suitOf(kd) === flushSuit(allKinds));
      const restCounts = toCounts(rest);
      const pairOfYakuhai = level === "strong" && rest.some((t) => isYakuhai(s, seat, kindOf(t)) && restCounts[kindOf(t)] >= 2);
      allowed = (hasYakuhaiMeld || tanyao || flush || pairOfYakuhai) && after < curShanten;
      // 門前でドラが多い手は崩さない
      const doraCount = base.filter((t) => doras.includes(kindOf(t)) || isRed(t, s.rules.aka)).length;
      if (isMenzen(p) && curShanten <= 1 && doraCount >= 2 && !hasYakuhaiMeld) allowed = false;
    }
    if (!allowed) continue;
    if (th.length > 0 && level !== "weak" && after >= 2) continue;
    if (!best || after < best.shanten) {
      best = { action: { type: o.type, seat, from: o.from, index: o.index, tiles: o.tiles }, shanten: after };
    }
  }
  return best ? best.action : null;
}
