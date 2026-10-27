// 対局状態を読み取るだけの関数群（UI・CPU・エンジンで共有）
import { waitingKinds, shanten } from "./shanten.ts";
import { mightyAgariKinds, mightyShanten, mightyWaitingKinds } from "./mighty.ts";
import { EAST, NORTH, YAOCHU_KINDS, kindOf, numberOf, suitOf, toCounts, type Kind, type Tile } from "./tiles.ts";
import { evaluateWin, meldIsOpen, type WinResult } from "./yaku.ts";
import { DISCARD_TIMEOUT_MS, TURN_TIMEOUT_MS, type CallWindow, type GameState, type PlayerState, type RonTarget } from "./types.ts";

export function dealerSeat(state: GameState): number {
  return state.kyokuNum;
}

/** 人数（三人麻雀は3） */
export function playerCount(state: GameState): number {
  return state.seats.length;
}

export function isSanma(state: GameState): boolean {
  return state.seats.length === 3;
}

/** ドパなし（順番にツモ・打牌する進行） */
export function isTurnBased(state: GameState): boolean {
  return !!state.rules.turnBased;
}

/** 人の打牌の制限時間（ドパなしは1手番の時間） */
export function discardTimeoutMs(state: GameState): number {
  return isTurnBased(state) ? TURN_TIMEOUT_MS : DISCARD_TIMEOUT_MS;
}

/** ドパなしの鳴き・ロンの確認中なら、その内容 */
export function callWindowOf(state: GameState): CallWindow | null {
  return state.kyoku?.callWindow ?? null;
}

/** ドパなし：この席が、確認中の牌に対してまだロン・鳴きを選べるか（スキップ・鳴きの宣言をしていない） */
function windowOpenFor(state: GameState, seat: number, type: CallWindow["type"], from: number): boolean {
  const w = callWindowOf(state);
  return !!w && w.type === type && w.from === from && from !== seat && !w.passed.includes(seat) && w.claim?.seat !== seat;
}

export function seatWindKind(state: GameState, seat: number): Kind {
  const n = playerCount(state);
  return EAST + ((seat - dealerSeat(state) + n) % n);
}

export function roundWindKind(state: GameState): Kind {
  return EAST + state.roundWind;
}

export function kamicha(seat: number, n = 4): number {
  return (seat + n - 1) % n;
}

export function roundLabel(state: GameState): string {
  const wind = ["東", "南", "西", "北"][state.roundWind];
  return `${wind}${state.kyokuNum + 1}局${state.honba > 0 ? ` ${state.honba}本場` : ""}`;
}

export function removeTiles(hand: Tile[], tiles: Tile[]): Tile[] {
  const out = hand.slice();
  for (const t of tiles) {
    const i = out.indexOf(t);
    if (i < 0) throw new Error("手牌にない牌です");
    out.splice(i, 1);
  }
  return out;
}

/** ツモ牌を除いた、待ちの判定に使う手牌（3n+1枚）。鳴いた直後は null */
export function baseHand(p: PlayerState): Tile[] | null {
  if (p.drawn !== null) return removeTiles(p.hand, [p.drawn]);
  if (!p.mustDiscard) return p.hand.slice();
  return null;
}

/** 自分の牌すべて（指定した手牌・副露・抜いた北・extra）の牌種ごとの枚数。オールマイティの5枚目判定に使う */
function ownCounts(p: PlayerState, tiles: Tile[], extra: Tile[] = []): number[] {
  return toCounts([...tiles, ...p.melds.flatMap((m) => m.tiles), ...(p.nuki ?? []), ...extra]);
}

/** 待ちの牌種（少牌マイティならオールマイティ込み）。tiles は 3n+1 枚（少牌マイティは 3n 枚）の純手牌 */
export function waitKinds(p: PlayerState, tiles: Tile[], meldCount = p.melds.length, extraOwn: Tile[] = []): Kind[] {
  const c = toCounts(tiles);
  return p.mighty ? mightyWaitingKinds(c, meldCount, ownCounts(p, tiles, extraOwn)) : waitingKinds(c, meldCount);
}

export function waitsOf(p: PlayerState): Kind[] {
  const h = baseHand(p);
  if (!h) return [];
  return waitKinds(p, h);
}

export function isMenzen(p: PlayerState): boolean {
  return p.melds.every((m) => !meldIsOpen(m));
}

