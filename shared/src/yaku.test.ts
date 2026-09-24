import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateWin, ronPoints, tsumoPoints, type Meld, type WinInput } from "./yaku.ts";
import { EAST, SOUTH, kindOf, parseTiles, toCounts } from "./tiles.ts";
import { shanten, waitingKinds } from "./shanten.ts";

function input(hand: string, win: string, opts: Partial<WinInput> = {}): WinInput {
  const tiles = parseTiles(hand + win);
  const winTile = tiles[tiles.length - 1];
  return {
    hand: tiles,
    melds: [],
    winTile,
    isTsumo: false,
    seatWind: SOUTH,
    roundWind: EAST,
    riichi: 0,
    ippatsu: false,
    rinshan: false,
    chankan: false,
    haitei: false,
    houtei: false,
    tenhou: false,
    chiihou: false,
    doraIndicators: [],
    uraIndicators: [],
    aka: true,
    kuitan: true,
    ...opts,
  };
}

function names(r: ReturnType<typeof evaluateWin>): string[] {
  return r ? r.yaku.map((y) => y.name) : [];
}

function meld(type: Meld["type"], tiles: string, from: number | null = 0): Meld {
  const t = parseTiles(tiles);
  return { type, tiles: t, from: type === "ankan" ? null : from, calledTile: type === "ankan" ? null : t[0] };
}

test("shanten basics", () => {
  assert.equal(shanten(toCounts(parseTiles("123m456p789s1122z")), 0), 0);
  assert.equal(shanten(toCounts(parseTiles("123m456p789s11222z")), 0), -1);
  assert.equal(shanten(toCounts(parseTiles("19m19p19s1234567z")), 0), 0);
  assert.equal(shanten(toCounts(parseTiles("1122334455667z")), 0), 0);
});

test("waits and 5th tile rule", () => {
  assert.deepEqual(waitingKinds(toCounts(parseTiles("23m456p789s11122z")), 0), [0, 3]);
  // 1111m を使った単騎の1m待ちは不成立。純手牌で4枚使っている
  const w = waitingKinds(toCounts(parseTiles("1111m234p567s789s")), 0);
  assert.ok(!w.includes(0));
  // 国士13面
  assert.equal(waitingKinds(toCounts(parseTiles("19m19p19s1234567z")), 0).length, 13);
});

test("pinfu tsumo 20fu, ron 30fu", () => {
  const t = evaluateWin(input("234m456p678s2355s", "4s", { isTsumo: true }));
  assert.ok(t);
  assert.ok(names(t).includes("平和"));
  assert.ok(names(t).includes("門前清自摸和"));
  assert.equal(t!.fu, 20);
  const ron = evaluateWin(input("234m456p678s2355s", "4s"));
  assert.equal(ron!.fu, 30);
  assert.ok(names(ron).includes("平和"));
});

test("no yaku returns null", () => {
  // 喰い断なし・ロンの役無し
  const r = evaluateWin(
    input("234m456p55s78s", "9s", { melds: [meld("pon", "111z", 1)], seatWind: SOUTH, roundWind: SOUTH }),
  );
  // 東の刻子（自風南・場風南）→ 役なし
  assert.equal(r, null);
});

test("kuitan toggle", () => {
  const withKuitan = evaluateWin(input("234m456p55s67s", "8s", { melds: [meld("chi", "345m")] }));
  assert.ok(names(withKuitan).includes("断幺九"));
  const without = evaluateWin(input("234m456p55s67s", "8s", { melds: [meld("chi", "345m")], kuitan: false }));
  assert.equal(without, null);
});

test("chiitoi 25 fu", () => {
  const r = evaluateWin(input("1133m2288p4466s7", "7z"));
  assert.ok(names(r).includes("七対子"));
  assert.equal(r!.fu, 25);
  assert.equal(ronPoints(r!.basePoints, false), 1600);
});

test("ryanpeikou over chiitoi", () => {
  const r = evaluateWin(input("112233m445566p7", "7p", {}));
  assert.ok(names(r).includes("二盃口"));
  assert.ok(!names(r).includes("七対子"));
});

test("kokushi and 13-wait", () => {
  const r = evaluateWin(input("19m19p19s1234566z", "7z"));
  assert.deepEqual(names(r), ["国士無双"]);
  const r13 = evaluateWin(input("19m19p19s1234567z", "1m"));
  assert.deepEqual(names(r13), ["国士無双13面"]);
  assert.equal(r13!.yakumanMult, 1);
});

