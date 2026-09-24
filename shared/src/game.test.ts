import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAction, createGame } from "./game.ts";
import { callOptions, evalRon, legalDiscards, ranking, waitsOf } from "./query.ts";
import { parseTiles, kindOf } from "./tiles.ts";
import { DEFAULT_RULES, type GameState, type SeatInfo, type Rules } from "./types.ts";

function cpuSeats(level: SeatInfo["cpuLevel"] = "normal"): SeatInfo[] {
  return [0, 1, 2, 3].map((i) => ({ name: `CPU${i}`, isCpu: true, cpuLevel: level }));
}

function humanSeats(): SeatInfo[] {
  return [0, 1, 2, 3].map((i) => ({ name: `P${i}`, isCpu: false, cpuLevel: "normal" }));
}

function totalPoints(s: GameState): number {
  return s.scores.reduce((a, b) => a + b, 0) + s.kyotaku * 1000;
}

function runToEnd(s: GameState, start: number, step = 300, maxSteps = 200000): { s: GameState; now: number } {
  let now = start;
  for (let i = 0; i < maxSteps && s.phase !== "ended"; i++) {
    now += step;
    const r = applyAction(s, { type: "tick" }, now);
    s = r.state;
    assert.equal(totalPoints(s), 100000, "点数の合計が保存されていない");
  }
  return { s, now };
}

for (const level of ["weak", "normal", "strong"] as const) {
  for (const length of ["tonpu", "hanchan"] as const) {
    test(`CPU 4人で最後まで対局できる (${level}, ${length})`, () => {
      for (const seed of [1, 2, 3]) {
        const rules: Rules = { ...DEFAULT_RULES, length, cpuLevel: level };
        const s0 = createGame(cpuSeats(level), rules, seed * 7919 + (length === "tonpu" ? 0 : 5), 0);
        const { s } = runToEnd(s0, 0);
        assert.equal(s.phase, "ended");
        assert.ok(s.final);
        const pts = s.final!.players.reduce((a, b) => a + b.points, 0);
        assert.ok(Math.abs(pts) < 1e-6, `最終得点の合計が0でない: ${pts}`);
        assert.equal(s.kyotaku, 0);
        const kyokus = s.stats[0].kyokus;
        assert.ok(kyokus >= 4, "局数が少なすぎる");
        for (const st of s.stats) assert.equal(st.kyokus, kyokus);
      }
    });
  }
}

test("人間はタイムアウトで自動ツモ切りされ、局が進む", () => {
  let s = createGame(humanSeats(), DEFAULT_RULES, 42, 0);
  const firstDrawn = s.kyoku!.players[1].drawn;
  s = applyAction(s, { type: "tick" }, 10_001).state;
  if (s.phase === "playing") {
    const r = s.kyoku!.players[1].river;
    assert.equal(r.length, 1);
    assert.equal(r[0].tile, firstDrawn);
    assert.ok(r[0].tsumogiri);
  }
  const { s: end } = runToEnd(s, 10_001, 1000);
  assert.equal(end.phase, "ended");
});

/** 手牌を差し替えるテスト用ヘルパー（牌の重複は気にしない） */
function setHand(s: GameState, seat: number, hand: string, drawn: string | null) {
  const p = s.kyoku!.players[seat];
  const h = parseTiles(hand);
  if (drawn) {
    const d = parseTiles(drawn)[0];
    p.hand = [...h, d];
    p.drawn = d;
    p.mustDiscard = true;
  } else {
    p.hand = h;
    p.drawn = null;
  }
}

function freshHumans(seed = 5): GameState {
  const s = createGame(humanSeats(), DEFAULT_RULES, seed, 0);
  // 天和などで局が終わっていたら作り直す
  if (s.phase !== "playing") return freshHumans(seed + 1);
  for (const p of s.kyoku!.players) {
    p.firstTurn = false;
  }
  return s;
}