export function isFuriten(p: PlayerState, waits: Kind[] = waitsOf(p)): boolean {
  if (p.tempFuriten || p.riichiFuriten) return true;
  const riverKinds = new Set(p.river.map((r) => kindOf(r.tile)));
  return waits.some((k) => riverKinds.has(k));
}

export function wallRemaining(state: GameState): number {
  return state.kyoku ? state.kyoku.wall.length : 0;
}

export function doraIndicatorsShown(state: GameState): Tile[] {
  const k = state.kyoku;
  if (!k) return [];
  return k.doraIndicators.slice(0, k.doraRevealed);
}

interface WinFlags {
  isTsumo: boolean;
  chankan?: boolean;
  houtei?: boolean;
}

function evalHand(state: GameState, seat: number, hand: Tile[], winTile: Tile, flags: WinFlags): WinResult | null {
  const p = state.kyoku!.players[seat];
  if (!p.mighty) return evalHandWith(state, seat, hand, winTile, flags, undefined);
  // 少牌マイティ：オールマイティを、和了形になる牌のうち最も点数が高くなる牌として扱う
  const own = ownCounts(p, hand);
  const ownTiles = new Set([...hand, ...p.melds.flatMap((m) => m.tiles), ...(p.nuki ?? [])]);
  let best: WinResult | null = null;
  for (const w of mightyAgariKinds(toCounts(hand), p.melds.length, own)) {
    // その牌種の、自分が持っていない牌を1枚使う（赤かどうかは赤ドラの判定から外す）
    const wild = [0, 1, 2, 3].map((i) => w * 4 + i).find((t) => !ownTiles.has(t));
    if (wild === undefined) continue;
    const r = evalHandWith(state, seat, [...hand, wild], winTile, flags, wild);
    if (!r) continue;
    if (
      !best ||
      r.basePoints > best.basePoints ||
      (r.basePoints === best.basePoints && (r.han > best.han || (r.han === best.han && r.fu > best.fu)))
    ) {
      best = { ...r, wildTile: wild };
    }
  }
  return best;
}

function evalHandWith(
  state: GameState,
  seat: number,
  hand: Tile[],
  winTile: Tile,
  flags: WinFlags,
  wild: Tile | undefined,
): WinResult | null {
  const k = state.kyoku!;
  const p = k.players[seat];
  const isDealer = seat === dealerSeat(state);
  return evaluateWin({
    hand,
    melds: p.melds,
    winTile,
    isTsumo: flags.isTsumo,
    seatWind: seatWindKind(state, seat),
    roundWind: roundWindKind(state),
    riichi: p.riichi,
    ippatsu: p.ippatsu && p.riichi > 0 && !(flags.isTsumo && p.rinshan),
    rinshan: flags.isTsumo && p.rinshan,
    chankan: !!flags.chankan,
    haitei: flags.isTsumo && p.haitei && !p.rinshan,
    houtei: !!flags.houtei,
    tenhou: flags.isTsumo && isDealer && p.firstTurn,
    chiihou: flags.isTsumo && !isDealer && p.firstTurn,
    doraIndicators: k.doraIndicators.slice(0, k.doraRevealed),
    uraIndicators: k.uraIndicators.slice(0, k.doraRevealed),
    aka: state.rules.aka,
    kuitan: state.rules.kuitan,
    sanma: isSanma(state),
    nuki: p.nuki ?? [],
    wild,
  });
}

export function evalTsumo(state: GameState, seat: number): WinResult | null {
  if (state.phase !== "playing" || !state.kyoku) return null;
  const p = state.kyoku.players[seat];
  if (!p.mustDiscard || p.drawn === null) return null;
  return evalHand(state, seat, p.hand, p.drawn, { isTsumo: true });
}

/** ロンの対象牌。対象が有効でなければ null */
export function ronTargetTile(state: GameState, target: RonTarget): { tile: Tile; houtei: boolean; chankan: boolean } | null {
  const k = state.kyoku;
  if (!k) return null;
  const f = k.players[target.from];
  if (target.type === "kakan") {
    if (f.kakanTile === null) return null;
    return { tile: f.kakanTile, houtei: false, chankan: true };
  }
  if (target.type === "nuki") {
    // 抜いた北へのロン（天鳳と同じく役満以外でも和了可。槍槓は付かない）
    if (f.nukiTile === null || f.nukiTile === undefined) return null;
    return { tile: f.nukiTile, houtei: false, chankan: false };
  }
  const idx = f.river.length - 1;
  if (target.index !== idx || idx < 0) return null;
  const r = f.river[idx];
  if (r.calledBy !== null) return null;
  return { tile: r.tile, houtei: r.houtei, chankan: false };
}