test("suuankou ron on shanpon is sanankou toitoi", () => {
  const ron = evaluateWin(input("111m222p333s44z55z", "5z"));
  assert.ok(ron);
  assert.ok(names(ron).includes("三暗刻"));
  assert.ok(names(ron).includes("対々和"));
  const tsumo = evaluateWin(input("111m222p333s44z55z", "5z", { isTsumo: true }));
  assert.deepEqual(names(tsumo), ["四暗刻"]);
  const tanki = evaluateWin(input("111m222p333s444z5z", "5z"));
  assert.deepEqual(names(tanki), ["四暗刻単騎"]);
});

test("daisangen + tsuuiisou double yakuman", () => {
  const r = evaluateWin(input("555z666z777z11z22", "2z", { isTsumo: true }));
  assert.ok(r);
  assert.ok(r!.yakumanMult >= 2);
  assert.ok(names(r).includes("大三元"));
  assert.ok(names(r).includes("字一色"));
});

test("chuuren and junsei", () => {
  const j = evaluateWin(input("1112345678999m", "5m"));
  assert.deepEqual(names(j), ["純正九蓮宝燈"]);
  const c = evaluateWin(input("1112345567899m", "9m"));
  assert.deepEqual(names(c), ["九蓮宝燈"]);
});

test("ryuuiisou without hatsu", () => {
  const r = evaluateWin(input("223344s666s888s2", "2s"));
  assert.ok(names(r).includes("緑一色"));
});

test("chinitsu 6 han open 5", () => {
  const r = evaluateWin(input("1234567899m", "9m", { melds: [meld("pon", "555m")] }));
  assert.ok(r);
  const ch = r!.yaku.find((y) => y.name === "清一色");
  assert.equal(ch!.han, 5);
});

test("fu: closed ron kanchan with ankou honor", () => {
  // 111z(自風でない東=場風)暗刻 + カンチャン 1m3m 待ち2m
  const r = evaluateWin(input("13m456p789s111z99p", "2m", { seatWind: SOUTH, roundWind: EAST }));
  assert.ok(r);
  // 20 + 10(門前ロン) + 2(カンチャン) + 8(字牌暗刻) = 40
  assert.equal(r!.fu, 40);
  assert.ok(names(r).includes("場風 東"));
});

test("double wind pair gives 4 fu", () => {
  const r = evaluateWin(input("234m456p789s67m11z", "8m", { seatWind: EAST, roundWind: EAST, riichi: 1 }));
  // 20+10+4 = 34 -> 40
  assert.equal(r!.fu, 40);
});

test("dora, aka, ura count and don't satisfy yaku", () => {
  // 役なし（ドラのみ）はnull
  const none = evaluateWin(
    input("234m406p55s78s", "9s", { melds: [meld("chi", "123p")], doraIndicators: parseTiles("4s") }),
  );
  assert.equal(none, null);
  const r = evaluateWin(input("234m406p678s55s78s", "9s", { riichi: 1, doraIndicators: parseTiles("4s"), uraIndicators: parseTiles("1z") }));
  assert.ok(r);
  const n = names(r);
  assert.ok(n.includes("立直"));
  assert.ok(n.includes("ドラ"));
  assert.ok(n.includes("赤ドラ"));
});

test("sanshoku open 1 han, ittsu", () => {
  const r = evaluateWin(input("123p123s55z78m", "9m", { melds: [meld("chi", "123m")] }));
  assert.ok(names(r).includes("三色同順"));
  const s = evaluateWin(input("123p123s55z23m", "1m", { melds: [meld("chi", "789s")] }));
  assert.ok(names(s).includes("三色同順"));
  assert.equal(s!.yaku.find((y) => y.name === "三色同順")!.han, 1);
  const it = evaluateWin(input("123456789m11p55z", "5z"));
  assert.ok(names(it).includes("一気通貫"));
});

test("payments", () => {
  assert.equal(ronPoints(2000, false), 8000);
  assert.equal(ronPoints(2000, true), 12000);
  assert.deepEqual(tsumoPoints(2000, false), { fromDealer: 4000, fromChild: 2000 });
  // 30符1飜 子ツモ 300/500
  assert.deepEqual(tsumoPoints(240, false), { fromDealer: 500, fromChild: 300 });
  // 30符4飜は切り上げ満貫なし: 7700
  assert.equal(ronPoints(30 * 64, false), 7700);
});

test("rinshan tsumo gets tsumo fu", () => {
  // 暗槓 + 嶺上ツモ
  const r = evaluateWin(
    input("234m456p78s55s", "9s", { isTsumo: true, rinshan: true, melds: [meld("ankan", "2222z")], seatWind: EAST, roundWind: EAST }),
  );
  assert.ok(r);
  // 20 + 2(ツモ) + 32(字牌暗槓) = 54 -> 60
  assert.equal(r!.fu, 60);
  assert.ok(names(r).includes("嶺上開花"));
});

test("kind helper", () => {
  assert.equal(kindOf(parseTiles("0m")[0]), 4);
});
