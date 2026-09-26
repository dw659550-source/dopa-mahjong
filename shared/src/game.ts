// ドパ麻雀の対局進行（純粋なロジック。状態を受け取り、新しい状態を返す）
import { cpuChooseCall, cpuChooseSelfAction, cpuDelayMs } from "./cpu.ts";
import {
  ankanOptions,
  baseHand,
  callableDiscard,
  callOptions,
  canKyuushu,
  dealerSeat,
  discardDeadline,
  evalRon,
  evalTsumo,
  kakanOptions,
  kuikaeKinds,
  legalDiscards,
  ranking,
  removeTiles,
  riichiDiscards,
  ronTargetTile,
  roundLabel,
  waitsOf,
} from "./query.ts";
import { mulberry32, shuffle } from "./rng.ts";
import { isWind, isYaochu, kindOf, isDragon, type Kind, type Tile } from "./tiles.ts";
import {
  AUTO_TSUMOGIRI_MS,
  DISCARD_TIMEOUT_MS,
  EXHAUST_GRACE_MS,
  RESULT_DISPLAY_MS,
  RETURN_SCORE,
  START_SCORE,
  UMA,
  type Action,
  type FinalResult,
  type GameEventType,
  type GameState,
  type KyokuResult,
  type PlayerState,
  type RonTarget,
  type Rules,
  type SeatInfo,
  type WinDetail,
} from "./types.ts";
import { ronPoints, tsumoPoints, type Meld, type WinResult } from "./yaku.ts";

export class GameError extends Error {}