export function evalRon(state: GameState, seat: number, target: RonTarget): WinResult | null {
  if (state.phase !== "playing" || !state.kyoku) return null;
  if (target.from === seat) return null;
  // ドパなしは、確認中の牌にだけロンできる（スキップした後はできない）
  if (isTurnBased(state) && !windowOpenFor(state, seat, target.type, target.from)) return null;
  const t = ronTargetTile(state, target);
  if (!t) return null;
  const p = state.kyoku.players[seat];
  const h = baseHand(p);
  if (!h) return null;
  const waits = waitKinds(p, h);
  if (!waits.includes(kindOf(t.tile))) return null;
  if (isFuriten(p, waits)) return null;
  return evalHand(state, seat, [...h, t.tile], t.tile, { isTsumo: false, chankan: t.chankan, houtei: t.houtei });
}

/** 今ロンできる対象の一覧 */
export function ronOptions(state: GameState, seat: number): RonTarget[] {
  const k = state.kyoku;
  if (!k || state.phase !== "playing") return [];
  const out: RonTarget[] = [];
  for (let f = 0; f < playerCount(state); f++) {
    if (f === seat) continue;
    const fp = k.players[f];
    if (fp.kakanTile !== null) {
      const t: RonTarget = { type: "kakan", from: f };
      if (evalRon(state, seat, t)) out.push(t);
    }
    if (fp.nukiTile !== null && fp.nukiTile !== undefined) {
      const t: RonTarget = { type: "nuki", from: f };
      if (evalRon(state, seat, t)) out.push(t);
    }
    const idx = fp.river.length - 1;
    if (idx >= 0) {
      const t: RonTarget = { type: "discard", from: f, index: idx };
      if (evalRon(state, seat, t)) out.push(t);
    }
  }
  return out;
}

/** 鳴ける状態の捨て牌（各プレイヤーの最新の捨て牌で、山が残っているとき） */
export function callableDiscard(state: GameState, from: number): { index: number; tile: Tile } | null {
  const k = state.kyoku;
  if (!k || state.phase !== "playing" || k.wall.length === 0) return null;
  const f = k.players[from];
  const idx = f.river.length - 1;
  if (idx < 0) return null;
  const r = f.river[idx];
  if (r.calledBy !== null || r.houtei) return null;
  // ドパなしは、確認中の捨て牌だけ鳴ける
  if (isTurnBased(state)) {
    const w = k.callWindow;
    if (!w || w.type !== "discard" || w.from !== from || w.index !== idx || w.claim) return null;
  }
  return { index: idx, tile: r.tile };
}

export interface CallOption {
  type: "chi" | "pon" | "minkan";
  from: number;
  index: number;
  tiles: Tile[]; // 手牌から出す牌
  target: Tile;
}

/** 鳴いた後の打牌で禁止される牌種（喰い替え） */
export function kuikaeKinds(type: "chi" | "pon", target: Tile, used: Tile[]): Kind[] {
  const c = kindOf(target);
  const out = [c];
  if (type === "chi") {
    const ks = used.map(kindOf).sort((a, b) => a - b);
    if (ks[0] === c + 1 && numberOf(c) <= 6) out.push(c + 3);
    if (ks[1] === c - 1 && numberOf(c) >= 4) out.push(c - 3);
  }
  return out;
}

function hasLegalDiscardAfter(hand: Tile[], forbidden: Kind[]): boolean {
  return hand.some((t) => !forbidden.includes(kindOf(t)));
}

export function canCallNow(state: GameState, seat: number): boolean {
  const k = state.kyoku;
  if (!k || state.phase !== "playing") return false;
  const p = k.players[seat];
  if (isTurnBased(state)) {
    // ドパなし：自分の手番ではなく、確認中の捨て牌にまだ答えていないとき
    const w = k.callWindow;
    return p.riichi === 0 && !p.mustDiscard && k.wall.length > 0 && !!w && w.type === "discard" && windowOpenFor(state, seat, "discard", w.from);
  }
  return p.riichi === 0 && p.mustDiscard && p.drawn !== null && !p.afterCall && k.wall.length > 0;
}

