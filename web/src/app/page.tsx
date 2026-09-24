"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DEFAULT_RULES, type Rules } from "@dopa/shared";
import { HowToPlayBasics, HowToPlayDetails } from "@/components/HowToPlay";
import RulesForm, { rulesText } from "@/components/RulesForm";
import { isFirebaseConfigured } from "@/lib/firebase";
import { getLastName, getOrCreatePlayerId, normalizeName, saveName } from "@/lib/identity";
import { createRoom, joinRoom, subscribePlayingRooms, type RoomDoc } from "@/lib/rooms";
import { syncClock } from "@/lib/clock";
import { SE, unlockAudio } from "@/lib/sounds";

export default function LobbyPage() {
  const router = useRouter();
  const configured = isFirebaseConfigured();
  const [name, setName] = useState("");
  const [cpuRules, setCpuRules] = useState<Rules>(DEFAULT_RULES);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<RoomDoc[] | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    setName(getLastName());
    if (configured) void syncClock(getOrCreatePlayerId());
  }, [configured]);

  useEffect(() => {
    if (!configured) return;
    return subscribePlayingRooms(setPlaying);
  }, [configured]);

  function requireName(): string | null {
    const n = normalizeName(name);
    if (!n) {
      setError("名前を入力してください（戦績は名前で記録されます）");
      SE.error();
      return null;
    }
    saveName(n);
    return n;
  }

  async function run(fn: () => Promise<void>) {
    unlockAudio();
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
      SE.error();
      setBusy(false);
    }
  }

  const startCpu = () =>
    run(async () => {
      const n = requireName();
      if (!n) return setBusy(false);
      const pid = getOrCreatePlayerId();
      await syncClock(pid);
      const c = await createRoom(pid, n, cpuRules, true);
      SE.button();
      router.push(`/room/${c}`);
    });

  const create = () =>
    run(async () => {
      const n = requireName();
      if (!n) return setBusy(false);
      const pid = getOrCreatePlayerId();
      const c = await createRoom(pid, n, { ...DEFAULT_RULES, cpuLevel: cpuRules.cpuLevel }, false);
      SE.button();
      router.push(`/room/${c}`);
    });

  const join = () =>
    run(async () => {
      const n = requireName();
      if (!n) return setBusy(false);
      const c = code.trim();
      if (!/^\d{5}$/.test(c)) throw new Error("ルームコード（5桁の数字）を入力してください");
      const r = await joinRoom(c, getOrCreatePlayerId(), n);
      if (!r.ok) throw new Error(r.error ?? "入室できませんでした");
      SE.button();
      router.push(r.spectator ? `/room/${c}?watch=1` : `/room/${c}`);
    });

  return (
    <main className="flex flex-col gap-4">
      <header className="text-center pt-2">
        <h1 className="text-4xl font-black tracking-wider">
          <span className="text-dp-accent">ドパ</span>麻雀
        </h1>
        <p className="text-dp-muted text-sm mt-1">手番のないリアルタイム麻雀</p>
      </header>

      {!configured && (
        <div className="card p-4 text-sm border-dp-bad/60">
          Firebaseの設定がありません。<code>web/.env.local</code> を作成してください（README参照）。
        </div>
      )}

      <section className="card p-4 flex flex-col gap-3">
        <label className="text-sm text-dp-muted" htmlFor="name">
          あなたの名前（戦績・ランキングは名前で記録されます）
        </label>
        <input
          id="name"
          className="input"
          value={name}
          maxLength={16}
          placeholder="例：たろう"
          onChange={(e) => setName(e.target.value)}
        />
        {error && <p className="text-dp-bad text-sm font-bold">{error}</p>}
      </section>

      <section className="card p-4 flex flex-col gap-3">
        <h2 className="text-lg font-black">遊び方</h2>
        <HowToPlayBasics />
        <button className="btn-secondary text-sm" onClick={() => setShowDetails((v) => !v)}>
          {showDetails ? "くわしいルールを閉じる" : "くわしいルールを見る"}
        </button>
        {showDetails && <HowToPlayDetails />}
      </section>

      <section className="card p-4 flex flex-col gap-3">
        <h2 className="text-lg font-black">CPU対戦</h2>
        <p className="text-sm text-dp-muted">あなた＋CPU3人ですぐに対局します。</p>
        <RulesForm rules={cpuRules} onChange={setCpuRules} />
        <button className="btn-primary text-lg" disabled={busy || !configured} onClick={startCpu}>
          CPU対戦をはじめる
        </button>
      </section>

      <section className="card p-4 flex flex-col gap-3">
        <h2 className="text-lg font-black">4人対戦</h2>
        <button className="btn-primary" disabled={busy || !configured} onClick={create}>
          ルームを作成する
        </button>
        <div className="flex gap-2">
          <input
            className="input"
            inputMode="numeric"
            placeholder="ルームコード（5桁）"
            value={code}
            maxLength={5}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          />
          <button className="btn-secondary whitespace-nowrap" disabled={busy || !configured} onClick={join}>
            参加する
          </button>
        </div>
      </section>

      <section className="card p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-black">観戦できる対局</h2>
          <span className="text-xs text-dp-muted">{playing ? `${playing.length}件` : "読み込み中…"}</span>
        </div>
        {playing && playing.length === 0 && <p className="text-sm text-dp-muted">いま進行中の対局はありません。</p>}
        <ul className="flex flex-col gap-2">
          {playing?.map((r) => (
            <li key={r.code}>
              <Link
                href={`/room/${r.code}?watch=1`}
                className="block rounded-xl bg-dp-panel2 px-3 py-2 hover:bg-dp-panel2/70 active:scale-[0.99] transition"
              >
                <div className="flex items-center justify-between text-sm">
                  <span className="font-bold">
                    {r.summary?.label ?? "対局中"}
                    <span className="ml-2 text-xs text-dp-muted">
                      {r.isCpuGame ? "CPU戦" : "対人戦"}・{rulesText(r.rules)}
                    </span>
                  </span>
                  <span className="text-dp-accent text-xs">観戦する ›</span>
                </div>
                <div className="grid grid-cols-2 gap-x-3 text-xs text-dp-muted mt-1">
                  {r.summary?.names.map((n, i) => (
                    <span key={i} className="truncate">
                      {n}：{r.summary!.scores[i].toLocaleString()}
                    </span>
                  ))}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="card p-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-black">ランキング</h2>
          <p className="text-xs text-dp-muted">東風戦・東南戦を別々に集計しています</p>
        </div>
        <Link href="/ranking" className="btn-secondary">
          見る ›
        </Link>
      </section>
    </main>
  );
}