function fail(msg: string): never {
  throw new GameError(msg);
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export function createGame(seats: SeatInfo[], rules: Rules, seed: number, now: number): GameState {
  if (seats.length !== 4) fail("4人必要です");
  const s: GameState = {
    version: 1,
    rules,
    seats,
    connected: seats.map(() => true),
    opts: seats.map(() => ({ autoHora: true, noCall: false, tsumogiri: false })),
    scores: [START_SCORE, START_SCORE, START_SCORE, START_SCORE],
    roundWind: 0,
    kyokuNum: 0,
    honba: 0,
    kyotaku: 0,
    phase: "playing",
    kyoku: null,
    result: null,
    resultUntil: 0,
    resultAck: [false, false, false, false],
    next: null,
    final: null,
    stats: seats.map(() => ({ kyokus: 0, wins: 0, dealins: 0, calls: 0, riichis: 0, yakuman: [] })),
    seed: seed >>> 0,
    kyokuSerial: 0,
    lastKifu: null,
    events: [],
    eventSeq: 0,
    startedAt: now,
  };
  startKyoku(s, now);
  return s;
}

function pushEvent(s: GameState, type: GameEventType, seat: number | null, now: number) {
  s.eventSeq++;
  s.events.push({ id: s.eventSeq, type, seat, at: now });
  if (s.events.length > 30) s.events.splice(0, s.events.length - 30);
}

function newPlayer(now: number): PlayerState {
  return {
    hand: [],
    drawn: null,
    melds: [],
    river: [],
    mustDiscard: false,
    afterCall: false,
    kuikae: [],
    phaseSince: now,
    riichi: 0,
    riichiRiverIndex: -1,
    ippatsu: false,
    firstTurn: true,
    tempFuriten: false,
    riichiFuriten: false,
    rinshan: false,
    haitei: false,
    pendingKanDora: 0,
    kakanTile: null,
    kakanPendingMiss: [],
    pao: null,
    calledThisKyoku: false,
    riichiThisKyoku: false,
  };
}

function startKyoku(s: GameState, now: number) {
  s.kyokuSerial++;
  const rng = mulberry32((s.seed ^ Math.imul(s.kyokuSerial, 0x9e3779b1)) >>> 0);
  const all = shuffle(
    Array.from({ length: 136 }, (_, i) => i),
    rng,
  );
  const dead = all.slice(136 - 14);
  const wall = all.slice(0, 136 - 14);
  const players = [0, 1, 2, 3].map(() => newPlayer(now));
  const dealer = dealerSeat(s);
  for (let r = 0; r < 13; r++) {
    for (let i = 0; i < 4; i++) players[(dealer + i) % 4].hand.push(wall.shift()!);
  }
  s.kyoku = {
    wall,
    rinshan: dead.slice(0, 4),
    doraIndicators: dead.slice(4, 9),
    uraIndicators: dead.slice(9, 14),
    doraRevealed: 1,
    players,
    kanCount: 0,
    kanSeats: [],
    firstDiscardKinds: [null, null, null, null],
    riichiCount: 0,
    pendingAbort: null,
    allDoneAt: null,
    cpuSeen: {},
    startedAt: now,
  };
  s.phase = "playing";
  s.result = null;
  s.next = null;
  s.resultAck = [false, false, false, false];
  for (const o of s.opts) o.noCall = false;
  pushEvent(s, "kyokuStart", null, now);
  // 全員に第1ツモ（親から順）
  for (let i = 0; i < 4; i++) {
    const seat = (dealer + i) % 4;
    const p = players[seat];
    const t = s.kyoku.wall.shift()!;
    p.hand.push(t);
    p.drawn = t;
    p.mustDiscard = true;
    p.phaseSince = now;
  }
  for (let i = 0; i < 4; i++) {
    if (s.phase !== "playing") break;
    autoTsumoCheck(s, (dealer + i) % 4, now);
  }
}

/**
 * 自動和了するか。自動和了は最優先とし、接続状態に関係なく働く
 * （接続の判定が一時的に外れた間に和了を見逃さないようにするため。仕様書6-1からの変更）。
 */
function isAuto(s: GameState, seat: number): boolean {
  return s.seats[seat].isCpu || s.opts[seat].autoHora;
}

function autoTsumoCheck(s: GameState, seat: number, now: number): boolean {
  if (!isAuto(s, seat)) return false;
  const r = evalTsumo(s, seat);
  if (!r) return false;
  endWithWins(s, [{ seat, result: r }], null, null, now);
  return true;
}

function autoRonCheck(s: GameState, target: RonTarget, now: number): boolean {
  const winners: { seat: number; result: WinResult }[] = [];
  for (let seat = 0; seat < 4; seat++) {
    if (seat === target.from || !isAuto(s, seat)) continue;
    const r = evalRon(s, seat, target);
    if (r) winners.push({ seat, result: r });
  }
  if (winners.length === 0) return false;
  if (winners.length >= 3) {
    endAbort(s, "三家和", null, now);
    return true;
  }
  endWithWins(s, winners, target.from, target, now);
  return true;
}

function drawFor(s: GameState, seat: number, now: number) {
  const k = s.kyoku!;
  const p = k.players[seat];
  if (k.wall.length === 0) return;
  const t = k.wall.shift()!;
  p.hand.push(t);
  p.drawn = t;
  p.mustDiscard = true;
  p.afterCall = false;
  p.kuikae = [];
  p.rinshan = false;
  p.haitei = k.wall.length === 0;
  p.phaseSince = now;
  autoTsumoCheck(s, seat, now);
}

function flipPendingDora(s: GameState, p: PlayerState) {
  const k = s.kyoku!;
  if (p.pendingKanDora > 0) {
    k.doraRevealed = Math.min(5, k.doraRevealed + p.pendingKanDora);
    p.pendingKanDora = 0;
  }
}

function rinshanDraw(s: GameState, seat: number, immediateFlip: boolean, now: number) {
  const k = s.kyoku!;
  const p = k.players[seat];
  flipPendingDora(s, p);
  if (immediateFlip) k.doraRevealed = Math.min(5, k.doraRevealed + 1);
  else p.pendingKanDora += 1;
  const t = k.rinshan.shift()!;
  // 王牌を14枚に保つため、山の最後尾を王牌へ移す（海底がずれる）
  k.rinshan.push(k.wall.pop()!);
  p.hand.push(t);
  p.drawn = t;
  p.mustDiscard = true;
  p.afterCall = false;
  p.kuikae = [];
  p.rinshan = true;
  p.haitei = false;
  p.phaseSince = now;
  autoTsumoCheck(s, seat, now);
}

function afterKan(s: GameState, seat: number) {
  const k = s.kyoku!;
  k.kanCount++;
  k.kanSeats.push(seat);
  if (k.kanCount === 4 && new Set(k.kanSeats).size >= 2 && !k.pendingAbort) {
    k.pendingAbort = { type: "suukaikan", seat, armed: false };
  }
  for (const p of k.players) p.ippatsu = false;
}

/** 捨て牌の鳴き・ロンの権利が消えるとき、見逃した人をフリテンにする */
function markMisses(s: GameState, seats: number[]) {
  const k = s.kyoku!;
  for (const m of seats) {
    const p = k.players[m];
    p.tempFuriten = true;
    if (p.riichi > 0) p.riichiFuriten = true;
  }
}

function closeOwnWindow(s: GameState, seat: number) {
  const p = s.kyoku!.players[seat];
  const last = p.river[p.river.length - 1];
  if (last && last.pendingMiss.length > 0) {
    markMisses(s, last.pendingMiss);
    last.pendingMiss = [];
  }
  if (p.kakanTile !== null) {
    markMisses(s, p.kakanPendingMiss);
    p.kakanTile = null;
    p.kakanPendingMiss = [];
  }
}

function missCandidates(s: GameState, from: number, kind: Kind): number[] {
  const out: number[] = [];
  for (let i = 0; i < 4; i++) {
    if (i === from) continue;
    if (waitsOf(s.kyoku!.players[i]).includes(kind)) out.push(i);
  }
  return out;
}

function doDiscard(s: GameState, seat: number, tile: Tile, riichi: boolean, now: number) {
  const k = s.kyoku!;
  const p = k.players[seat];
  if (!p.mustDiscard) fail("打牌できる状態ではありません");
  if (riichi) {
    if (!riichiDiscards(s, seat).includes(tile)) fail("その牌では立直できません");
  } else if (!legalDiscards(s, seat).includes(tile)) {
    fail(p.riichi > 0 ? "立直後はツモ切りのみです" : "その牌は捨てられません");
  }

  // 四家立直・四槓散了: 対象者が次に打牌した時点で流局
  if (k.pendingAbort && k.pendingAbort.seat === seat && k.pendingAbort.armed) {
    endAbort(s, k.pendingAbort.type === "suucha" ? "四家立直" : "四槓散了", null, now);
    return;
  }

  const hadDrawn = p.drawn !== null;
  if (p.riichi > 0 && hadDrawn && evalTsumo(s, seat)) p.riichiFuriten = true; // ツモ見逃し
  closeOwnWindow(s, seat);
  if (hadDrawn) p.tempFuriten = false;
  flipPendingDora(s, p);

  const wasFirst = p.firstTurn;
  p.hand = removeTiles(p.hand, [tile]);
  const entry = {
    tile,
    tsumogiri: tile === p.drawn,
    riichi,
    calledBy: null,
    at: now,
    houtei: false,
    pendingMiss: [] as number[],
  };
  p.river.push(entry);
  p.drawn = null;
  p.mustDiscard = false;
  p.afterCall = false;
  p.kuikae = [];
  p.rinshan = false;
  p.haitei = false;
  if (p.riichi > 0) p.ippatsu = false;
  if (riichi) {
    p.riichi = wasFirst ? 2 : 1;
    p.ippatsu = true;
    p.riichiRiverIndex = p.river.length - 1;
    p.riichiThisKyoku = true;
    s.scores[seat] -= 1000;
    s.kyotaku += 1;
    k.riichiCount++;
    if (k.riichiCount === 4 && !k.pendingAbort) k.pendingAbort = { type: "suucha", seat, armed: true };
    pushEvent(s, "riichi", seat, now);
  }
  p.firstTurn = false;
  if (wasFirst) k.firstDiscardKinds[seat] = kindOf(tile);
  if (k.pendingAbort && k.pendingAbort.seat === seat && !k.pendingAbort.armed) k.pendingAbort.armed = true;

  if (k.wall.length === 0 && k.players.every((x) => !x.mustDiscard)) {
    entry.houtei = true;
    k.allDoneAt = now;
  }
  entry.pendingMiss = missCandidates(s, seat, kindOf(tile));
  pushEvent(s, "discard", seat, now);

  if (autoRonCheck(s, { type: "discard", from: seat, index: p.river.length - 1 }, now)) return;

  if (wasFirst) {
    const f = k.firstDiscardKinds;
    if (f.every((x) => x !== null && x === f[0]) && isWind(f[0]!)) {
      endAbort(s, "四風連打", null, now);
      return;
    }
  }
  drawFor(s, seat, now);
}

function doCall(s: GameState, a: Extract<Action, { type: "chi" | "pon" | "minkan" }>, now: number) {
  const k = s.kyoku!;
  const opts = callOptions(s, a.seat);
  const want = a.tiles.slice().sort((x, y) => x - y).join(",");
  const opt = opts.find(
    (o) => o.type === a.type && o.from === a.from && o.index === a.index && o.tiles.slice().sort((x, y) => x - y).join(",") === want,
  );
  if (!opt) {
    const f = k.players[a.from].river;
    const stillThere = a.index === f.length - 1 && f[a.index]?.calledBy === null;
    fail(stillThere ? "鳴けません" : "間に合いませんでした（相手が次の牌を捨てたか、他の人が先に鳴きました）");
  }
  const p = k.players[a.seat];
  const f = k.players[a.from];
  // 手元のツモ牌は山の先頭に戻す
  const drawn = p.drawn!;
  p.hand = removeTiles(p.hand, [drawn]);
  k.wall.unshift(drawn);
  p.drawn = null;
  p.hand = removeTiles(p.hand, opt.tiles);
  const entry = f.river[opt.index];
  entry.calledBy = a.seat;
  entry.pendingMiss = [];
  const meld: Meld = {
    type: a.type,
    tiles: [...opt.tiles, opt.target],
    from: a.from,
    calledTile: opt.target,
  };
  p.melds.push(meld);
  p.firstTurn = false;
  p.calledThisKyoku = true;
  p.rinshan = false;
  p.haitei = false;
  for (const x of k.players) x.ippatsu = false;
  checkPao(p, kindOf(opt.target), a.from);

  if (a.type === "minkan") {
    pushEvent(s, "kan", a.seat, now);
    afterKan(s, a.seat);
    rinshanDraw(s, a.seat, false, now);
    return;
  }
  pushEvent(s, a.type, a.seat, now);
  p.mustDiscard = true;
  p.afterCall = true;
  p.kuikae = kuikaeKinds(a.type, opt.target, opt.tiles);
  p.phaseSince = now;
}

function checkPao(p: PlayerState, kind: Kind, from: number) {
  const tripKinds = p.melds.filter((m) => m.type !== "chi").map((m) => kindOf(m.tiles[0]));
  if (isDragon(kind) && tripKinds.filter(isDragon).length === 3) p.pao = { seat: from, yaku: "大三元" };
  if (isWind(kind) && tripKinds.filter(isWind).length === 4) p.pao = { seat: from, yaku: "大四喜" };
}

function doAnkan(s: GameState, seat: number, kind: Kind, now: number) {
  if (!ankanOptions(s, seat).includes(kind)) fail("暗槓できません");
  const k = s.kyoku!;
  const p = k.players[seat];
  const tiles = p.hand.filter((t) => kindOf(t) === kind);
  p.hand = removeTiles(p.hand, tiles);
  p.melds.push({ type: "ankan", tiles, from: null, calledTile: null });
  p.drawn = null;
  p.firstTurn = false;
  pushEvent(s, "kan", seat, now);
  afterKan(s, seat);
  rinshanDraw(s, seat, true, now);
}

function doKakan(s: GameState, seat: number, kind: Kind, now: number) {
  if (!kakanOptions(s, seat).includes(kind)) fail("加槓できません");
  const k = s.kyoku!;
  const p = k.players[seat];
  const tile = p.drawn !== null && kindOf(p.drawn) === kind ? p.drawn : p.hand.find((t) => kindOf(t) === kind)!;
  p.hand = removeTiles(p.hand, [tile]);
  const meld = p.melds.find((m) => m.type === "pon" && kindOf(m.tiles[0]) === kind)!;
  meld.type = "kakan";
  meld.tiles.push(tile);
  p.drawn = null;
  p.firstTurn = false;
  // 前の加槓の槍槓権は、ここで消える
  if (p.kakanTile !== null) markMisses(s, p.kakanPendingMiss);
  p.kakanTile = tile;
  p.kakanPendingMiss = missCandidates(s, seat, kind);
  pushEvent(s, "kan", seat, now);
  // 発声と和了打診（槍槓）→ 一発消滅 → 嶺上ツモ
  if (autoRonCheck(s, { type: "kakan", from: seat }, now)) return;
  afterKan(s, seat);
  rinshanDraw(s, seat, false, now);
}

function doTsumo(s: GameState, seat: number, now: number) {
  const r = evalTsumo(s, seat);
  if (!r) fail("ツモ和了できません");
  endWithWins(s, [{ seat, result: r }], null, null, now);
}

function doRon(s: GameState, seat: number, target: RonTarget, now: number) {
  const r = evalRon(s, seat, target);
  if (!r) {
    fail(ronTargetTile(s, target) ? "ロンできません" : "間に合いませんでした（相手が次の牌を捨てました）");
  }
  endWithWins(s, [{ seat, result: r }], target.from, target, now);
}

function kyokuStats(s: GameState) {
  const k = s.kyoku!;
  for (let i = 0; i < 4; i++) {
    s.stats[i].kyokus++;
    if (k.players[i].calledThisKyoku) s.stats[i].calls++;
    if (k.players[i].riichiThisKyoku) s.stats[i].riichis++;
  }
}

function paoApplies(p: PlayerState, r: WinResult): number | null {
  if (!p.pao || r.yakumanMult === 0) return null;
  return r.yaku.some((y) => y.name === p.pao!.yaku) ? p.pao.seat : null;
}

function endWithWins(
  s: GameState,
  winners: { seat: number; result: WinResult }[],
  fromSeat: number | null,
  target: RonTarget | null,
  now: number,
) {
  const k = s.kyoku!;
  const dealer = dealerSeat(s);
  const deltas = [0, 0, 0, 0];
  const wins: WinDetail[] = [];

  // 立直宣言牌での放銃は供託が発生しない
  if (target && target.type === "discard") {
    const entry = k.players[target.from].river[target.index];
    if (entry.riichi) {
      s.scores[target.from] += 1000;
      s.kyotaku -= 1;
    }
  }

  if (fromSeat === null) {
    const { seat: w, result: r } = winners[0];
    const p = k.players[w];
    const isDealer = w === dealer;
    const pao = paoApplies(p, r);
    let total = 0;
    if (pao !== null) {
      total = ronPoints(r.basePoints, isDealer);
      deltas[pao] -= total + 300 * s.honba;
      deltas[w] += total + 300 * s.honba;
    } else {
      const pay = tsumoPoints(r.basePoints, isDealer);
      for (let o = 0; o < 4; o++) {
        if (o === w) continue;
        const amount = (o === dealer ? pay.fromDealer : pay.fromChild) + 100 * s.honba;
        deltas[o] -= amount;
        deltas[w] += amount;
        total += o === dealer ? pay.fromDealer : pay.fromChild;
      }
    }
    deltas[w] += s.kyotaku * 1000;
    s.kyotaku = 0;
    wins.push(winDetail(w, null, r, p, p.drawn!, total, pao));
  } else {
    const sorted = winners.slice().sort((a, b) => ((a.seat - fromSeat + 4) % 4) - ((b.seat - fromSeat + 4) % 4));
    const tile = target!.type === "kakan" ? k.players[fromSeat].kakanTile! : k.players[fromSeat].river[(target as { index: number }).index].tile;
    sorted.forEach(({ seat: w, result: r }, i) => {
      const p = k.players[w];
      const pts = ronPoints(r.basePoints, w === dealer);
      const pao = paoApplies(p, r);
      const honbaPts = i === 0 ? 300 * s.honba : 0;
      if (pao !== null && pao !== fromSeat) {
        deltas[fromSeat] -= pts / 2;
        deltas[pao] -= pts / 2 + honbaPts;
      } else {
        deltas[fromSeat] -= pts + honbaPts;
      }
      deltas[w] += pts + honbaPts;
      if (i === 0) {
        deltas[w] += s.kyotaku * 1000;
        s.kyotaku = 0;
      }
      wins.push(winDetail(w, fromSeat, r, p, tile, pts, pao, baseHand(p)!));
    });
    s.stats[fromSeat].dealins++;
  }

  kyokuStats(s);
  for (const w of wins) {
    s.stats[w.seat].wins++;
    if (w.yakumanMult > 0) s.stats[w.seat].yakuman.push(w.yaku.map((y) => y.name).join("・"));
  }
  const revealed: (Tile[] | null)[] = [null, null, null, null];
  for (const w of wins) revealed[w.seat] = w.hand;
  const renchan = wins.some((w) => w.seat === dealer);
  pushEvent(s, fromSeat === null ? "tsumo" : "ron", wins[0].seat, now);
  finishKyoku(
    s,
    {
      kind: "win",
      title: fromSeat === null ? "ツモ" : wins.length === 2 ? "ダブロン" : "ロン",
      roundLabel: roundLabel(s),
      wins,
      deltas,
      tenpai: [false, false, false, false],
      revealed,
      doraIndicators: k.doraIndicators.slice(0, k.doraRevealed),
      uraIndicators: wins.some((w) => k.players[w.seat].riichi > 0) ? k.uraIndicators.slice(0, k.doraRevealed) : [],
      nagashi: [],
      scoresAfter: [],
    },
    renchan,
    false,
    false,
    now,
  );
}

function winDetail(
  seat: number,
  fromSeat: number | null,
  r: WinResult,
  p: PlayerState,
  winTile: Tile,
  points: number,
  pao: number | null,
  hand13?: Tile[],
): WinDetail {
  return {
    seat,
    fromSeat,
    yaku: r.yaku,
    han: r.han,
    fu: r.fu,
    yakumanMult: r.yakumanMult,
    label: r.label,
    points,
    hand: hand13 ? [...hand13, winTile] : p.hand.slice(),
    melds: clone(p.melds),
    winTile,
    pao,
  };
}

function endAbort(s: GameState, title: string, revealSeat: number | null, now: number) {
  const k = s.kyoku!;
  kyokuStats(s);
  const revealed: (Tile[] | null)[] = [null, null, null, null];
  if (revealSeat !== null) revealed[revealSeat] = k.players[revealSeat].hand.slice();
  pushEvent(s, "abort", revealSeat, now);
  finishKyoku(
    s,
    {
      kind: "abort",
      title,
      roundLabel: roundLabel(s),
      wins: [],
      deltas: [0, 0, 0, 0],
      tenpai: [false, false, false, false],
      revealed,
      doraIndicators: k.doraIndicators.slice(0, k.doraRevealed),
      uraIndicators: [],
      nagashi: [],
      scoresAfter: [],
    },
    true,
    true,
    true,
    now,
  );
}

function endExhaustive(s: GameState, now: number) {
  const k = s.kyoku!;
  const dealer = dealerSeat(s);
  const deltas = [0, 0, 0, 0];
  const tenpai = k.players.map((p) => waitsOf(p).length > 0);
  const nagashi: number[] = [];
  k.players.forEach((p, i) => {
    if (p.river.length > 0 && p.river.every((r) => isYaochu(kindOf(r.tile)) && r.calledBy === null)) nagashi.push(i);
  });
  if (nagashi.length > 0) {
    for (const w of nagashi) {
      const pay = tsumoPoints(2000, w === dealer);
      for (let o = 0; o < 4; o++) {
        if (o === w) continue;
        const amount = o === dealer ? pay.fromDealer : pay.fromChild;
        deltas[o] -= amount;
        deltas[w] += amount;
      }
    }
  } else {
    const n = tenpai.filter(Boolean).length;
    if (n > 0 && n < 4) {
      for (let i = 0; i < 4; i++) deltas[i] += tenpai[i] ? 3000 / n : -3000 / (4 - n);
    }
  }
  kyokuStats(s);
  const revealed = k.players.map((p, i) => (tenpai[i] ? baseHand(p) : null));
  pushEvent(s, "ryukyoku", null, now);
  finishKyoku(
    s,
    {
      kind: "ryukyoku",
      title: nagashi.length > 0 ? "流し満貫" : "流局",
      roundLabel: roundLabel(s),
      wins: [],
      deltas,
      tenpai,
      revealed,
      doraIndicators: k.doraIndicators.slice(0, k.doraRevealed),
      uraIndicators: [],
      nagashi,
      scoresAfter: [],
    },
    tenpai[dealer],
    true,
    false,
    now,
  );
}

function finishKyoku(
  s: GameState,
  result: KyokuResult,
  renchan: boolean,
  isRyukyoku: boolean,
  isAbort: boolean,
  now: number,
) {
  const scoresBefore = s.scores.slice();
  for (let i = 0; i < 4; i++) s.scores[i] += result.deltas[i];
  result.scoresAfter = s.scores.slice();
  const k = s.kyoku;
  s.lastKifu = k
    ? {
        serial: s.kyokuSerial,
        roundLabel: result.roundLabel,
        dealer: dealerSeat(s),
        names: s.seats.map((x) => x.name),
        scoresBefore,
        players: k.players.map((p) => ({
          hand: p.hand.slice(),
          drawn: p.drawn,
          melds: p.melds.map((m) => ({ ...m, tiles: m.tiles.slice() })),
          river: p.river.map((r) => ({ tile: r.tile, tsumogiri: r.tsumogiri, riichi: r.riichi, calledBy: r.calledBy })),
          riichi: p.riichi > 0,
        })),
        result: JSON.parse(JSON.stringify(result)),
      }
    : null;
  s.result = result;
  s.phase = "result";
  s.resultUntil = now + RESULT_DISPLAY_MS;
  s.resultAck = [false, false, false, false];
  s.next = decideNext(s, renchan, isRyukyoku, isAbort);
}

function decideNext(s: GameState, renchan: boolean, isRyukyoku: boolean, isAbort: boolean) {
  const tonpu = s.rules.length === "tonpu";
  const lastIdx = tonpu ? 3 : 7;
  const limitIdx = tonpu ? 7 : 11;
  const cur = s.roundWind * 4 + s.kyokuNum;
  const dealer = dealerSeat(s);
  let nextIdx = cur;
  let honba = s.honba;
  if (renchan) honba++;
  else {
    nextIdx = cur + 1;
    honba = isRyukyoku ? honba + 1 : 0;
  }
  const plan = { end: false, roundWind: Math.floor(nextIdx / 4), kyokuNum: nextIdx % 4, honba };
  if (s.scores.some((x) => x < 0)) return { ...plan, end: true };
  if (cur >= lastIdx) {
    if (renchan) {
      if (!isAbort && ranking(s.scores)[dealer] === 1 && s.scores[dealer] >= RETURN_SCORE) return { ...plan, end: true };
    } else {
      if (s.scores.some((x) => x >= RETURN_SCORE)) return { ...plan, end: true };
      if (cur >= limitIdx) return { ...plan, end: true };
    }
  }
  return plan;
}

function proceedAfterResult(s: GameState, now: number) {
  const next = s.next!;
  if (next.end) {
    finishGame(s, now);
    return;
  }
  s.roundWind = next.roundWind;
  s.kyokuNum = next.kyokuNum;
  s.honba = next.honba;
  startKyoku(s, now);
}

function finishGame(s: GameState, now: number) {
  const ranks0 = ranking(s.scores);
  const top = ranks0.indexOf(1);
  s.scores[top] += s.kyotaku * 1000;
  s.kyotaku = 0;
  const ranks = ranking(s.scores);
  const players = [0, 1, 2, 3].map((seat) => {
    const rank = ranks[seat];
    const raw = (s.scores[seat] - RETURN_SCORE) / 1000 + UMA[rank - 1] + (rank === 1 ? ((RETURN_SCORE - START_SCORE) * 4) / 1000 : 0);
    return {
      seat,
      name: s.seats[seat].name,
      isCpu: s.seats[seat].isCpu,
      rank,
      score: s.scores[seat],
      points: Math.round(raw * 10) / 10,
    };
  });
  players.sort((a, b) => a.rank - b.rank);
  const final: FinalResult = { players, endedAt: now };
  s.final = final;
  s.phase = "ended";
  s.next = null;
  pushEvent(s, "gameEnd", null, now);
}

// ---------------------------------------------------------------- 時間経過の処理

interface DueEvent {
  at: number;
  run: () => void;
}

function collectDue(s: GameState, now: number): DueEvent[] {
  const k = s.kyoku!;
  const out: DueEvent[] = [];
  if (k.allDoneAt !== null) {
    out.push({ at: k.allDoneAt + EXHAUST_GRACE_MS, run: () => endExhaustive(s, now) });
  }
  for (let seat = 0; seat < 4; seat++) {
    const p = k.players[seat];
    if (s.seats[seat].isCpu) {
      if (p.mustDiscard) {
        out.push({
          at: p.phaseSince + cpuDelayMs(s, seat, p.phaseSince),
          run: () => {
            try {
              applyInternal(s, cpuChooseSelfAction(s, seat), now);
            } catch (e) {
              if (!(e instanceof GameError)) throw e;
              // 想定外の判断ミスはツモ切り（またはいずれかの合法打牌）で続行
              const legal = legalDiscards(s, seat);
              doDiscard(s, seat, p.drawn !== null && legal.includes(p.drawn) ? p.drawn : legal[0], false, now);
            }
          },
        });
      }
      for (let from = 0; from < 4; from++) {
        if (from === seat) continue;
        const c = callableDiscard(s, from);
        if (!c) continue;
        const key = `${seat}:${from}:${c.index}`;
        if (k.cpuSeen[key]) continue;
        const at = k.players[from].river[c.index].at;
        out.push({
          at: at + cpuDelayMs(s, seat, at + from * 7 + c.index),
          run: () => {
            k.cpuSeen[key] = true;
            const a = cpuChooseCall(s, seat, from);
            if (!a) return;
            try {
              applyInternal(s, a, now);
            } catch (e) {
              if (!(e instanceof GameError)) throw e;
            }
          },
        });
      }
    } else {
      const dl = discardDeadline(s, seat, DISCARD_TIMEOUT_MS, AUTO_TSUMOGIRI_MS);
      if (dl !== null) {
        out.push({
          at: dl,
          run: () => {
            const legal = legalDiscards(s, seat);
            const tile = p.drawn !== null && legal.includes(p.drawn) ? p.drawn : legal[legal.length - 1];
            doDiscard(s, seat, tile, false, now);
          },
        });
      }
    }
  }
  return out.filter((e) => e.at <= now).sort((a, b) => a.at - b.at);
}

function tick(s: GameState, now: number) {
  for (let iter = 0; iter < 24; iter++) {
    if (s.phase === "result") {
      const humansConnected = s.seats.map((x, i) => !x.isCpu && s.connected[i]);
      const allAck = humansConnected.every((h, i) => !h || s.resultAck[i]);
      if (now >= s.resultUntil || allAck) {
        proceedAfterResult(s, now);
        continue;
      }
      return;
    }
    if (s.phase !== "playing") return;
    const due = collectDue(s, now);
    if (due.length === 0) return;
    due[0].run();
  }
}

/** 次に時間経過で何かが起きる時刻（クライアントのタイマー用） */
export function nextDueAt(s: GameState): number | null {
  if (s.phase === "result") return s.resultUntil;
  if (s.phase !== "playing" || !s.kyoku) return null;
  const all = collectDue(s, Number.MAX_SAFE_INTEGER);
  return all.length > 0 ? all[0].at : null;
}

function applyInternal(s: GameState, a: Action, now: number) {
  if (a.type === "tick") return tick(s, now);
  if (a.type === "opts") {
    s.opts[a.seat] = { ...s.opts[a.seat], ...a.opts };
    // 自動和了をONにした瞬間に和了できるならする
    if (a.opts.autoHora && s.phase === "playing") autoTsumoCheck(s, a.seat, now);
    return;
  }
  if (a.type === "connected") {
    s.connected[a.seat] = a.connected;
    return;
  }
  if (a.type === "ack") {
    if (s.phase === "result") s.resultAck[a.seat] = true;
    return;
  }
  if (s.phase !== "playing" || !s.kyoku) fail("対局中ではありません");
  switch (a.type) {
    case "discard":
      return doDiscard(s, a.seat, a.tile, !!a.riichi, now);
    case "tsumo":
      return doTsumo(s, a.seat, now);
    case "ron":
      return doRon(s, a.seat, a.target, now);
    case "chi":
    case "pon":
    case "minkan":
      return doCall(s, a, now);
    case "ankan":
      return doAnkan(s, a.seat, a.kind, now);
    case "kakan":
      return doKakan(s, a.seat, a.kind, now);
    case "kyuushu":
      if (!canKyuushu(s, a.seat)) fail("九種九牌ではありません");
      return endAbort(s, "九種九牌", a.seat, now);
  }
}

/**
 * 操作を適用する。先に時間経過の処理（タイムアウト・CPU）を済ませてから操作を適用する。
 * 失敗した場合は error を返し、状態は時間経過の処理のみ反映したものになる。
 */
export function applyAction(state: GameState, action: Action, now: number): { state: GameState; error?: string } {
  const s = clone(state);
  tick(s, now);
  if (action.type === "tick") return { state: s };
  const before = JSON.stringify(s);
  try {
    applyInternal(s, action, now);
    tick(s, now);
    return { state: s };
  } catch (e) {
    if (e instanceof GameError) return { state: JSON.parse(before) as GameState, error: e.message };
    throw e;
  }
}