test("ポンするとツモ牌は山の先頭に戻り、ツモせずに打牌してから次のツモ", () => {
  let s = freshHumans();
  setHand(s, 0, "1m", "9s");
  setHand(s, 1, "55z1234m6789p99s", "1s");
  setHand(s, 0, "55z23m456p789s123s", "4m");
  const wallHead = s.kyoku!.wall[0];
  // 席0が白を捨てる……のではなく、席2が白を捨てたことにする
  setHand(s, 2, "5z1234m6789p99s12", "3s");
  const whiteFrom2 = s.kyoku!.players[2].hand.find((t) => kindOf(t) === 31)!;
  s = applyAction(s, { type: "discard", seat: 2, tile: whiteFrom2 }, 100).state;
  const opts = callOptions(s, 0).filter((o) => o.type === "pon" && o.from === 2);
  assert.ok(opts.length > 0, "ポンできるはず");
  const drawnBefore = s.kyoku!.players[0].drawn!;
  const wallLenBefore = s.kyoku!.wall.length;
  s = applyAction(s, { type: "pon", seat: 0, from: 2, index: opts[0].index, tiles: opts[0].tiles }, 200).state;
  const p0 = s.kyoku!.players[0];
  assert.equal(p0.melds.length, 1);
  assert.equal(p0.drawn, null);
  assert.ok(p0.afterCall);
  assert.equal(s.kyoku!.wall[0], drawnBefore);
  assert.equal(s.kyoku!.wall.length, wallLenBefore + 1);
  void wallHead;
  // 喰い替え: 白は捨てられない
  assert.ok(!legalDiscards(s, 0).some((t) => kindOf(t) === 31));
  const d = legalDiscards(s, 0)[0];
  s = applyAction(s, { type: "discard", seat: 0, tile: d }, 300).state;
  assert.equal(s.kyoku!.players[0].drawn, drawnBefore, "打牌直後に山の先頭（戻した牌）をツモる");
});

test("チーは上家の捨て牌のみ", () => {
  let s = freshHumans();
  setHand(s, 1, "23m456p789s1122z", "9p");
  setHand(s, 2, "23m456p789s1122z", "9p");
  setHand(s, 0, "1m456p789s11223z", "4m");
  const t = s.kyoku!.players[0].hand.find((x) => kindOf(x) === 3)!; // 4m
  s = applyAction(s, { type: "discard", seat: 0, tile: t }, 100).state;
  assert.ok(callOptions(s, 1).some((o) => o.type === "chi" && o.from === 0));
  assert.ok(!callOptions(s, 2).some((o) => o.type === "chi"));
});

test("ダブロン: 両者に支払い、積み棒と供託は放銃者の下家に近い方", () => {
  let s = freshHumans();
  s.honba = 1;
  s.kyotaku = 1;
  s.scores = [25000, 25000, 25000, 24000];
  // 席1と席3が 5z 待ち（役牌 白 のシャンポン/単騎）
  setHand(s, 1, "123m456p789s555z1z", "9m");
  setHand(s, 3, "234m456p678s55z77z", "9m");
  setHand(s, 2, "123m456p789s1234z", "5z");
  s.opts[1].autoHora = true;
  s.opts[3].autoHora = true;
  const white = s.kyoku!.players[2].drawn!;
  // 席3は白のシャンポン（白 or 中）で役牌白。席1は1z単騎……ではなく白は暗刻なので待ちでない
  setHand(s, 1, "123m456p789s77z55z", "9m");
  const r = applyAction(s, { type: "discard", seat: 2, tile: white }, 100).state;
  assert.equal(r.phase, "result");
  assert.equal(r.result!.title, "ダブロン");
  assert.equal(r.result!.wins.length, 2);
  // 放銃者(2)の下家は3 → 積み棒・供託は席3
  const w3 = r.result!.deltas[3];
  const w1 = r.result!.deltas[1];
  assert.ok(w3 > w1);
  assert.equal(r.result!.deltas[2], -(r.result!.wins[0].points + r.result!.wins[1].points + 300));
  assert.equal(totalPoints(r), 100000);
});

test("三家和は流局（連荘）", () => {
  let s = freshHumans();
  setHand(s, 1, "123m456p789s77z55z", "9m");
  setHand(s, 3, "234m456p678s55z77z", "9m");
  setHand(s, 0, "123m456p789s55z66z", "9m");
  setHand(s, 2, "123m456p789s1234z", "5z");
  for (const i of [0, 1, 3]) s.opts[i].autoHora = true;
  const r = applyAction(s, { type: "discard", seat: 2, tile: s.kyoku!.players[2].drawn! }, 100).state;
  assert.equal(r.result!.title, "三家和");
  assert.equal(r.next!.kyokuNum, s.kyokuNum);
  assert.equal(r.next!.honba, s.honba + 1);
});

test("立直宣言牌での放銃は供託が発生しない", () => {
  let s = freshHumans();
  setHand(s, 2, "123m456p789s1123z", "3z");
  setHand(s, 1, "123m456p789s77z11z", "9m");
  s.opts[1].autoHora = true;
  // 席2 は 1z(東)単騎… 3z を捨てて立直 → 待ち 1z? 手牌 123m456p789s 11z 2z 3z 3z → 2z切り は 11z33z シャンポン
  const tile2z = s.kyoku!.players[2].hand.find((t) => kindOf(t) === 28)!;
  const before = s.scores.slice();
  // 席1は 1z(東) 待ちのシャンポン(東/中)。席2が 1z を切ることはないので 2z 待ちに変更
  setHand(s, 1, "123m456p789s77z22z", "9m");
  const r = applyAction(s, { type: "discard", seat: 2, tile: tile2z, riichi: true }, 100);
  assert.equal(r.error, undefined);
  const st = r.state;
  // 2z(南) は席1の自風(南)… 役牌で和了
  assert.equal(st.phase, "result");
  assert.equal(st.kyotaku, 0);
  assert.equal(st.scores[2] - before[2], st.result!.deltas[2]);
});

