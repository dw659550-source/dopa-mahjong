"use client";

import { Fragment } from "react";
import { derive, fmtPoints, pct, type PlayerStatsDoc } from "@/lib/statsModel";

/** 1人ぶんの戦績の詳細（ランキングの「＋詳細」と戦績ページで使う） */
export default function StatsDetail({ d }: { d: PlayerStatsDoc }) {
  const x = derive(d);
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
      <Stat label="対戦数" v={`${d.games}戦`} />
      <Stat label="局数" v={`${d.kyokus}局`} />
      <Stat label="通算得点" v={fmtPoints(d.totalPoints)} />
      <Stat label="平均得点" v={fmtPoints(x.avgPoints)} />
      <Stat label="平均順位" v={x.avgRank.toFixed(2)} />
      <span />
      {[d.rank1, d.rank2, d.rank3, d.rank4].map((n, j) => (
        <Fragment key={j}>
          <Stat label={`${j + 1}位率`} v={pct(x.rankRates[j])} />
          <Stat label={`${j + 1}位回数`} v={`${n}回`} />
        </Fragment>
      ))}
      <Stat label="和了率" v={pct(x.winRate)} />
      <Stat label="和了回数" v={`${d.wins}回`} />
      <Stat label="放銃率" v={pct(x.dealinRate)} />
      <Stat label="放銃回数" v={`${d.dealins}回`} />
      <Stat label="副露率" v={pct(x.callRate)} />
      <Stat label="副露した局数" v={`${d.calls}局`} />
      <Stat label="立直率" v={pct(x.riichiRate)} />
      <Stat label="立直した局数" v={`${d.riichis}局`} />
      <Stat label="飛び率" v={pct(x.tobiRate)} />
      <Stat label="飛び回数" v={`${d.tobi}回`} />
      <div className="col-span-full mt-1">
        <span className="text-dp-muted">役満の和了記録：</span>
        {d.yakuman.length === 0 ? (
          <span>なし</span>
        ) : (
          <ul className="mt-1 flex flex-col gap-0.5">
            {d.yakuman.map((y, j) => (
              <li key={j} className="text-dp-accent">
                {y.yaku}
                <span className="text-dp-muted text-xs ml-2">{new Date(y.at).toLocaleString("ja-JP")}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Stat({ label, v }: { label: string; v: string }) {
  return (
    <div className="flex justify-between border-b border-white/5 py-0.5">
      <span className="text-dp-muted">{label}</span>
      <span className="font-bold">{v}</span>
    </div>
  );
}
