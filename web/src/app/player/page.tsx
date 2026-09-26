"use client";

import Link from "next/link";
import { GAME_LENGTH_LABEL } from "@dopa/shared";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import StatsDetail from "@/components/StatsDetail";
import { HISTORY_PAGE, fetchMatchesPage, subscribeAllPlayerStats } from "@/lib/rooms";
import { getLastName, normalizeName } from "@/lib/identity";
import { combineByName, fmtPoints, type MatchDoc, type PlayerStatsDoc } from "@/lib/statsModel";


/** 1回の「読み込み」で最大何ページ（100件ずつ）さかのぼるか */
const MAX_PAGES_PER_LOAD = 5;
/** 1回の「読み込み」で、この件数見つかったら止める */
const TARGET_PER_LOAD = 30;

export default function PlayerPage() {
  return (
    <Suspense fallback={<p className="text-center text-dp-muted pt-10">読み込み中…</p>}>
      <PlayerInner />
    </Suspense>
  );
}

function PlayerInner() {
  const search = useSearchParams();
  const name = (search.get("name") ?? "").trim();
  // 自分の名前（この端末で最後に使った名前）なら「マイページ」と表示する
  const [isMine, setIsMine] = useState(!name);
  useEffect(() => setIsMine(!name || normalizeName(getLastName()) === name), [name]);
  return (
    <main className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-dp-muted text-sm">
          ‹ ロビー
        </Link>
        <h1 className="text-2xl font-black">{isMine ? "マイページ" : "戦績"}</h1>
        <Link href="/ranking" className="text-dp-muted text-sm">
          ランキング
        </Link>
      </div>
      {name ? <PlayerView key={name} name={name} /> : <NameForm />}
    </main>
  );
}

function NameForm() {
  const router = useRouter();
  const [value, setValue] = useState("");
  useEffect(() => setValue(getLastName()), []);
  const go = () => {
    const n = normalizeName(value);
    if (n) router.push(`/player?name=${encodeURIComponent(n)}`);
  };
  return (
    <div className="card p-4 flex flex-col gap-2">
      <label className="text-sm font-bold" htmlFor="pname">
        名前
      </label>
      <input
        id="pname"
        className="input"
        value={value}
        maxLength={16}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && go()}
      />
      <button className="btn-primary" onClick={go} disabled={!normalizeName(value)}>
        戦績を見る
      </button>
    </div>
  );
}

