"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AUTO_TSUMOGIRI_MS,
  DISCARD_TIMEOUT_MS,
  ankanOptions,
  callOptions,
  canKyuushu,
  dealerSeat,
  discardDeadline,
  doraIndicatorsShown,
  evalTsumo,
  kakanOptions,
  kindName,
  kindOf,
  legalDiscards,
  riichiDiscards,
  ronOptions,
  roundLabel,
  type Action,
  type CallOption,
  type GameState,
  type Kind,
  type Meld,
  type RiverTile,
  type RonTarget,
  type Tile as TileId,
} from "@dopa/shared";
import Tile from "./Tile";
import { serverNow } from "@/lib/clock";
import { SE } from "@/lib/sounds";

const WIND = ["東", "南", "西", "北"];

interface Props {
  state: GameState;
  mySeat: number | null; // null = 観戦
  onAction: (a: Action) => void;
  connected: boolean[];
}

const RIGHT_CLICK_KEY = "dopa_right_click_tsumogiri";

function loadRightClickSetting(): boolean {
  try {
    return window.localStorage.getItem(RIGHT_CLICK_KEY) !== "0";
  } catch {
    return true;
  }
}

function saveRightClickSetting(on: boolean) {
  try {
    window.localStorage.setItem(RIGHT_CLICK_KEY, on ? "1" : "0");
  } catch {
    // 保存できなくても続行
  }
}

function sortHand(tiles: TileId[]): TileId[] {
  return tiles.slice().sort((a, b) => kindOf(a) - kindOf(b) || a - b);
}

function seatWindIndex(state: GameState, seat: number): number {
  return (seat - dealerSeat(state) + 4) % 4;
}

// ------------------------------------------------------------ 河・副露

function River({
  river,
  aka,
  highlightLast,
  size = "xs",
  rows = 1,
}: {
  river: RiverTile[];
  aka: boolean;
  highlightLast: "callable" | "win" | null;
  size?: "xs" | "sm";
  rows?: number;
}) {
  const lastIdx = river.length - 1;
  // 1段 = 牌の高さ(24px) + 隙間(2px)
  return (
    <div className="flex flex-wrap gap-[2px] content-start" style={{ minHeight: rows * 26 - 2 }}>
      {river.map((r, i) => {
        const isLast = i === lastIdx;
        const called = r.calledBy !== null;
        return (
          <span key={i} className={isLast ? "flex deal-in" : "flex"}>
            <Tile
              tile={r.tile}
              aka={aka}
              size={size}
              sideways={r.riichi}
              highlight={called ? "dim" : isLast && highlightLast ? highlightLast : isLast ? "riichi" : null}
            />
          </span>
        );
      })}
    </div>
  );
}