export function callOptions(state: GameState, seat: number): CallOption[] {
  if (!canCallNow(state, seat)) return [];
  const k = state.kyoku!;
  const p = k.players[seat];
  // ドパありは鳴く人もツモ牌を持っている（鳴くとツモ牌は山に戻る）
  const hand = isTurnBased(state) ? p.hand.slice() : removeTiles(p.hand, [p.drawn!]);
  const out: CallOption[] = [];
  const n = playerCount(state);
  for (let from = 0; from < n; from++) {
    if (from === seat) continue;
    const c = callableDiscard(state, from);
    if (!c) continue;
    const tk = kindOf(c.tile);
    const same = hand.filter((t) => kindOf(t) === tk);
    if (same.length >= 2) {
      // 赤ドラの有無で選択肢を分ける
      const variants = uniqueByRed(pairsOf(same), state.rules.aka);
      for (const v of variants) {
        const rest = removeTiles(hand, v);
        if (hasLegalDiscardAfter(rest, kuikaeKinds("pon", c.tile, v))) {
          out.push({ type: "pon", from, index: c.index, tiles: v, target: c.tile });
        }
      }
    }
    if (same.length >= 3 && k.kanCount < 4) {
      out.push({ type: "minkan", from, index: c.index, tiles: same.slice(0, 3), target: c.tile });
    }
    // 三人麻雀はチーなし
    if (n === 4 && from === kamicha(seat, n) && tk < 27) {
      const n = numberOf(tk);
      const patterns: [number, number][] = [];
      if (n >= 3) patterns.push([tk - 2, tk - 1]);
      if (n >= 2 && n <= 8) patterns.push([tk - 1, tk + 1]);
      if (n <= 7) patterns.push([tk + 1, tk + 2]);
      for (const [a, b] of patterns) {
        if (suitOf(a) !== suitOf(tk) || suitOf(b) !== suitOf(tk)) continue;
        const as = hand.filter((t) => kindOf(t) === a);
        const bs = hand.filter((t) => kindOf(t) === b);
        if (!as.length || !bs.length) continue;
        const combos: Tile[][] = [];
        for (const x of uniqueByRed(as.map((t) => [t]), state.rules.aka))
          for (const y of uniqueByRed(bs.map((t) => [t]), state.rules.aka)) combos.push([x[0], y[0]]);
        for (const v of combos) {
          const rest = removeTiles(hand, v);
          if (hasLegalDiscardAfter(rest, kuikaeKinds("chi", c.tile, v))) {
            out.push({ type: "chi", from, index: c.index, tiles: v, target: c.tile });
          }
        }
      }
    }
  }
  return out;
}

function pairsOf(tiles: Tile[]): Tile[][] {
  const out: Tile[][] = [];
  for (let i = 0; i < tiles.length; i++) for (let j = i + 1; j < tiles.length; j++) out.push([tiles[i], tiles[j]]);
  return out;
}

/** 赤ドラの枚数が同じ組み合わせは1つにまとめる */
function uniqueByRed(options: Tile[][], aka: boolean): Tile[][] {
  const seen = new Set<string>();
  const out: Tile[][] = [];
  for (const o of options) {
    const key = o
      .map((t) => `${kindOf(t)}${aka && t % 4 === 0 && [4, 13, 22].includes(kindOf(t)) ? "r" : ""}`)
      .sort()
      .join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(o);
  }
  return out;
}

function canSelfKan(state: GameState, seat: number): boolean {
  const k = state.kyoku;
  if (!k || state.phase !== "playing") return false;
  const p = k.players[seat];
  return p.mustDiscard && p.drawn !== null && !p.afterCall && k.wall.length > 0 && k.kanCount < 4;
}

export function ankanOptions(state: GameState, seat: number): Kind[] {
  if (!canSelfKan(state, seat)) return [];
  const p = state.kyoku!.players[seat];
  const counts = toCounts(p.hand);
  const out: Kind[] = [];
  for (let kd = 0; kd < 34; kd++) {
    if (counts[kd] < 4) continue;
    if (p.riichi > 0) {
      // 送り槓は不可。待ちが変わらない場合のみ
      if (kindOf(p.drawn!) !== kd) continue;
      const before = waitKinds(p, removeTiles(p.hand, [p.drawn!]));
      const kanTiles = p.hand.filter((t) => kindOf(t) === kd);
      const afterHand = p.hand.filter((t) => kindOf(t) !== kd);
      const after = waitKinds(p, afterHand, p.melds.length + 1, kanTiles);
      if (before.length === 0 || before.join(",") !== after.join(",")) continue;
    }
    out.push(kd);
  }
  return out;
}

