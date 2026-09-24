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
}: {
  river: RiverTile[];
  aka: boolean;
  highlightLast: "callable" | "win" | null;
  size?: "xs" | "sm";
}) {
  const lastIdx = river.length - 1;
  return (
    <div className="flex flex-wrap gap-[2px] content-start min-h-[30px]">
      {river.map((r, i) => {
        const isLast = i === lastIdx;
        const called = r.calledBy !== null;
        return (
          <span key={i} className={isLast ? "deal-in" : undefined}>
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

function Melds({ melds, seat, aka, size = "xs" }: { melds: Meld[]; seat: number; aka: boolean; size?: "xs" | "sm" }) {
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
  showHand,
}: {
  state: GameState;
  seat: number;
  me: boolean;
  connected: boolean;
  highlightLast: "callable" | "win" | null;
  banner: string | null;
  showHand: boolean;
}) {
  const k = state.kyoku!;
  const p = k.players[seat];
  const info = state.seats[seat];
  const w = seatWindIndex(state, seat);
  const aka = state.rules.aka;
  return (
    <div className={`relative rounded-xl p-2 ${me ? "bg-black/25" : "bg-black/20"} flex flex-col gap-1.5`}>
      <div className="flex items-center gap-1.5 text-xs">
        <span
          className={`w-5 h-5 rounded flex items-center justify-center font-black ${
            w === 0 ? "bg-dp-bad text-white" : "bg-white/15"
          }`}
        >
          {WIND[w]}
        </span>
        <span className="font-bold truncate max-w-[7rem]">{info.name}</span>
        <span className="font-mono text-dp-accent">{state.scores[seat].toLocaleString()}</span>
        {p.riichi > 0 && <span className="px-1 rounded bg-dp-accent text-black font-black">立直</span>}
        {info.isCpu && <span className="text-dp-muted">CPU</span>}
        {!info.isCpu && !connected && <span className="text-dp-bad font-bold">切断中</span>}
        {!info.isCpu && connected && state.opts[seat].autoHora && <span className="text-dp-accent2">自動和了</span>}
      </div>
      <Melds melds={p.melds} seat={seat} aka={aka} />
      {showHand && (
        <div className="flex flex-wrap gap-[1px]">
          {sortHand(p.hand).map((t) => (
            <Tile key={t} tile={t} aka={aka} size="xs" />
          ))}
        </div>
      )}
      {!showHand && !me && (
        <div className="flex gap-[1px] opacity-60">
          {Array.from({ length: p.hand.length }).map((_, i) => (
            <span key={i} className="w-[7px] h-[12px] rounded-[2px] bg-[#1d8a63]" />
          ))}
        </div>
      )}
      <River river={p.river} aka={aka} highlightLast={highlightLast} />
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

function DiscardTimer({ state, seat }: { state: GameState; seat: number }) {
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
  if (deadline === null) {
    return <div className="h-2 rounded-full bg-white/10" />;
  }
  const ratio = remain / total;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
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

// ------------------------------------------------------------ 本体

type Chooser =
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

  return (
    <div className="flex flex-col gap-2">
      {/* 局の情報 */}
      <div className="card px-3 py-2 flex items-center justify-between gap-2 text-sm">
        <div className="flex flex-col">
          <span className="font-black text-base">{roundLabel(state)}</span>
          <span className="text-xs text-dp-muted">
            供託 {state.kyotaku}・残り山 <span className={k.wall.length <= 10 ? "text-dp-bad font-bold" : ""}>{k.wall.length}</span>
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-dp-muted mr-1">ドラ表示</span>
          {doraIndicatorsShown(state).map((t) => (
            <Tile key={t} tile={t} aka={aka} size="sm" />
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
            showHand={false}
          />
        </div>
        <PlayerPanel
          state={state}
          seat={order[1]}
          me={false}
          connected={connected[order[1]]}
          highlightLast={highlight[order[1]]}
          banner={banners[order[1]]?.text ?? null}
          showHand={false}
        />
        <PlayerPanel
          state={state}
          seat={order[2]}
          me={false}
          connected={connected[order[2]]}
          highlightLast={highlight[order[2]]}
          banner={banners[order[2]]?.text ?? null}
          showHand={false}
        />
        <div className="col-span-2">
          <PlayerPanel
            state={state}
            seat={viewSeat}
            me={!spectator}
            connected={connected[viewSeat]}
            highlightLast={null}
            banner={banners[viewSeat]?.text ?? null}
            showHand={false}
          />
        </div>
      </div>

      {!spectator && mySeat !== null && me && (
        <div className="card p-2 flex flex-col gap-2">
          <DiscardTimer state={state} seat={mySeat} />

          {/* 鳴き・和了ボタン（押せるときだけ大きく表示） */}
          <div className="flex flex-wrap gap-2 justify-center min-h-[52px] items-center">
            {rons.map((r, i) => (
              <button key={`ron${i}`} className="btn pop-in bg-dp-bad text-white text-xl px-6 py-3" onClick={() => doRon(r)}>
                ロン{rons.length > 1 ? `（${state.seats[r.from].name}）` : ""}
              </button>
            ))}
            {canTsumo && (
              <button className="btn pop-in bg-dp-bad text-white text-xl px-6 py-3" onClick={() => act({ type: "tsumo", seat: mySeat })}>
                ツモ
              </button>
            )}
            {hasPon && (
              <button className="btn pop-in bg-dp-accent text-black text-xl px-6 py-3" onClick={() => pressCall("pon")}>
                ポン
              </button>
            )}
            {hasChi && (
              <button className="btn pop-in bg-dp-accent text-black text-xl px-6 py-3" onClick={() => pressCall("chi")}>
                チー
              </button>
            )}
            {kanCount > 0 && (
              <button className="btn pop-in bg-dp-accent text-black text-xl px-6 py-3" onClick={pressKan}>
                カン
              </button>
            )}
            {riichiOk.length > 0 && (
              <button
                className={`btn pop-in text-xl px-6 py-3 ${riichiMode ? "bg-white text-black" : "bg-dp-accent2 text-black"}`}
                onClick={() => {
                  SE.button();
                  setRiichiMode((v) => !v);
                }}
              >
                {riichiMode ? "立直をやめる" : "立直"}
              </button>
            )}
            {kyuushu && (
              <button className="btn pop-in bg-dp-panel2 text-dp-text px-4 py-3" onClick={() => act({ type: "kyuushu", seat: mySeat })}>
                九種九牌
              </button>
            )}
            {!rons.length && !canTsumo && !calls.length && !kanCount && !riichiOk.length && !kyuushu && (
              <span className="text-xs text-dp-muted">
                {riichiMode
                  ? "立直する牌を選んでください"
                  : me.mustDiscard
                    ? me.afterCall
                      ? "鳴いた後の1枚を捨ててください"
                      : "捨てる牌をタップ"
                    : k.wall.length === 0
                      ? "山がなくなりました。流局を待っています"
                      : "ツモ待ち"}
              </span>
            )}
          </div>
          {riichiMode && <p className="text-center text-xs text-dp-accent2">立直する牌を選んでください（光っていない牌は選べません）</p>}

          {/* 手牌 */}
          <div className="flex items-end justify-center pt-3 pb-1 overflow-x-auto">
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
            {me.drawn !== null && (
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
                className={opts![key] ? "chip-on" : "chip-off"}
                onClick={() => act({ type: "opts", seat: mySeat, opts: { [key]: !opts![key] } })}
              >
                {label} {opts![key] ? "ON" : "OFF"}
              </button>
            ))}
          </div>
        </div>
      )}

      {chooser && mySeat !== null && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-3" onClick={() => setChooser(null)}>
          <div className="card p-4 w-full max-w-sm flex flex-col gap-2" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-black">どれで鳴きますか？</h3>
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