function PlayerView({ name }: { name: string }) {
  const [docs, setDocs] = useState<PlayerStatsDoc[] | null>(null);
  useEffect(() => subscribeAllPlayerStats(setDocs), []);
  const stats = useMemo(() => (docs ? combineByName(docs).find((d) => d.name === name) ?? null : null), [docs, name]);

  // 対局履歴（新しい順）。全対局を100件ずつ読み、この名前が参加したものだけ残す
  const [matches, setMatches] = useState<MatchDoc[]>([]);
  const [cursor, setCursor] = useState<number | undefined>(undefined);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      let cur = cursor;
      let found: MatchDoc[] = [];
      let end = false;
      for (let i = 0; i < MAX_PAGES_PER_LOAD; i++) {
        const page = await fetchMatchesPage(cur);
        found = found.concat(page.filter((m) => m.players.some((p) => !p.isCpu && p.name === name)));
        if (page.length < HISTORY_PAGE) {
          end = true;
          break;
        }
        cur = page[page.length - 1].endedAt;
        if (found.length >= TARGET_PER_LOAD) break;
      }
      setMatches((prev) => prev.concat(found));
      setCursor(cur);
      setDone(end);
    } catch (e) {
      setError(`読み込めませんでした（${e instanceof Error ? e.message : String(e)}）`);
    } finally {
      setLoading(false);
    }
  }, [cursor, name]);

  useEffect(() => {
    void load();
    // 初回だけ自動で読む
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div className="card p-4 flex flex-col gap-3">
        <h2 className="text-xl font-black break-all">{name}</h2>
        {!docs && <p className="text-dp-muted text-sm">読み込み中…</p>}
        {docs && !stats && <p className="text-dp-muted text-sm">ランキングの記録はまだありません（CPU対戦は記録に含まれません）。</p>}
        {stats && (
          <>
            <p className="text-xs text-dp-muted">
              東風戦・東南戦・一荘戦の合計（CPU対戦を除く）
              {stats.excluded && <span className="ml-2 text-dp-bad">※ランキング対象外</span>}
            </p>
            <StatsDetail d={stats} />
          </>
        )}
      </div>

      <Trends name={name} matches={matches} done={done} />

      <div className="card p-4 flex flex-col gap-2">
        <h2 className="font-black">対局履歴</h2>
        <p className="text-xs text-dp-muted">対局をタップすると、その対局の牌譜（各局の終わった時点の盤面）を見られます。</p>
        {matches.length === 0 && !loading && done && <p className="text-dp-muted text-sm">対局の記録が見つかりませんでした。</p>}
        <ul className="flex flex-col gap-1.5">
          {matches.map((m) => {
            const me = m.players.find((p) => !p.isCpu && p.name === name)!;
            return (
              <li key={m.id}>
                <Link href={`/match/${encodeURIComponent(m.id)}`} className="flex items-center gap-3 rounded-xl bg-black/20 px-3 py-2">
                  <span className="w-9 text-center font-black text-xl">{me.rank}位</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm">
                      {new Date(m.endedAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      <span className="ml-2 text-dp-muted">{GAME_LENGTH_LABEL[m.mode] ?? m.mode}</span>
                      {m.cpuGame && <span className="ml-2 text-xs text-dp-muted">CPU対戦</span>}
                      {m.excluded && !m.cpuGame && <span className="ml-2 text-xs text-dp-bad">除外</span>}
                    </span>
                    <span className="block text-xs text-dp-muted truncate">
                      {m.players
                        .filter((p) => p !== me)
                        .map((p) => p.name)
                        .join("・")}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className={`block font-mono font-bold ${me.points >= 0 ? "text-dp-accent2" : "text-dp-bad"}`}>
                      {fmtPoints(me.points)}
                    </span>
                    <span className="block text-xs text-dp-muted font-mono">{me.score.toLocaleString()}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
        {error && <p className="text-dp-bad text-sm font-bold">{error}</p>}
        {loading && <p className="text-dp-muted text-sm text-center">読み込み中…</p>}
        {!loading && !done && (
          <button className="btn-secondary" onClick={() => void load()}>
            さらに前の対局を読み込む
          </button>
        )}
      </div>
    </>
  );
}

/** 直近の成績と、対戦相手ごとの成績（読み込んだ対局の範囲で計算。CPU対戦・除外された対局は含めない） */
function Trends({ name, matches, done }: { name: string; matches: MatchDoc[]; done: boolean }) {
  const counted = useMemo(() => matches.filter((m) => !m.cpuGame && !m.excluded), [matches]);
  const recent = counted.slice(0, 10);
  const rivals = useMemo(() => {
    const map = new Map<string, { name: string; games: number; above: number; myRankSum: number }>();
    for (const m of counted) {
      const me = m.players.find((p) => !p.isCpu && p.name === name);
      if (!me) continue;
      for (const o of m.players) {
        if (o === me || o.isCpu) continue;
        const r = map.get(o.name) ?? { name: o.name, games: 0, above: 0, myRankSum: 0 };
        r.games++;
        if (me.rank < o.rank) r.above++;
        r.myRankSum += me.rank;
        map.set(o.name, r);
      }
    }
    return [...map.values()].sort((a, b) => b.games - a.games).slice(0, 10);
  }, [counted, name]);

  if (counted.length === 0) return null;
  const mine = recent.map((m) => m.players.find((p) => !p.isCpu && p.name === name)!);
  const avgRank = mine.reduce((a, p) => a + p.rank, 0) / mine.length;
  const avgPts = mine.reduce((a, p) => a + p.points, 0) / mine.length;
  const RANK_COLOR = ["bg-dp-accent text-black", "bg-dp-accent2 text-black", "bg-white/20", "bg-dp-bad text-white"];

  return (
    <div className="card p-4 flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <h2 className="font-black">直近{recent.length}戦</h2>
        <div className="flex gap-1 flex-wrap" aria-label="直近の順位（左が新しい）">
          {mine.map((p, i) => (
            <span key={i} className={`w-7 h-7 rounded-md flex items-center justify-center font-black text-sm ${RANK_COLOR[p.rank - 1]}`}>
              {p.rank}
            </span>
          ))}
        </div>
        <p className="text-xs text-dp-muted">左が新しい対局です</p>
        <div className="grid grid-cols-2 gap-x-4 text-sm">
          <div className="flex justify-between border-b border-white/5 py-0.5">
            <span className="text-dp-muted">平均順位</span>
            <span className="font-bold">{avgRank.toFixed(2)}</span>
          </div>
          <div className="flex justify-between border-b border-white/5 py-0.5">
            <span className="text-dp-muted">平均得点</span>
            <span className="font-bold">{fmtPoints(avgPts)}</span>
          </div>
        </div>
      </div>

      {rivals.length > 0 && (
        <div className="flex flex-col gap-1">
          <h2 className="font-black">対戦相手別</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-dp-muted">
                <th className="text-left font-normal py-1">相手</th>
                <th className="text-right font-normal py-1">同卓</th>
                <th className="text-right font-normal py-1">相手より上</th>
                <th className="text-right font-normal py-1">自分の平均順位</th>
              </tr>
            </thead>
            <tbody>
              {rivals.map((r) => (
                <tr key={r.name} className="border-b border-white/5">
                  <td className="py-1 font-bold truncate max-w-[7rem]">
                    <Link href={`/player?name=${encodeURIComponent(r.name)}`}>{r.name}</Link>
                  </td>
                  <td className="py-1 text-right">{r.games}回</td>
                  <td className="py-1 text-right">
                    {r.above}回<span className="text-xs text-dp-muted ml-1">({Math.round((r.above / r.games) * 100)}%)</span>
                  </td>
                  <td className="py-1 text-right">{(r.myRankSum / r.games).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-dp-muted">
        CPU対戦・ランキング除外の対局を除き、{done ? "記録されているすべての対局" : "下の履歴に読み込んだ対局"}から計算しています。
      </p>
    </div>
  );
}
