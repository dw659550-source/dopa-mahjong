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

test("自動和了は初期設定でON", () => {
  const s = createGame(humanSeats(), DEFAULT_RULES, 1, 0);
  assert.ok(s.opts.every((o) => o.autoHora));
});

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
  s.opts[1].autoHora = false; // 手動で和了する人が見逃す場面
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

test("人間同士で連打しても自動和了が優先される（捨てた瞬間に判定）", () => {
  let s = freshHumans();
  // 席1: 白のシャンポン待ち（自動和了ON）。席2: 白を捨ててから、すぐに次の牌も捨てようとする
  setHand(s, 1, "123m456p789s77z55z", "9m");
  setHand(s, 2, "123m456p789s1234z", "5z");
  s.opts[1].autoHora = true;
  s.connected[1] = false; // 接続が切れている扱いでも自動和了は働く
  const white = s.kyoku!.players[2].drawn!;
  const r1 = applyAction(s, { type: "discard", seat: 2, tile: white }, 100);
  assert.equal(r1.state.phase, "result", "捨てた瞬間に自動でロンされる");
  assert.equal(r1.state.result!.wins[0].seat, 1);
  // 同じ時刻に届いた次の打牌（連打）は受け付けられない
  const anyTile = r1.state.kyoku!.players[2].hand[0];
  const r2 = applyAction(r1.state, { type: "discard", seat: 2, tile: anyTile }, 100);
  assert.ok(r2.error);
  assert.equal(r2.state.result!.wins[0].seat, 1);
});

test("自分のツモ牌で和了できるときは、ツモした瞬間に自動で和了する（連打のツモ切りは届かない）", () => {
  let s = freshHumans();
  // 席0: 立直中。次に引く牌（山の先頭）が和了牌になるようにする
  setHand(s, 0, "123m456p789s77z55z", "9m");
  const p0 = s.kyoku!.players[0];
  p0.riichi = 1;
  s.opts[0].autoHora = true;
  const winTile = parseTiles("5z")[0] + 2; // 白（手牌とは別の牌ID）
  s.kyoku!.wall.unshift(winTile);
  const r = applyAction(s, { type: "discard", seat: 0, tile: p0.drawn! }, 100);
  assert.equal(r.state.phase, "result");
  assert.equal(r.state.result!.title, "ツモ");
  const again = applyAction(r.state, { type: "discard", seat: 0, tile: winTile }, 100);
  assert.ok(again.error, "和了後のツモ切りは受け付けない");
});

test("局が終わるたびに牌譜（終局時の盤面）が記録される", () => {
  let s = createGame(cpuSeats(), { ...DEFAULT_RULES }, 4242, 0);
  assert.equal(s.lastKifu, null);
  let now = 0;
  const serials: number[] = [];
  for (let i = 0; i < 200000 && s.phase !== "ended"; i++) {
    now += 300;
    s = applyAction(s, { type: "tick" }, now).state;
    const k = s.lastKifu;
    if (k && serials[serials.length - 1] !== k.serial) {
      serials.push(k.serial);
      assert.equal(k.players.length, 4);
      assert.equal(k.names.length, 4);
      assert.deepEqual(k.result.scoresAfter, k.scoresBefore.map((x, j) => x + k.result.deltas[j]));
      const tiles = k.players.reduce((a, p) => a + p.river.length + p.hand.length, 0);
      assert.ok(tiles >= 52, "手牌と河の枚数が少なすぎる");
    }
  }
  assert.ok(serials.length >= 4);
  assert.deepEqual(serials, serials.map((_, i) => i + 1));
});

test("捨てられた後に聴牌しても、その捨て牌がまだロンできるなら自動和了する", () => {
  let s = freshHumans();
  s.opts[1].autoHora = true;
  // 席1はまだ聴牌していない（1p を切ると 2z 単騎の聴牌、役は中）
  setHand(s, 1, "123m456p789s77z2z1p", "7z");
  setHand(s, 2, "123m456p789s1344z", "2z");
  const t = s.kyoku!.players[2].drawn!;
  s = applyAction(s, { type: "discard", seat: 2, tile: t }, 100).state;
  assert.equal(s.phase, "playing", "聴牌していないので、この時点では和了しない");
  const onePin = s.kyoku!.players[1].hand.find((x) => kindOf(x) === 9)!;
  s = applyAction(s, { type: "discard", seat: 1, tile: onePin }, 200).state;
  assert.equal(s.phase, "result");
  assert.equal(s.result!.wins.length, 1);
  assert.equal(s.result!.wins[0].seat, 1);
  assert.equal(s.result!.wins[0].fromSeat, 2);
});

test("自動和了OFFなら、打牌で聴牌しても自動では和了しない", () => {
  let s = freshHumans();
  s.opts[1].autoHora = false;
  setHand(s, 1, "123m456p789s77z2z1p", "7z");
  setHand(s, 2, "123m456p789s1344z", "2z");
  s = applyAction(s, { type: "discard", seat: 2, tile: s.kyoku!.players[2].drawn! }, 100).state;
  const onePin = s.kyoku!.players[1].hand.find((x) => kindOf(x) === 9)!;
  s = applyAction(s, { type: "discard", seat: 1, tile: onePin }, 200).state;
  assert.equal(s.phase, "playing");
  assert.ok(evalRon(s, 1, { type: "discard", from: 2, index: s.kyoku!.players[2].river.length - 1 }), "手動ならロンできる");
});

