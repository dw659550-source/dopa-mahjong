"use client";

import { useState } from "react";
import type { CpuLevel, Rules } from "@dopa/shared";
import RulesForm, { CPU_LEVEL_LABEL, rulesText } from "./RulesForm";
import RankingList from "./RankingList";
import { fillCpu, leaveWaitingRoom, setSeatCpu, startGame, updateRules, type PresenceDoc, type RoomDoc } from "@/lib/rooms";
import { serverNow } from "@/lib/clock";
import { SE } from "@/lib/sounds";
import { fmtPoints } from "@/lib/statsModel";
import { STALE_MS } from "@/lib/rooms";

export default function WaitingRoom({
  room,
  playerId,
  presence,
  onLeft,
}: {
  room: RoomDoc;
  playerId: string;
  presence: Record<string, PresenceDoc>;
  onLeft: () => void;
}) {
  const isHost = room.hostId === playerId;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cpuLevel, setCpuLevel] = useState<CpuLevel>(room.rules.cpuLevel);
  const [showRanking, setShowRanking] = useState(false);

  async function run(fn: () => Promise<string | null | void>) {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      if (typeof r === "string") {
        setError(r);
        SE.error();
      } else SE.button();
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
      SE.error();
    } finally {
      setBusy(false);
    }
  }

  const now = serverNow();
  const filled = room.seats.every((s) => s !== null);

  return (
    <div className="flex flex-col gap-3">
      <div className="card p-4 text-center">
        <p className="text-sm text-dp-muted">ルームコード</p>
        <p className="text-5xl font-black tracking-[0.3em] text-dp-accent">{room.code}</p>
        <p className="text-xs text-dp-muted mt-1">このコードを友だちに伝えて、ロビーの「参加する」から入ってもらってください</p>
      </div>

      {room.lastFinal && room.lastFinal.length > 0 && (
        <div className="card p-4 flex flex-col gap-2">
          <h2 className="font-black">前回の結果</h2>
          <table className="w-full text-sm">
            <tbody>
              {room.lastFinal.map((p) => (
                <tr key={p.name} className="border-b border-white/5">
                  <td className="py-1 w-8 font-black">{p.rank}位</td>
                  <td className="py-1 font-bold truncate">
                    {p.name}
                    {p.isCpu && <span className="text-xs text-dp-muted ml-1">CPU</span>}
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

      <div className="card p-4 flex flex-col gap-2">
        <h2 className="font-black">席</h2>
        {room.seats.map((s, i) => {
          const online = s && !s.isCpu && s.playerId ? now - (presence[s.playerId]?.lastSeenAt ?? 0) < STALE_MS : false;
          return (
            <div key={i} className="flex items-center gap-2 rounded-xl bg-dp-panel2 px-3 py-2">
              <span className="w-6 text-dp-muted text-sm">{i + 1}</span>
              {s ? (
                <>
                  <span className="font-bold flex-1 truncate">
                    {s.name}
                    {s.playerId === room.hostId && <span className="ml-2 text-xs text-dp-accent">ホスト</span>}
                    {s.playerId === playerId && <span className="ml-2 text-xs text-dp-accent2">あなた</span>}
                  </span>
                  {s.isCpu ? (
                    <>
                      <span className="text-xs text-dp-muted">CPU（{CPU_LEVEL_LABEL[s.cpuLevel]}）</span>
                      {isHost && (
                        <button className="text-xs text-dp-bad" disabled={busy} onClick={() => run(() => setSeatCpu(room.code, playerId, i, null))}>
                          外す
                        </button>
                      )}
                    </>
                  ) : (
                    <span className={`text-xs ${online ? "text-dp-accent2" : "text-dp-muted"}`}>{online ? "接続中" : "未接続"}</span>
                  )}
                </>
              ) : (
                <>
                  <span className="flex-1 text-dp-muted text-sm">空席</span>
                  {isHost && (
                    <button className="chip-off" disabled={busy} onClick={() => run(() => setSeatCpu(room.code, playerId, i, cpuLevel))}>
                      CPUを入れる
                    </button>
                  )}
                </>
              )}
            </div>
          );
        })}
        {isHost && (
          <div className="flex items-center gap-2 flex-wrap mt-1">
            <span className="text-xs text-dp-muted">補充するCPUの強さ</span>
            {(["weak", "normal", "strong"] as const).map((l) => (
              <button key={l} className={cpuLevel === l ? "chip-on" : "chip-off"} onClick={() => setCpuLevel(l)}>
                {CPU_LEVEL_LABEL[l]}
              </button>
            ))}
            <button className="chip-off ml-auto" disabled={busy || filled} onClick={() => run(() => fillCpu(room.code, playerId, cpuLevel))}>
              空席をすべてCPUで埋める
            </button>
          </div>
        )}
      </div>

      <div className="card p-4 flex flex-col gap-2">
        <h2 className="font-black">ルール</h2>
        {isHost ? (
          <RulesForm
            rules={room.rules}
            showCpu={false}
            disabled={busy}
            onChange={(r: Rules) => run(() => updateRules(room.code, playerId, r))}
          />
        ) : (
          <p className="text-sm">{rulesText(room.rules)}（ホストが設定します）</p>
        )}
      </div>

      <div className="card p-4 flex flex-col gap-2">
        <button className="flex items-center justify-between w-full" onClick={() => setShowRanking((v) => !v)} aria-expanded={showRanking}>
          <h2 className="font-black">ランキング</h2>
          <span className="text-sm font-bold text-dp-accent">{showRanking ? "－閉じる" : "＋見る"}</span>
        </button>
        {showRanking && (
          <RankingList highlightNames={room.seats.filter((x) => x && !x.isCpu).map((x) => x!.name)} />
        )}
      </div>

      {error && <p className="text-dp-bad text-sm font-bold text-center">{error}</p>}

      <div className="flex gap-2">
        <button
          className="btn-secondary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await leaveWaitingRoom(room.code, playerId);
              onLeft();
            })
          }
        >
          退出
        </button>
        {isHost ? (
          <button className="btn-primary flex-1 text-lg" disabled={busy || !filled} onClick={() => run(() => startGame(room.code, playerId))}>
            {filled ? "対局開始" : "4人そろうと開始できます"}
          </button>
        ) : (
          <p className="flex-1 text-center text-sm text-dp-muted self-center">ホストが開始するのを待っています…</p>
        )}
      </div>
    </div>
  );
}