/** 三人麻雀の北抜きができるか（ポンの直後は不可。立直中はツモった北のみ） */
export function canNuki(state: GameState, seat: number): boolean {
  const k = state.kyoku;
  if (!k || state.phase !== "playing" || !isSanma(state)) return false;
  const p = k.players[seat];
  if (!p.mustDiscard || p.drawn === null || p.afterCall || k.wall.length === 0) return false;
  if (p.riichi > 0) return kindOf(p.drawn!) === NORTH;
  return p.hand.some((t) => kindOf(t) === NORTH);
}

export function kakanOptions(state: GameState, seat: number): Kind[] {
  if (!canSelfKan(state, seat)) return [];
  const p = state.kyoku!.players[seat];
  if (p.riichi > 0) return [];
  const out: Kind[] = [];
  for (const m of p.melds) {
    if (m.type !== "pon") continue;
    const kd = kindOf(m.tiles[0]);
    if (p.hand.some((t) => kindOf(t) === kd)) out.push(kd);
  }
  return out;
}

export function legalDiscards(state: GameState, seat: number): Tile[] {
  const k = state.kyoku;
  if (!k || state.phase !== "playing") return [];
  const p = k.players[seat];
  if (!p.mustDiscard) return [];
  if (p.riichi > 0) return p.drawn !== null ? [p.drawn] : [];
  const ok = p.hand.filter((t) => !p.kuikae.includes(kindOf(t)));
  return ok.length > 0 ? ok : p.hand.slice();
}

/** 立直を宣言して打牌できる牌 */
export function riichiDiscards(state: GameState, seat: number): Tile[] {
  const k = state.kyoku;
  if (!k || state.phase !== "playing") return [];
  const p = k.players[seat];
  if (!p.mustDiscard || p.drawn === null || p.afterCall || p.riichi > 0) return [];
  if (!isMenzen(p)) return [];
  if (state.scores[seat] < 1000) return [];
  if (k.wall.length < 1) return [];
  const okByKind = new Map<Kind, boolean>();
  const out: Tile[] = [];
  for (const t of p.hand) {
    const kd = kindOf(t);
    if (!okByKind.has(kd)) {
      const rest = removeTiles(p.hand, [t]);
      okByKind.set(kd, waitKinds(p, rest).length > 0);
    }
    if (okByKind.get(kd)) out.push(t);
  }
  return out;
}

export function canKyuushu(state: GameState, seat: number): boolean {
  const k = state.kyoku;
  if (!k || state.phase !== "playing") return false;
  const p = k.players[seat];
  if (!p.firstTurn || !p.mustDiscard || p.drawn === null || p.melds.length > 0) return false;
  const counts = toCounts(p.hand);
  return YAOCHU_KINDS.filter((kd) => counts[kd] > 0).length >= 9;
}

export function handShanten(p: PlayerState): number {
  const c = toCounts(p.hand);
  return p.mighty ? mightyShanten(c, p.melds.length, ownCounts(p, p.hand)) : shanten(c, p.melds.length);
}

/** ドパなし：スキップボタンを出すか（確認中の牌に、ロンまたはポン・カンできる） */
export function canPass(state: GameState, seat: number): boolean {
  const w = callWindowOf(state);
  if (!w || !windowOpenFor(state, seat, w.type, w.from)) return false;
  return ronOptions(state, seat).length > 0 || callOptions(state, seat).length > 0;
}

/** 打牌の自動実行時刻（人間のみ）。CPUは反応時間で動く */
export function discardDeadline(state: GameState, seat: number, timeoutMs: number, autoMs: number): number | null {
  const k = state.kyoku;
  if (!k || state.phase !== "playing") return null;
  const p = k.players[seat];
  if (!p.mustDiscard) return null;
  // 「ツモ切り」ボタンは廃止したので、古い対局データでONになっていても立直中だけが1秒
  const quick = p.riichi > 0 && p.drawn !== null;
  return p.phaseSince + (quick ? autoMs : timeoutMs);
}

/** 順位（同点は起家に近い方＝席番号が小さい方を上位） */
export function ranking(scores: number[]): number[] {
  const order = scores.map((_, i) => i).sort((a, b) => scores[b] - scores[a] || a - b);
  const ranks = new Array<number>(scores.length);
  order.forEach((seat, i) => (ranks[seat] = i + 1));
  return ranks;
}