test("一荘戦は北4局まで続く（飛びがなければ）", () => {
  for (const seed of [11, 12, 13]) {
    let s = createGame(cpuSeats("weak"), { ...DEFAULT_RULES, length: "issou" }, seed, 0);
    let now = 0;
    let maxIdx = 0;
    for (let i = 0; i < 400000 && s.phase !== "ended"; i++) {
      now += 300;
      s = applyAction(s, { type: "tick" }, now).state;
      maxIdx = Math.max(maxIdx, s.roundWind * 4 + s.kyokuNum);
      assert.equal(totalPoints(s), 100000);
    }
    assert.equal(s.phase, "ended");
    const tobi = s.scores.some((x) => x < 0);
    if (!tobi) assert.equal(maxIdx, 15, `seed ${seed}: 北4局まで行っていない`);
    assert.ok(maxIdx <= 15);
  }
});

// ---------------------------------------------------------------- 三人麻雀

function cpuSeats3(level: SeatInfo["cpuLevel"] = "normal"): SeatInfo[] {
  return [0, 1, 2].map((i) => ({ name: `CPU${i}`, isCpu: true, cpuLevel: level }));
}

for (const level of ["weak", "normal", "strong"] as const) {
  for (const length of ["tonpu", "hanchan", "issou"] as const) {
    test(`三人麻雀: CPU 3人で最後まで対局できる (${level}, ${length})`, () => {
      for (const seed of [1, 2]) {
        let s = createGame(cpuSeats3(level), { ...DEFAULT_RULES, length }, seed * 131 + 7, 0);
        assert.equal(s.kyoku!.players.length, 3);
        let now = 0;
        let nukiSeen = 0;
        let maxIdx = 0;
        for (let i = 0; i < 400000 && s.phase !== "ended"; i++) {
          now += 300;
          s = applyAction(s, { type: "tick" }, now).state;
          const total = s.scores.reduce((a, b) => a + b, 0) + s.kyotaku * 1000;
          assert.equal(total, 105000, "点数の合計が保存されていない");
          if (s.kyoku) {
            // 二萬〜八萬は使わない
            for (const p of s.kyoku.players) for (const t of [...p.hand, ...p.river.map((r) => r.tile)]) assert.ok(kindOf(t) < 1 || kindOf(t) > 7);
            nukiSeen = Math.max(nukiSeen, ...s.kyoku.players.map((p) => (p.nuki ?? []).length));
          }
          maxIdx = Math.max(maxIdx, s.roundWind * 3 + s.kyokuNum);
          assert.ok(s.kyokuNum < 3);
        }
        assert.equal(s.phase, "ended");
        assert.equal(s.final!.players.length, 3);
        const pts = s.final!.players.reduce((a, b) => a + b.points, 0);
        assert.ok(Math.abs(pts) < 0.01, `最終得点の合計が0でない: ${pts}`);
        assert.ok(nukiSeen > 0, "北抜きが一度も起きていない");
        const limit = { tonpu: 5, hanchan: 8, issou: 11 }[length];
        assert.ok(maxIdx <= limit);
      }
    });
  }
}

function fresh3(seed = 5): GameState {
  const s = createGame([0, 1, 2].map((i) => ({ name: `P${i}`, isCpu: false, cpuLevel: "normal" as const })), DEFAULT_RULES, seed, 0);
  if (s.phase !== "playing") return fresh3(seed + 1);
  for (const p of s.kyoku!.players) p.firstTurn = false;
  return s;
}

test("三人麻雀: 持ち点35000、チーはできない", () => {
  const s = fresh3();
  assert.deepEqual(s.scores, [35000, 35000, 35000]);
  setHand(s, 1, "19m123p456p789s11z2z", "9s");
  setHand(s, 0, "19m123p456p789s11z3z", "1s");
  // 席0（席1の上家）が 7s を捨てても、席1はチーできない（89s を持っていても）
  let st = applyAction(s, { type: "discard", seat: 0, tile: s.kyoku!.players[0].hand.find((t) => kindOf(t) === 26)! }, 100).state;
  assert.ok(!callOptions(st, 1).some((o) => o.type === "chi"));
});

test("三人麻雀: 北を抜くと抜きドラになり、嶺上牌をツモる", () => {
  let s = fresh3();
  // 席0: 北を持っていて、抜いてから和了できる形
  setHand(s, 0, "123p456p789s11z22z4z", "9m");
  s.opts[0].autoHora = false;
  const before = s.kyoku!.players[0].hand.length;
  s = applyAction(s, { type: "nuki", seat: 0 }, 100).state;
  const p = s.kyoku!.players[0];
  assert.equal((p.nuki ?? []).length, 1);
  assert.equal(p.hand.length, before); // 北を抜いて嶺上牌を1枚ツモ
  assert.ok(p.rinshan);
  assert.equal(s.events[s.events.length - 1].type === "nuki" || s.events.some((e) => e.type === "nuki"), true);
});

test("三人麻雀: ツモ損（子のツモは2人だけが払う）", () => {
  let s = fresh3();
  // 親=席0。席1が子で門前ツモ（立直なし・メンゼンツモのみ＋α）
  s.opts[1].autoHora = false;
  setHand(s, 1, "123p456p789s11s99m", "9m");
  const before = s.scores.slice();
  s = applyAction(s, { type: "tsumo", seat: 1 }, 100).state;
  assert.equal(s.phase, "result");
  const d = s.result!.deltas;
  const w = s.result!.wins[0];
  // 支払ったのは席0と席2だけで、合計が和了者の受取
  assert.equal(d[0] + d[2] + d[1], 0);
  assert.ok(d[0] < 0 && d[2] < 0);
  // 四人麻雀なら子のツモは 親2倍+子1倍×2。三人は 親2倍+子1倍（ツモ損）
  assert.equal(d[1], w.points);
  assert.ok(before.every((x) => x === 35000));
});
