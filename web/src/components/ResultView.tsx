"use client";

import { useEffect, useState } from "react";
import { kindOf, type GameState, type Tile as TileId, type WinDetail } from "@dopa/shared";
import Tile from "./Tile";
import { serverNow } from "@/lib/clock";

function sortTiles(t: TileId[]): TileId[] {
  return t.slice().sort((a, b) => kindOf(a) - kindOf(b) || a - b);
}

/** 和了の内訳（和了画面と牌譜で使う） */
export function WinBlock({ w, names, aka }: { w: WinDetail; names: string[]; aka: boolean }) {
  const concealed = sortTiles(w.hand.filter((t) => t !== w.winTile));
  const winnerName = names[w.seat];
  return (
    <div className="rounded-xl bg-black/25 p-3 flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-black text-lg">
          {winnerName}
          {w.fromSeat !== null && <span className="text-sm text-dp-muted ml-2">← {names[w.fromSeat]}</span>}
        </span>
        <span className="font-black text-dp-accent text-xl">{w.points.toLocaleString()}点</span>
      </div>
      <div className="flex flex-wrap items-end gap-[2px]">
        {concealed.map((t) => (
          <Tile key={t} tile={t} aka={aka} size="sm" />
        ))}
        <span className="w-2" />
        <Tile tile={w.winTile} aka={aka} size="sm" highlight="win" />
        {w.melds.map((m, i) => (
          <span key={i} className="flex gap-[1px] ml-2">
            {m.tiles.map((t, j) => (
              <Tile key={j} tile={m.type === "ankan" && (j === 0 || j === 3) ? null : t} aka={aka} size="sm" />
            ))}
          </span>
        ))}
      </div>
      <ul className="grid grid-cols-2 gap-x-4 text-sm">
        {w.yaku.map((y, i) => (
          <li key={i} className="flex justify-between border-b border-white/5 py-0.5">
            <span>{y.name}</span>
            <span className="text-dp-muted">{w.yakumanMult > 0 ? (y.han > 1 ? `${y.han}倍役満` : "役満") : `${y.han}飜`}</span>
          </li>
        ))}
      </ul>
      <p className="text-sm font-bold">
        {w.yakumanMult > 0 ? w.label : `${w.fu}符 ${w.han}飜${w.label ? `　${w.label}` : ""}`}
        {w.pao !== null && <span className="ml-2 text-dp-bad">包：{names[w.pao]}</span>}
      </p>
    </div>
  );
}

export default function ResultView({
  state,
  mySeat,
  onAck,
}: {
  state: GameState;
  mySeat: number | null;
  onAck: () => void;
}) {
  const r = state.result!;
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    const iv = setInterval(() => setNow(serverNow()), 250);
    return () => clearInterval(iv);
  }, []);
  const remain = Math.max(0, Math.ceil((state.resultUntil - now) / 1000));
  const acked = mySeat !== null && state.resultAck[mySeat];
  const aka = state.rules.aka;

  return (
    <div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-2 sm:p-4">
      <div className="card pop-in w-full max-w-xl max-h-[92vh] overflow-y-auto p-4 flex flex-col gap-3">
        <div className="text-center">
          <p className="text-xs text-dp-muted">{r.roundLabel}</p>
          <h2 className="text-3xl font-black text-dp-accent">{r.title}</h2>
        </div>

        {r.wins.map((w, i) => (
          <WinBlock key={i} w={w} names={state.seats.map((x) => x.name)} aka={aka} />
        ))}

        {r.kind !== "win" && (
          <div className="flex flex-col gap-2">
            {r.nagashi.length > 0 && (
              <p className="text-center font-bold">流し満貫：{r.nagashi.map((s) => state.seats[s].name).join("・")}</p>
            )}
            {r.kind === "ryukyoku" &&
              r.revealed.map((h, seat) =>
                h ? (
                  <div key={seat} className="rounded-xl bg-black/25 p-2">
                    <p className="text-sm font-bold mb-1">{state.seats[seat].name}（聴牌）</p>
                    <div className="flex flex-wrap gap-[2px]">
                      {sortTiles(h).map((t) => (
                        <Tile key={t} tile={t} aka={aka} size="sm" />
                      ))}
                    </div>
                  </div>
                ) : null,
              )}
            {r.kind === "ryukyoku" && r.revealed.every((h) => !h) && <p className="text-center text-dp-muted">全員ノーテン</p>}
            {r.kind === "abort" &&
              r.revealed.map((h, seat) =>
                h ? (
                  <div key={seat} className="flex flex-wrap gap-[2px] justify-center">
                    {sortTiles(h).map((t) => (
                      <Tile key={t} tile={t} aka={aka} size="sm" />
                    ))}
                  </div>
                ) : null,
              )}
          </div>
        )}

        <div className="flex items-center justify-center gap-3 text-sm">
          <span className="text-dp-muted">ドラ表示</span>
          {r.doraIndicators.map((t) => (
            <Tile key={t} tile={t} aka={aka} size="sm" />
          ))}
          {r.uraIndicators.length > 0 && (
            <>
              <span className="text-dp-muted ml-2">裏</span>
              {r.uraIndicators.map((t) => (
                <Tile key={t} tile={t} aka={aka} size="sm" />
              ))}
            </>
          )}
        </div>

        <table className="w-full text-sm">
          <tbody>
            {state.seats.map((s, i) => (
              <tr key={i} className="border-b border-white/5">
                <td className="py-1 font-bold">{s.name}</td>
                <td
                  className={`py-1 text-right font-mono ${
                    r.deltas[i] > 0 ? "text-dp-accent2" : r.deltas[i] < 0 ? "text-dp-bad" : "text-dp-muted"
                  }`}
                >
                  {r.deltas[i] > 0 ? "+" : ""}
                  {r.deltas[i].toLocaleString()}
                </td>
                <td className="py-1 text-right font-mono">{r.scoresAfter[i].toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {mySeat !== null ? (
          <button className="btn-primary" disabled={acked} onClick={onAck}>
            {acked ? `他の人を待っています…（${remain}）` : `OK（${remain}）`}
          </button>
        ) : (
          <p className="text-center text-xs text-dp-muted">次の局まで {remain} 秒</p>
        )}
      </div>
    </div>
  );
}