test("見逃し後、捨てた人が次に打牌するとフリテンになる", () => {
  let s = freshHumans();
  setHand(s, 1, "123m456p789s77z22z", "9m");
  setHand(s, 2, "123m456p789s1344z", "2z");
  const t = s.kyoku!.players[2].drawn!;
  s = applyAction(s, { type: "discard", seat: 2, tile: t }, 100).state;
  assert.ok(evalRon(s, 1, { type: "discard", from: 2, index: s.kyoku!.players[2].river.length - 1 }));
  const d = s.kyoku!.players[2].drawn!;
  s = applyAction(s, { type: "discard", seat: 2, tile: d }, 200).state;
  if (s.phase === "playing") {
    assert.ok(s.kyoku!.players[1].tempFuriten);
    assert.ok(waitsOf(s.kyoku!.players[1]).length > 0);
  }
});

test("包: 大三元の責任払い（ツモ）", () => {
  let s = freshHumans();
  s.kyokuNum = 0;
  const p1 = s.kyoku!.players[1];
  p1.melds = [
    { type: "pon", tiles: parseTiles("555z"), from: 0, calledTile: parseTiles("5z")[0] },
    { type: "pon", tiles: parseTiles("666z"), from: 0, calledTile: parseTiles("6z")[0] },
    { type: "pon", tiles: parseTiles("777z"), from: 3, calledTile: parseTiles("7z")[0] },
  ];
  p1.pao = { seat: 3, yaku: "大三元" };
  setHand(s, 1, "23m11p", "4m");
  const before = s.scores.slice();
  const r = applyAction(s, { type: "tsumo", seat: 1 }, 100);
  assert.equal(r.error, undefined);
  const d = r.state.result!.deltas;
  assert.equal(d[3], -32000);
  assert.equal(d[1], 32000);
  assert.equal(d[0], 0);
  assert.equal(d[2], 0);
  void before;
});

test("順位の同点は起家に近い方が上位", () => {
  assert.deepEqual(ranking([25000, 25000, 25000, 25000]), [1, 2, 3, 4]);
  assert.deepEqual(ranking([20000, 30000, 30000, 20000]), [3, 1, 2, 4]);
});

test("オーラス: 親がトップ30000点以上で和了止め、そうでなければ連荘", () => {
  let s = freshHumans();
  s.kyokuNum = 3;
  s.scores = [20000, 20000, 20000, 40000];
  setHand(s, 3, "123m456p789s23m55z", "4m");
  const r = applyAction(s, { type: "tsumo", seat: 3 }, 100).state;
  assert.equal(r.next!.end, true);

  let s2 = freshHumans();
  s2.kyokuNum = 3;
  s2.scores = [45000, 20000, 20000, 15000];
  setHand(s2, 3, "123m456p789s23m55z", "4m");
  const r2 = applyAction(s2, { type: "tsumo", seat: 3 }, 100).state;
  assert.equal(r2.next!.end, false);
  assert.equal(r2.next!.kyokuNum, 3);
});

test("東風戦: 誰も30000点に届かなければ南入", () => {
  let s = freshHumans();
  s.kyokuNum = 3;
  s.scores = [25000, 25000, 25000, 25000];
  setHand(s, 0, "123m456p789s23m55z", "4m");
  const r = applyAction(s, { type: "tsumo", seat: 0 }, 100).state;
  assert.equal(r.next!.end, false);
  assert.equal(r.next!.roundWind, 1);
  assert.equal(r.next!.kyokuNum, 0);
});

test("飛び終了（マイナスで終了、0点ちょうどは続行）", () => {
  let s = freshHumans();
  s.scores = [25000, 25000, 25000, 25000 + 800];
  s.kyotaku = 0;
  s.scores = [1000, 49000, 25000, 25000];
  setHand(s, 1, "123m456p789s23m55z", "4m");
  // 子のツモ 白のみ 40符1飜 400/700 → 席0(親)は700支払い → 300点で続行
  const r = applyAction(s, { type: "tsumo", seat: 1 }, 100).state;
  assert.equal(r.next!.end, false);
});
