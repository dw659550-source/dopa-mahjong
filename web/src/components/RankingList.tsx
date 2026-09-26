"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { subscribeAllPlayerStats } from "@/lib/rooms";
import { combineByName, derive, fmtPoints, type PlayerStatsDoc } from "@/lib/statsModel";
import StatsDetail from "./StatsDetail";

type SortKey = "totalPoints" | "avgRank" | "avgPoints";

const SORT_LABEL: Record<SortKey, string> = {
  totalPoints: "通算得点",
  avgRank: "平均順位",
  avgPoints: "平均得点",
};

/**
 * ランキングの一覧（並べ替え・詳細表示つき）。ランキングページと待機室で使う。
 * highlightNames に含まれる名前は強調表示する（待機室の参加者など）。
 */
export default function RankingList({
  highlightNames = [],
  openHistoryInNewTab = false,
}: {
  highlightNames?: string[];
  /** 待機室では部屋から出ないよう、対局履歴を別タブで開く */
  openHistoryInNewTab?: boolean;
}) {
  const [sort, setSort] = useState<SortKey>("totalPoints");
  const [docs, setDocs] = useState<PlayerStatsDoc[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => subscribeAllPlayerStats(setDocs), []);

  const rows = useMemo(() => {
    if (!docs) return [];
    const list = combineByName(docs)
      .filter((d) => !d.excluded && d.games > 0)
      .map((d) => ({ d, x: derive(d) }));
    list.sort((a, b) => {
      if (sort === "totalPoints") return b.d.totalPoints - a.d.totalPoints;
      if (sort === "avgPoints") return b.x.avgPoints - a.x.avgPoints;
      return a.x.avgRank - b.x.avgRank || b.d.games - a.d.games;
    });
    return list;
  }, [docs, sort]);

  return (
    <div className="flex flex-col gap-2">
      <div className="card p-3 flex flex-col gap-2">
        <p className="text-xs text-dp-muted">東風戦・東南戦・一荘戦の合計です</p>
        <div className="flex gap-1.5 flex-wrap items-center">
          <span className="text-xs text-dp-muted mr-1">並べ替え</span>
          {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
            <button key={k} className={sort === k ? "chip-on" : "chip-off"} onClick={() => setSort(k)}>
              {SORT_LABEL[k]}
            </button>
          ))}
        </div>
      </div>

      {!docs && <p className="text-dp-muted text-sm text-center">読み込み中…</p>}
      {docs && rows.length === 0 && <p className="text-dp-muted text-sm text-center">まだ記録がありません。</p>}

      <ol className="flex flex-col gap-2">
        {rows.map(({ d, x }, i) => (
          <li key={d.name} className={`card p-3 ${highlightNames.includes(d.name) ? "border-dp-accent2/60" : ""}`}>
            <div className="flex items-center gap-3">
              <span className="w-7 text-center font-black text-dp-accent">{i + 1}</span>
              <span className="flex-1 min-w-0 font-bold truncate">
                {d.name}
                {highlightNames.includes(d.name) && <span className="ml-1.5 text-xs text-dp-accent2">参加中</span>}
              </span>
              <span className="text-right text-sm">
                <span className="block font-black">
                  {sort === "avgRank" ? x.avgRank.toFixed(2) : sort === "avgPoints" ? fmtPoints(x.avgPoints) : fmtPoints(d.totalPoints)}
                </span>
                <span className="block text-xs text-dp-muted">{d.games}戦</span>
              </span>
              <button
                className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-bold border ${
                  open === d.name ? "bg-dp-panel2 border-dp-muted/40 text-dp-text" : "border-dp-accent/60 text-dp-accent"
                }`}
                aria-expanded={open === d.name}
                onClick={() => setOpen(open === d.name ? null : d.name)}
              >
                {open === d.name ? "－閉じる" : "＋詳細"}
              </button>
            </div>
            {open === d.name && (
              <div className="mt-3 flex flex-col gap-2">
                <StatsDetail d={d} />
                <Link href={`/player?name=${encodeURIComponent(d.name)}`} className="btn-secondary text-center text-sm"
                  target={openHistoryInNewTab ? "_blank" : undefined}
                  rel={openHistoryInNewTab ? "noopener" : undefined}
                >
                  対局履歴・牌譜を見る ›
                </Link>
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
