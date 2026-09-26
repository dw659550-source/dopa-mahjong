"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DEFAULT_RULES, type Rules } from "@dopa/shared";
import { HowToPlayBasics, HowToPlayDetails } from "@/components/HowToPlay";
import RulesForm, { rulesText } from "@/components/RulesForm";
import { isFirebaseConfigured } from "@/lib/firebase";
import { getLastName, getOrCreatePlayerId, normalizeName, saveName } from "@/lib/identity";
import { createRoom, joinRoom, subscribePlayingRooms, subscribeWaitingRooms, type RoomDoc } from "@/lib/rooms";
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
  const [waiting, setWaiting] = useState<RoomDoc[] | null>(null);
  const [roomsKey, setRoomsKey] = useState(0);
  const [showDetails, setShowDetails] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setName(getLastName());
    if (configured) void syncClock(getOrCreatePlayerId());
  }, [configured]);

  useEffect(() => {
    if (!configured) return;
    setPlaying(null);
    return subscribePlayingRooms(setPlaying);
  }, [configured, roomsKey]);

  useEffect(() => {
    if (!configured) return;
    setWaiting(null);
    return subscribeWaitingRooms(setWaiting);
  }, [configured, roomsKey]);

  function requireName(): string | null {
    const n = normalizeName(name);
    if (!n) {
      setError("名前を入力してください（戦績は名前で記録されます）");
      SE.error();
      nameRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      nameRef.current?.focus();
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
      console.error(e);
      setError(describeError(e));
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

  const join = (target?: string) =>
    run(async () => {
      const n = requireName();
      if (!n) return setBusy(false);
      const c = (target ?? code).trim();
      if (!/^\d{5}$/.test(c)) throw new Error("ルームコード（5桁の数字）を入力してください");
      const r = await joinRoom(c, getOrCreatePlayerId(), n);
      if (!r.ok) throw new Error(r.error ?? "入室できませんでした");
      SE.button();
      router.push(r.spectator ? `/room/${c}?watch=1` : `/room/${c}`);
    });

  return (
    <main className="flex flex-col gap-4">
      {error && (
        <div
          role="alert"
          className="fixed top-3 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-24px)] max-w-md rounded-xl bg-dp-bad text-white px-4 py-3 text-sm font-bold shadow-lg flex items-start gap-3"
        >
          <span className="flex-1 break-words">{error}</span>
          <button aria-label="閉じる" onClick={() => setError(null)} className="shrink-0">
            ✕
          </button>
        </div>
      )}

      <nav className="flex justify-end gap-2 -mb-2">
        <Link
          href={normalizeName(name) ? `/player?name=${encodeURIComponent(normalizeName(name))}` : "/player"}
          className="rounded-full border border-dp-accent/60 px-3 py-1 text-xs font-bold text-dp-accent"
        >
          マイページ
        </Link>
        <Link href="/ranking" className="rounded-full border border-dp-accent/60 px-3 py-1 text-xs font-bold text-dp-accent">
          ランキング
        </Link>
      </nav>

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
          ref={nameRef}
          className="input"
          value={name}
          maxLength={16}
          placeholder="例：たろう"
          onChange={(e) => setName(e.target.value)}
        />
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
          <button className="btn-secondary whitespace-nowrap" disabled={busy || !configured} onClick={() => join()}>
            参加する
          </button>
        </div>
      </section>

      <section className="card p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-black">参加者募集中の部屋</h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-dp-muted">{waiting ? `${waiting.length}件` : "読み込み中…"}</span>
            <button
              className="btn-secondary text-xs !px-3 !py-1.5"
              onClick={() => {
                SE.button();
                setRoomsKey((k) => k + 1);
              }}
            >
              再読み込み
            </button>
          </div>
        </div>
        {waiting && waiting.length === 0 && (
          <p className="text-sm text-dp-muted">いま募集中の部屋はありません。「ルームを作成する」から部屋を立てられます。</p>
        )}
        <ul className="flex flex-col gap-2">
          {waiting?.map((r) => {
            const filled = r.seats.filter((x) => x !== null).length;
            const host = r.seats.find((x) => x && x.playerId === r.hostId);
            const full = filled >= 4;
            return (
              <li key={r.code} className="rounded-xl bg-dp-panel2 px-3 py-2 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold truncate">
                    ルーム {r.code}
                    {host && <span className="ml-2 text-xs text-dp-muted">ホスト：{host.name}</span>}
                  </div>
                  <div className="text-xs text-dp-muted truncate">
                    {filled}/4人・{rulesText(r.rules)}
                  </div>
                  <div className="text-xs text-dp-muted truncate">
                    {r.seats
                      .filter((x) => x !== null)
                      .map((x) => (x!.isCpu ? `${x!.name}` : x!.name))
                      .join("、")}
                  </div>
                </div>
                <button
                  className={full ? "btn-secondary text-sm whitespace-nowrap" : "btn-primary text-sm whitespace-nowrap"}
                  disabled={busy || !configured}
                  onClick={() => join(r.code)}
                >
                  {full ? "満席（観戦）" : "参加する"}
                </button>
              </li>
            );
          })}
        </ul>
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
          <p className="text-xs text-dp-muted">東風戦・東南戦を合計して集計しています</p>
        </div>
        <Link href="/ranking" className="btn-secondary">
          見る ›
        </Link>
      </section>

      <section className="card p-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-black">マイページ</h2>
          <p className="text-xs text-dp-muted">成績・対局履歴・牌譜（各局の終わった時点の盤面）</p>
        </div>
        <Link href={normalizeName(name) ? `/player?name=${encodeURIComponent(normalizeName(name))}` : "/player"} className="btn-secondary">
          見る ›
        </Link>
      </section>
    </main>
  );
}

/** 画面に出すエラー文。Firestoreのエラーは原因がわかるよう補足する */
function describeError(e: unknown): string {
  const code = typeof e === "object" && e && "code" in e ? String((e as { code: unknown }).code) : "";
  const msg = e instanceof Error ? e.message : "エラーが発生しました";
  if (code === "permission-denied") {
    return "データベースへの書き込みが拒否されました。Firestoreのルールが公開されているか確認してください。";
  }
  if (code === "unavailable" || code === "deadline-exceeded") {
    return "データベースに接続できませんでした。通信状況を確認して、もう一度お試しください。";
  }
  return code ? `${msg}（${code}）` : msg;
}
