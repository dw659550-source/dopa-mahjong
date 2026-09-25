"use client";

import Link from "next/link";
import type { GameState } from "@dopa/shared";
import { fmtPoints } from "@/lib/statsModel";

export default function FinalView({
  state,
  recorded,
  onBackToRoom,
}: {
  state: GameState;
  recorded: boolean;
  onBackToRoom?: () => void;
}) {
  const f = state.final!;
  return (
    <div className="card pop-in p-4 flex flex-col gap-3">
      <h2 className="text-3xl font-black text-center text-dp-accent">終局</h2>
      <table className="w-full">
        <thead>
          <tr className="text-xs text-dp-muted">
            <th className="text-left py-1">順位</th>
            <th className="text-left py-1">名前</th>
            <th className="text-right py-1">素点</th>
            <th className="text-right py-1">最終得点</th>
          </tr>
        </thead>
        <tbody>
          {f.players.map((p) => (
            <tr key={p.seat} className="border-b border-white/5">
              <td className="py-2 font-black text-xl">{p.rank}</td>
              <td className="py-2 font-bold">
                {p.name}
                {p.isCpu && <span className="text-xs text-dp-muted ml-1">CPU</span>}
              </td>
              <td className="py-2 text-right font-mono">{p.score.toLocaleString()}</td>
              <td className={`py-2 text-right font-mono font-bold ${p.points >= 0 ? "text-dp-accent2" : "text-dp-bad"}`}>
                {fmtPoints(p.points)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-dp-muted text-center">
        {recorded ? "この対局は戦績に記録されました。" : "戦績を記録しています…"}
      </p>
      <div className="flex gap-2 justify-center">
        {onBackToRoom && (
          <button className="btn-primary" onClick={onBackToRoom}>
            部屋に戻る
          </button>
        )}
        <Link href="/" className="btn-secondary">
          ロビーへ
        </Link>
        <Link href="/ranking" className="btn-secondary">
          ランキング
        </Link>
      </div>
    </div>
  );
}
