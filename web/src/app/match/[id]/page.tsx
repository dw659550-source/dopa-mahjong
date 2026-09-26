"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { GAME_LENGTH_LABEL, kindOf, type Tile as TileId } from "@dopa/shared";
import Tile from "@/components/Tile";
import { Melds, NukiTiles } from "@/components/GameView";
import { WinBlock } from "@/components/ResultView";
import { fetchKifu, fetchMatch } from "@/lib/rooms";
import { fmtPoints, statsModeLabel, type KifuView, type MatchDoc } from "@/lib/statsModel";

const WIND = ["東", "南", "西", "北"];

function sortTiles(t: TileId[]): TileId[] {
  return t.slice().sort((a, b) => kindOf(a) - kindOf(b) || a - b);
}

export default function MatchPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id);
  const [match, setMatch] = useState<MatchDoc | null | undefined>(undefined);
  const [kifu, setKifu] = useState<KifuView[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    Promise.all([fetchMatch(id), fetchKifu(id)])
      .then(([m, k]) => {
        if (!alive) return;
        setMatch(m);
        setKifu(k);
      })
      .catch((e) => alive && setError(`読み込めませんでした（${e instanceof Error ? e.message : String(e)}）`));
    return () => {
      alive = false;
    };
  }, [id]);

  return (
    <main className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <button className="text-dp-muted text-sm" onClick={() => history.back()}>
          ‹ 戻る
        </button>
        <h1 className="text-2xl font-black">牌譜</h1>
        <Link href="/" className="text-dp-muted text-sm">
          ロビー
        </Link>
      </div>

      {error && <p className="text-dp-bad text-sm font-bold text-center">{error}</p>}
      {!error && match === undefined && <p className="text-dp-muted text-sm text-center">読み込み中…</p>}
      {match === null && kifu && kifu.length === 0 && <p className="text-dp-muted text-sm text-center">対局が見つかりません。</p>}

      {match && (
        <div className="card p-4 flex flex-col gap-2">
          <p className="text-sm">
            {new Date(match.endedAt).toLocaleString("ja-JP")}
            <span className="ml-2 text-dp-muted">{statsModeLabel(match.mode)}</span>
            {match.cpuGame && <span className="ml-2 text-xs text-dp-muted">CPU対戦</span>}
          </p>
          <table className="w-full text-sm">
            <tbody>
              {match.players.map((p) => (
                <tr key={p.name} className="border-b border-white/5">
                  <td className="py-1 w-10 font-black">{p.rank}位</td>
                  <td className="py-1 font-bold">
                    {p.isCpu ? (
                      <>
                        {p.name}
                        <span className="text-xs text-dp-muted ml-1">CPU</span>
                      </>
                    ) : (
                      <Link href={`/player?name=${encodeURIComponent(p.name)}`} className="underline decoration-white/20">
                        {p.name}
                      </Link>
                    )}
                  </td>
                  <td className="py-1 text-right font-mono">{p.score.toLocaleString()}</td>
                  <td className={`py-1 text-right font-mono font-bold ${p.points >= 0 ? "text-dp-accent2" : "text-dp-bad"}`}>
                    {fmtPoints(p.points)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {kifu && kifu.length === 0 && match && (
        <p className="text-dp-muted text-sm text-center">この対局の牌譜はありません（牌譜の記録を始める前の対局です）。</p>
      )}
      {kifu && kifu.length > 0 && (
        <p className="text-xs text-dp-muted">各局の終わった時点の盤面です。タップすると開きます。</p>
      )}
      {kifu?.map((k) => <KyokuCard key={k.serial} k={k} />)}
    </main>
  );
}

function KyokuCard({ k }: { k: KifuView }) {
  const [open, setOpen] = useState(false);
  const r = k.result;
  const summary =
    r.kind === "win"
      ? r.wins.map((w) => `${k.names[w.seat]} ${w.points.toLocaleString()}点`).join("・")
      : r.kind === "ryukyoku"
        ? r.tenpai.some((t) => t)
          ? `聴牌：${k.names.filter((_, i) => r.tenpai[i]).join("・")}`
          : "全員ノーテン"
        : "";
  return (
    <div className="card p-3 flex flex-col gap-3">
      <button className="flex items-center gap-3 text-left w-full" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="font-black w-24 shrink-0">{r.roundLabel}</span>
        <span className="flex-1 min-w-0">
          <span className="font-bold text-dp-accent">{r.title}</span>
          <span className="ml-2 text-sm text-dp-muted truncate">{summary}</span>
        </span>
        <span className="text-sm font-bold text-dp-accent shrink-0">{open ? "－" : "＋"}</span>
      </button>
      {open && <KyokuBoard k={k} />}
    </div>
  );
}

function KyokuBoard({ k }: { k: KifuView }) {
  const r = k.result;
  const aka = k.aka;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-dp-muted">ドラ表示</span>
        {r.doraIndicators.map((t) => (
          <Tile key={t} tile={t} aka={aka} size="xs" />
        ))}
        {r.uraIndicators.length > 0 && (
          <>
            <span className="text-dp-muted ml-2">裏</span>
            {r.uraIndicators.map((t) => (
              <Tile key={t} tile={t} aka={aka} size="xs" />
            ))}
          </>
        )}
      </div>

      {k.players.map((p, seat) => {
        const n = k.players.length;
        const wind = WIND[(seat - k.dealer + n) % n];
        const delta = r.deltas[seat];
        const concealed = sortTiles(p.drawn !== null ? p.hand.filter((t) => t !== p.drawn) : p.hand);
        return (
          <div key={seat} className="rounded-xl bg-black/25 p-2 flex flex-col gap-1.5">
            <div className="flex items-center gap-2 text-sm">
              <span className="w-6 h-6 rounded-md bg-dp-panel2 flex items-center justify-center font-black text-xs">{wind}</span>
              <span className="font-bold flex-1 min-w-0 truncate">
                {k.names[seat]}
                {p.riichi && <span className="ml-1.5 text-xs text-dp-accent">立直</span>}
              </span>
              <span className="font-mono text-xs text-dp-muted">{k.scoresBefore[seat].toLocaleString()}</span>
              <span className={`font-mono text-xs font-bold w-14 text-right ${delta > 0 ? "text-dp-accent2" : delta < 0 ? "text-dp-bad" : "text-dp-muted"}`}>
                {delta > 0 ? "+" : ""}
                {delta.toLocaleString()}
              </span>
            </div>
            <div className="flex flex-wrap items-end gap-[2px]">
              <span className="w-8 text-[10px] text-dp-muted self-center">手牌</span>
              {concealed.map((t) => (
                <Tile key={t} tile={t} aka={aka} size="xs" />
              ))}
              {p.drawn !== null && (
                <>
                  <span className="w-1.5" />
                  <Tile tile={p.drawn} aka={aka} size="xs" highlight="drawn" />
                </>
              )}
            </div>
            {(p.melds.length > 0 || (p.nuki ?? []).length > 0) && (
              <div className="flex items-center gap-1">
                <span className="w-8 text-[10px] text-dp-muted">副露</span>
                <NukiTiles tiles={p.nuki ?? []} aka={aka} size="xs" />
                <Melds melds={p.melds} seat={seat} aka={aka} n={n} />
              </div>
            )}
            <div className="flex flex-wrap gap-[2px] content-start rounded-lg bg-black/25 p-1">
              <span className="w-7 text-[10px] text-dp-muted self-center">河</span>
              {p.river.map((x, i) => (
                <Tile
                  key={i}
                  tile={x.tile}
                  aka={aka}
                  size="xs"
                  sideways={x.riichi}
                  highlight={x.calledBy !== null ? "dim" : null}
                />
              ))}
              {p.river.length === 0 && <span className="text-xs text-dp-muted">（捨て牌なし）</span>}
            </div>
          </div>
        );
      })}

      {r.wins.map((w, i) => (
        <WinBlock key={i} w={w} names={k.names} aka={aka} />
      ))}
      {r.nagashi.length > 0 && <p className="text-center font-bold text-sm">流し満貫：{r.nagashi.map((s) => k.names[s]).join("・")}</p>}
      <p className="text-xs text-dp-muted">河の暗い牌は鳴かれた牌、横向きは立直宣言牌です。</p>
    </div>
  );
}