export function Melds({ melds, seat, aka, size = "xs" }: { melds: Meld[]; seat: number; aka: boolean; size?: "2xs" | "xs" | "sm" }) {
  if (melds.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 justify-end">
      {melds.map((m, i) => {
        if (m.type === "ankan") {
          return (
            <div key={i} className="flex gap-[1px]">
              <Tile tile={null} size={size} />
              <Tile tile={m.tiles[1]} aka={aka} size={size} />
              <Tile tile={m.tiles[2]} aka={aka} size={size} />
              <Tile tile={null} size={size} />
            </div>
          );
        }
        // 鳴いた牌を横向きに（上家=左、対面=中、下家=右）
        const rel = m.from === null ? 0 : (m.from - seat + 4) % 4;
        const others = m.tiles.filter((t) => t !== m.calledTile);
        const sideIdx = rel === 3 ? 0 : rel === 2 ? 1 : others.length;
        const row: { t: TileId; side: boolean }[] = others.map((t) => ({ t, side: false }));
        row.splice(sideIdx, 0, { t: m.calledTile!, side: true });
        return (
          <div key={i} className="flex gap-[1px] items-end">
            {row.map((x, j) => (
              <Tile key={j} tile={x.t} aka={aka} size={size} sideways={x.side} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------ 各プレイヤーの表示

function PlayerPanel({
  state,
  seat,
  me,
  connected,
  highlightLast,
  banner,
  riverRows,
}: {
  state: GameState;
  seat: number;
  me: boolean;
  connected: boolean;
  highlightLast: "callable" | "win" | null;
  banner: string | null;
  /** 河のために確保しておく段数 */
  riverRows: number;
}) {
  const k = state.kyoku!;
  const p = k.players[seat];
  const info = state.seats[seat];
  const w = seatWindIndex(state, seat);
  const aka = state.rules.aka;
  return (
    <div className={`relative rounded-xl p-2 ${me ? "bg-black/25" : "bg-black/20"} flex flex-col gap-1.5`}>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs min-h-5">
        {/* 名前などは1行に収め、副露の場所が足りないときだけ副露を次の行に回す */}
        <div className="flex items-center gap-1.5 h-5 whitespace-nowrap overflow-hidden grow basis-0 min-w-[6.5rem]">
        <span
          className={`w-5 h-5 shrink-0 rounded flex items-center justify-center font-black ${
            w === 0 ? "bg-dp-bad text-white" : "bg-white/15"
          }`}
        >
          {WIND[w]}
        </span>
        {p.riichi > 0 && <span className="px-1 rounded bg-dp-accent text-black font-black shrink-0">立直</span>}
        <span className="font-bold truncate min-w-[1.75rem] max-w-[7rem]">{info.name}</span>
        <span className="font-mono text-dp-accent shrink-0">{state.scores[seat].toLocaleString()}</span>
        {!info.isCpu && !connected && <span className="text-dp-bad font-bold shrink-0">切断中</span>}
        {!info.isCpu && connected && state.opts[seat].autoHora && <span className="text-dp-accent2 truncate">自動和了</span>}
        </div>
        {/* 副露は名前の行の右端に小さく表示（行を増やさないため） */}
        {!me && p.melds.length > 0 && (
          <span className="ml-auto shrink-0">
            <Melds melds={p.melds} seat={seat} aka={aka} size="2xs" />
          </span>
        )}
      </div>
      <River river={p.river} aka={aka} highlightLast={highlightLast} rows={riverRows} />
      {banner && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="call-banner text-3xl font-black text-dp-accent drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
            {banner}
          </span>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------ タイマー

function DiscardTimer({ state, seat, label, labelClass }: { state: GameState; seat: number; label: string; labelClass: string }) {
  const [now, setNow] = useState(serverNow());
  const lastBeep = useRef<number>(-1);
  useEffect(() => {
    const iv = setInterval(() => setNow(serverNow()), 100);
    return () => clearInterval(iv);
  }, []);
  const p = state.kyoku?.players[seat];
  const deadline = discardDeadline(state, seat, DISCARD_TIMEOUT_MS, AUTO_TSUMOGIRI_MS);
  const total = p && (p.riichi > 0 || state.opts[seat].tsumogiri) && p.drawn !== null ? AUTO_TSUMOGIRI_MS : DISCARD_TIMEOUT_MS;
  const remain = deadline === null ? 0 : Math.max(0, deadline - now);
  const secs = Math.ceil(remain / 1000);
  useEffect(() => {
    if (deadline === null || total !== DISCARD_TIMEOUT_MS) return;
    if (secs <= 3 && secs >= 1 && lastBeep.current !== secs) {
      lastBeep.current = secs;
      SE.tick();
    }
    if (secs > 3) lastBeep.current = -1;
  }, [secs, deadline, total]);
  // 案内文とタイマーを1行にまとめる（高さはタイマーの有無で変わらない）
  const text = <span className={`text-xs truncate min-w-0 flex-1 ${labelClass}`}>{label}</span>;
  if (deadline === null) {
    return (
      <div className="h-4 flex items-center gap-2">
        {text}
        <div className="w-2/5 h-2 rounded-full bg-white/10" />
        <span className="w-6" />
      </div>
    );
  }
  const ratio = remain / total;
  return (
    <div className="h-4 flex items-center gap-2">
      {text}
      <div className="w-2/5 h-2 rounded-full bg-white/10 overflow-hidden">
        <div
          className={`h-full ${ratio < 0.3 ? "bg-dp-bad" : "bg-dp-accent2"}`}
          style={{ width: `${ratio * 100}%`, transition: "width 0.1s linear" }}
        />
      </div>
      <span className={`text-xs font-mono w-6 text-right ${secs <= 3 ? "text-dp-bad font-bold" : "text-dp-muted"}`}>
        {secs}
      </span>
    </div>
  );
}

function SlotButton({
  show,
  color,
  small,
  onClick,
  children,
}: {
  show: boolean;
  color: string;
  small?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`btn ${small ? "text-sm" : "text-base"} px-1 py-1 h-10 w-full whitespace-nowrap ${color} ${
        show ? "pop-in" : "invisible pointer-events-none"
      }`}
      disabled={!show}
      aria-hidden={!show}
      tabIndex={show ? 0 : -1}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

// ------------------------------------------------------------ 本体

type Chooser =
  | { kind: "ron"; options: RonTarget[] }
  | { kind: "call"; options: CallOption[] }
  | { kind: "kan"; ankan: Kind[]; kakan: Kind[]; minkan: CallOption[] }
  | null;

const CALL_LABEL: Record<CallOption["type"], string> = { chi: "チー", pon: "ポン", minkan: "カン" };

export default function GameView({ state, mySeat, onAction, connected }: Props) {
  const k = state.kyoku;
  const [riichiMode, setRiichiMode] = useState(false);
  const [chooser, setChooser] = useState<Chooser>(null);
  const [banners, setBanners] = useState<Record<number, { text: string; id: number }>>({});
  const aka = state.rules.aka;
  const playing = state.phase === "playing" && !!k;
  const spectator = mySeat === null;
  const viewSeat = mySeat ?? 0;

  // 自分が操作できること
  const me = mySeat !== null && k ? k.players[mySeat] : null;
  const opts = mySeat !== null ? state.opts[mySeat] : null;
  const legal = useMemo(() => (playing && mySeat !== null ? legalDiscards(state, mySeat) : []), [state, mySeat, playing]);
  const riichiOk = useMemo(() => (playing && mySeat !== null ? riichiDiscards(state, mySeat) : []), [state, mySeat, playing]);
  const rons = useMemo(() => (playing && mySeat !== null ? ronOptions(state, mySeat) : []), [state, mySeat, playing]);
  const canTsumo = useMemo(() => (playing && mySeat !== null ? !!evalTsumo(state, mySeat) : false), [state, mySeat, playing]);
  const calls = useMemo(
    () => (playing && mySeat !== null && !opts?.noCall && !opts?.tsumogiri ? callOptions(state, mySeat) : []),
    [state, mySeat, playing, opts?.noCall, opts?.tsumogiri],
  );
  const ankans = useMemo(() => (playing && mySeat !== null ? ankanOptions(state, mySeat) : []), [state, mySeat, playing]);
  const kakans = useMemo(() => (playing && mySeat !== null ? kakanOptions(state, mySeat) : []), [state, mySeat, playing]);
  const kyuushu = playing && mySeat !== null && canKyuushu(state, mySeat);

  // 鳴ける・ロンできる捨て牌の強調（席ごと）
  const highlight: ("callable" | "win" | null)[] = [0, 1, 2, 3].map((seat) => {
    if (rons.some((r) => r.from === seat && r.type === "discard")) return "win";
    if (calls.some((c) => c.from === seat)) return "callable";
    return null;
  });

  // 鳴き・和了のチャンスが来たら合図の音
  const chanceKey = `${rons.length}-${calls.length}-${canTsumo}`;
  const prevChance = useRef("0-0-false");
  useEffect(() => {
    const [r0, c0, t0] = prevChance.current.split("-");
    if (rons.length > Number(r0) || calls.length > Number(c0) || (canTsumo && t0 !== "true")) SE.chance();
    prevChance.current = chanceKey;
  }, [chanceKey, rons.length, calls.length, canTsumo]);

  // 局が変わったら立直モード等を解除
  useEffect(() => {
    setRiichiMode(false);
    setChooser(null);
  }, [state.kyokuSerial]);
  useEffect(() => {
    if (riichiMode && riichiOk.length === 0) setRiichiMode(false);
  }, [riichiMode, riichiOk.length]);

  // イベントに応じた効果音・演出
  const lastEvent = useRef<number>(state.eventSeq);
  const myDrawn = me?.drawn ?? null;
  const prevDrawn = useRef<TileId | null>(myDrawn);
  useEffect(() => {
    const fresh = state.events.filter((e) => e.id > lastEvent.current);
    lastEvent.current = state.eventSeq;
    const recent = fresh.slice(-4);
    for (const e of recent) {
      switch (e.type) {
        case "discard":
          if (e.seat === mySeat) SE.discard();
          else SE.otherDiscard();
          break;
        case "riichi":
          SE.riichi();
          break;
        case "chi":
          SE.chi();
          break;
        case "pon":
          SE.pon();
          break;
        case "kan":
          SE.kan();
          break;
        case "ron":
          SE.ron();
          break;
        case "tsumo":
          SE.tsumo();
          break;
        case "ryukyoku":
        case "abort":
          SE.ryukyoku();
          break;
        case "kyokuStart":
          SE.kyokuStart();
          break;
        case "gameEnd":
          SE.fanfare();
          break;
      }
      const label: Partial<Record<string, string>> = {
        riichi: "リーチ",
        chi: "チー",
        pon: "ポン",
        kan: "カン",
        ron: "ロン",
        tsumo: "ツモ",
      };
      const text = label[e.type];
      if (text && e.seat !== null) {
        const seat = e.seat;
        setBanners((b) => ({ ...b, [seat]: { text, id: e.id } }));
        setTimeout(() => {
          setBanners((b) => {
            if (b[seat]?.id !== e.id) return b;
            const n = { ...b };
            delete n[seat];
            return n;
          });
        }, 1300);
      }
    }
  }, [state.eventSeq, state.events, mySeat]);
  useEffect(() => {
    if (myDrawn !== null && myDrawn !== prevDrawn.current && playing) SE.draw();
    prevDrawn.current = myDrawn;
  }, [myDrawn, playing]);

  // 右クリックでツモ切り（マウス操作のときだけ。設定はこの端末に保存）
  const [rightClick, setRightClick] = useState(true);
  const [finePointer, setFinePointer] = useState(false);
  useEffect(() => {
    setRightClick(loadRightClickSetting());
    setFinePointer(typeof window !== "undefined" && window.matchMedia?.("(pointer: fine)").matches);
  }, []);
  const tsumogiriRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    if (spectator || !rightClick) return;
    let lastPointer = "mouse";
    const onPointer = (e: PointerEvent) => {
      lastPointer = e.pointerType;
    };
    const onContext = (e: MouseEvent) => {
      // スマホの長押しでは反応させない（誤ってツモ切りしないように）
      if (lastPointer !== "mouse") return;
      e.preventDefault();
      tsumogiriRef.current();
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("contextmenu", onContext);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("contextmenu", onContext);
    };
  }, [spectator, rightClick]);

  if (!k) return null;

  const act = (a: Action) => {
    SE.button();
    onAction(a);
  };

  const discard = (t: TileId) => {
    if (mySeat === null) return;
    if (riichiMode) {
      if (!riichiOk.includes(t)) return;
      setRiichiMode(false);
      onAction({ type: "discard", seat: mySeat, tile: t, riichi: true });
      return;
    }
    if (!legal.includes(t)) {
      SE.error();
      return;
    }
    onAction({ type: "discard", seat: mySeat, tile: t });
  };

  tsumogiriRef.current = () => {
    if (!playing || !me || me.drawn === null || !me.mustDiscard) return;
    discard(me.drawn);
  };

  const doRon = (t: RonTarget) => mySeat !== null && act({ type: "ron", seat: mySeat, target: t });
  const doCall = (o: CallOption) => {
    if (mySeat === null) return;
    setChooser(null);
    act({ type: o.type, seat: mySeat, from: o.from, index: o.index, tiles: o.tiles });
  };
  const pressCall = (type: "chi" | "pon") => {
    const list = calls.filter((c) => c.type === type);
    if (list.length === 1) doCall(list[0]);
    else setChooser({ kind: "call", options: list });
  };
  const minkans = calls.filter((c) => c.type === "minkan");
  const kanCount = ankans.length + kakans.length + minkans.length;
  const pressKan = () => {
    if (mySeat === null) return;
    if (kanCount === 1) {
      if (ankans.length) act({ type: "ankan", seat: mySeat, kind: ankans[0] });
      else if (kakans.length) act({ type: "kakan", seat: mySeat, kind: kakans[0] });
      else doCall(minkans[0]);
      return;
    }
    setChooser({ kind: "kan", ankan: ankans, kakan: kakans, minkan: minkans });
  };

  const order = [(viewSeat + 2) % 4, (viewSeat + 3) % 4, (viewSeat + 1) % 4];
  const hand = me ? me.hand.filter((t) => t !== me.drawn) : [];
  const sorted = sortHand(hand);
  const hasChi = calls.some((c) => c.type === "chi");
  const hasPon = calls.some((c) => c.type === "pon");
  // ボタンに出す「鳴ける牌」（同じ牌種は1つにまとめる）
  const targetsOf = (type: "chi" | "pon") => {
    const out: TileId[] = [];
    for (const c of calls) if (c.type === type && !out.some((t) => kindOf(t) === kindOf(c.target))) out.push(c.target);
    return out;
  };
  const kanTile: TileId | null =
    kanCount !== 1
      ? null
      : ankans.length
        ? me?.hand.find((t) => kindOf(t) === ankans[0]) ?? null
        : kakans.length
          ? me?.hand.find((t) => kindOf(t) === kakans[0]) ?? null
          : minkans[0]?.target ?? null;
  const withTiles = (tiles: TileId[], label: string) => (
    <span className="flex items-center justify-center gap-1">
      {tiles.slice(0, 2).map((t) => (
        <Tile key={t} tile={t} aka={aka} size="xs" />
      ))}
      <span>{label}</span>
    </span>
  );

  return (
    <div className="flex flex-col gap-2">
      {/* 局の情報 */}
      <div className="card px-3 py-1.5 flex items-center justify-between gap-2 text-sm">
        <div className="flex items-baseline gap-2 whitespace-nowrap">
          <span className="font-black">{roundLabel(state)}</span>
          <span className="text-xs text-dp-muted">
            供託{state.kyotaku}・残り<span className={k.wall.length <= 10 ? "text-dp-bad font-bold" : ""}>{k.wall.length}</span>
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-dp-muted mr-0.5">ドラ</span>
          {doraIndicatorsShown(state).map((t) => (
            <Tile key={t} tile={t} aka={aka} size="xs" />
          ))}
        </div>
      </div>

      {spectator && (
        <div className="text-center text-xs text-dp-muted">観戦中（手牌は和了・流局時のみ公開されます）</div>
      )}

      {/* 他家 */}
      <div className="felt rounded-2xl p-2 grid grid-cols-2 gap-2">
        <div className="col-span-2">
          <PlayerPanel
            state={state}
            seat={order[0]}
            me={false}
            connected={connected[order[0]]}
            highlightLast={highlight[order[0]]}
            banner={banners[order[0]]?.text ?? null}
            riverRows={2}
          />
        </div>
        <PlayerPanel
          state={state}
          seat={order[1]}
          me={false}
          connected={connected[order[1]]}
          highlightLast={highlight[order[1]]}
          banner={banners[order[1]]?.text ?? null}
          riverRows={3}
        />
        <PlayerPanel
          state={state}
          seat={order[2]}
          me={false}
          connected={connected[order[2]]}
          highlightLast={highlight[order[2]]}
          banner={banners[order[2]]?.text ?? null}
          riverRows={3}
        />
        <div className="col-span-2">
          <PlayerPanel
            state={state}
            seat={viewSeat}
            me={!spectator}
            connected={connected[viewSeat]}
            highlightLast={null}
            banner={banners[viewSeat]?.text ?? null}
            riverRows={2}
          />
        </div>
      </div>

      {!spectator && mySeat !== null && me && (
        <div className="card p-2 flex flex-col gap-2">
          <DiscardTimer
            state={state}
            seat={mySeat}
            labelClass={riichiMode ? "text-dp-accent2 font-bold" : "text-dp-muted"}
            label={
              riichiMode
                ? "立直する牌を選んでください"
                : me.mustDiscard
                  ? me.afterCall
                    ? "鳴いた後の1枚を捨ててください"
                    : "捨てる牌をタップ"
                  : k.wall.length === 0
                    ? "山切れ。流局を待っています"
                    : "ツモ待ち"
            }
          />

          {/* 鳴き・和了ボタン。位置がずれて押し間違えないよう、各ボタンの場所は固定（押せないときは見えなくするだけ） */}
          <div className="grid grid-cols-4 gap-1.5">
            <SlotButton show={rons.length > 0} color="bg-dp-bad text-white" onClick={() => (rons.length === 1 ? doRon(rons[0]) : setChooser({ kind: "ron", options: rons }))}>
              ロン
            </SlotButton>
            <SlotButton show={canTsumo} color="bg-dp-bad text-white" onClick={() => act({ type: "tsumo", seat: mySeat })}>
              ツモ
            </SlotButton>
            <SlotButton
              show={riichiOk.length > 0}
              color={riichiMode ? "bg-white text-black" : "bg-dp-accent2 text-black"}
              onClick={() => {
                SE.button();
                setRiichiMode((v) => !v);
              }}
            >
              {riichiMode ? "やめる" : "立直"}
            </SlotButton>
            <SlotButton show={kyuushu} color="bg-dp-panel2 text-dp-text" small onClick={() => act({ type: "kyuushu", seat: mySeat })}>
              九種九牌
            </SlotButton>
            <SlotButton show={hasPon} color="bg-dp-accent text-black" onClick={() => pressCall("pon")}>
              {withTiles(targetsOf("pon"), "ポン")}
            </SlotButton>
            <SlotButton show={hasChi} color="bg-dp-accent text-black" onClick={() => pressCall("chi")}>
              {withTiles(targetsOf("chi"), "チー")}
            </SlotButton>
            <SlotButton show={kanCount > 0} color="bg-dp-accent text-black" onClick={pressKan}>
              {withTiles(kanTile !== null ? [kanTile] : [], "カン")}
            </SlotButton>
          </div>
          {/* 手牌 */}
          <div className="flex items-end justify-center pt-2 overflow-x-auto">
            {sorted.map((t) => {
              const ok = riichiMode ? riichiOk.includes(t) : legal.includes(t);
              return (
                <Tile
                  key={t}
                  tile={t}
                  aka={aka}
                  size="md"
                  onClick={() => discard(t)}
                  disabled={me.mustDiscard && !ok}
                  highlight={riichiMode && ok ? "selected" : null}
                />
              );
            })}
            {/* ツモ牌の場所は常に確保しておく（ツモの有無で手牌が左右にずれないように） */}
            <span className="w-2 shrink-0" />
            {me.drawn !== null ? (
              <span className="deal-in" key={`d${me.drawn}`}>
                <Tile
                  tile={me.drawn}
                  aka={aka}
                  size="md"
                  onClick={() => discard(me.drawn!)}
                  disabled={riichiMode ? !riichiOk.includes(me.drawn) : !legal.includes(me.drawn)}
                  highlight={riichiMode && riichiOk.includes(me.drawn) ? "selected" : "drawn"}
                />
              </span>
            ) : (
              <span className="tile tile-md invisible" aria-hidden />
            )}
          </div>
          <div className="flex justify-end">
            <Melds melds={me.melds} seat={mySeat} aka={aka} size="sm" />
          </div>

          {/* 補助ボタン */}
          <div className="flex gap-2 justify-center flex-wrap">
            {(
              [
                ["autoHora", "自動和了"],
                ["noCall", "鳴かない"],
                ["tsumogiri", "ツモ切り"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                className={`${opts![key] ? "chip-on" : "chip-off"} !px-2.5 !py-1 !text-xs`}
                onClick={() => act({ type: "opts", seat: mySeat, opts: { [key]: !opts![key] } })}
              >
                {label} {opts![key] ? "ON" : "OFF"}
              </button>
            ))}
            {finePointer && (
              <button
                className={`${rightClick ? "chip-on" : "chip-off"} !px-2.5 !py-1 !text-xs`}
                title="画面のどこでも右クリックすると、ツモ牌を切ります"
                onClick={() => {
                  SE.button();
                  const v = !rightClick;
                  setRightClick(v);
                  saveRightClickSetting(v);
                }}
              >
                右クリックでツモ切り {rightClick ? "ON" : "OFF"}
              </button>
            )}
          </div>
        </div>
      )}

      {chooser && mySeat !== null && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-3" onClick={() => setChooser(null)}>
          <div className="card p-4 w-full max-w-sm flex flex-col gap-2" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-black">{chooser.kind === "ron" ? "どれでロンしますか？" : "どれで鳴きますか？"}</h3>
            {chooser.kind === "ron" &&
              chooser.options.map((r, i) => (
                <button
                  key={i}
                  className="btn-secondary"
                  onClick={() => {
                    setChooser(null);
                    doRon(r);
                  }}
                >
                  {state.seats[r.from].name} の{r.type === "kakan" ? "加槓牌" : "捨て牌"}でロン
                </button>
              ))}
            {chooser.kind === "call" &&
              chooser.options.map((o, i) => (
                <button key={i} className="btn-secondary flex items-center gap-2" onClick={() => doCall(o)}>
                  <span className="w-12 text-left">{CALL_LABEL[o.type]}</span>
                  {sortHand([...o.tiles, o.target]).map((t) => (
                    <Tile key={t} tile={t} aka={aka} size="sm" highlight={t === o.target ? "callable" : null} />
                  ))}
                  <span className="text-xs text-dp-muted ml-auto">{state.seats[o.from].name}から</span>
                </button>
              ))}
            {chooser.kind === "kan" && (
              <>
                {chooser.ankan.map((kd) => (
                  <button key={`a${kd}`} className="btn-secondary" onClick={() => { setChooser(null); act({ type: "ankan", seat: mySeat, kind: kd }); }}>
                    暗槓 {kindName(kd)}
                  </button>
                ))}
                {chooser.kakan.map((kd) => (
                  <button key={`k${kd}`} className="btn-secondary" onClick={() => { setChooser(null); act({ type: "kakan", seat: mySeat, kind: kd }); }}>
                    加槓 {kindName(kd)}
                  </button>
                ))}
                {chooser.minkan.map((o, i) => (
                  <button key={`m${i}`} className="btn-secondary" onClick={() => doCall(o)}>
                    大明槓 {kindName(kindOf(o.target))}（{state.seats[o.from].name}から）
                  </button>
                ))}
              </>
            )}
            <button className="btn text-dp-muted" onClick={() => setChooser(null)}>
              やめる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
