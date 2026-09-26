"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { rulesText } from "@/components/RulesForm";
import {
  EDITABLE_FIELDS,
  FIELD_LABELS,
  derive,
  fmtPoints,
  pct,
  type MatchDoc,
  type PlayerStatsDoc,
} from "@/lib/statsModel";
import { GAME_LENGTH_LABEL, type GameLength, type Rules } from "@dopa/shared";

const TOKEN_KEY = "dopa_admin_token";

interface RoomRow {
  code: string;
  status: string;
  isCpuGame: boolean;
  rules: Rules;
  summary: { label: string; names: string[]; scores: number[] } | null;
  seats: ({ name: string; isCpu: boolean } | null)[];
  updatedAt: number;
}

interface LogRow {
  seq: number;
  at: number;
  action: string;
  summary: string;
  detail: unknown;
  ip: string;
  hash: string;
}

type Tab = "rooms" | "matches" | "players" | "logs";

function useAdminApi(token: string | null, onUnauthorized: () => void) {
  return useCallback(
    async <T,>(op: string, params: Record<string, unknown> = {}): Promise<T> => {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-token": token ?? "" },
        body: JSON.stringify({ op, params }),
      });
      const json = (await res.json()) as { error?: string; result?: T };
      if (res.status === 401) onUnauthorized();
      if (!res.ok || json.error) throw new Error(json.error ?? `エラー (${res.status})`);
      return json.result as T;
    },
    [token, onUnauthorized],
  );
}

function fmtTime(t: number) {
  return new Date(t).toLocaleString("ja-JP");
}

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("rooms");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    try {
      setToken(window.sessionStorage.getItem(TOKEN_KEY));
    } catch {
      // 保存できない環境では毎回ログイン
    }
  }, []);

  const logoutLocal = useCallback(() => {
    setToken(null);
    try {
      window.sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      // 無視
    }
  }, []);

  const api = useAdminApi(token, logoutLocal);

  async function login() {
    setError(null);
    const res = await fetch("/api/admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: "login", password }),
    });
    const json = (await res.json()) as { token?: string; error?: string };
    if (!res.ok || !json.token) {
      setError(json.error ?? "ログインできませんでした");
      return;
    }
    setPassword("");
    setToken(json.token);
    try {
      window.sessionStorage.setItem(TOKEN_KEY, json.token);
    } catch {
      // 無視
    }
  }

  async function logout() {
    try {
      await api("logout");
    } catch {
      // 無視
    }
    logoutLocal();
  }

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 2500);
  };

  if (!token) {
    return (
      <main className="max-w-sm mx-auto pt-12 flex flex-col gap-3">
        <h1 className="text-2xl font-black text-center">管理画面</h1>
        <input
          className="input"
          type="password"
          placeholder="管理者パスワード"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void login()}
        />
        <button className="btn-primary" onClick={() => void login()}>
          ログイン
        </button>
        {error && <p className="text-dp-bad text-sm text-center">{error}</p>}
        <p className="text-xs text-dp-muted text-center">ログイン・操作の内容はすべて記録され、削除できません。</p>
        <Link href="/" className="text-center text-sm text-dp-muted">
          ‹ ロビーへ
        </Link>
      </main>
    );
  }

  return (
    <main className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black">管理画面</h1>
        <button className="btn-secondary text-sm" onClick={() => void logout()}>
          ログアウト
        </button>
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {(
          [
            ["rooms", "進行中の対局"],
            ["matches", "対局の記録"],
            ["players", "プレイヤー"],
            ["logs", "操作ログ"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} className={tab === k ? "chip-on" : "chip-off"} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {notice && <div className="rounded-xl bg-dp-accent2 text-black px-3 py-2 text-sm font-bold">{notice}</div>}
      {tab === "rooms" && <RoomsTab api={api} flash={flash} />}
      {tab === "matches" && <MatchesTab api={api} flash={flash} />}
      {tab === "players" && <PlayersTab api={api} flash={flash} />}
      {tab === "logs" && <LogsTab api={api} />}
    </main>
  );
}

type Api = <T>(op: string, params?: Record<string, unknown>) => Promise<T>;

function useLoader<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, error, reload: load };
}

async function confirmRun(msg: string, fn: () => Promise<unknown>, flash: (m: string) => void, done: () => void) {
  if (!window.confirm(msg)) return;
  try {
    await fn();
    flash("実行しました（操作ログに記録されました）");
  } catch (e) {
    window.alert(e instanceof Error ? e.message : "失敗しました");
  }
  done();
}

function RoomsTab({ api, flash }: { api: Api; flash: (m: string) => void }) {
  const { data, error, reload } = useLoader(() => api<RoomRow[]>("listRooms"), [api]);
  return (
    <div className="flex flex-col gap-2">
      <button className="btn-secondary self-start text-sm" onClick={() => void reload()}>
        再読み込み
      </button>
      {error && <p className="text-dp-bad text-sm">{error}</p>}
      {data && data.length === 0 && <p className="text-dp-muted text-sm">進行中・待機中のルームはありません。</p>}
      {data?.map((r) => (
        <div key={r.code} className="card p-3 flex flex-col gap-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-black">
              ルーム {r.code}
              <span className="ml-2 text-xs text-dp-muted">
                {r.status === "playing" ? "対局中" : "待機中"}・{r.isCpuGame ? "CPU戦" : "対人戦"}・{rulesText(r.rules)}
              </span>
            </span>
            <span className="text-xs text-dp-muted">{fmtTime(r.updatedAt)}</span>
          </div>
          <div>局：{r.summary?.label ?? "（開始前）"}</div>
          <div className="grid grid-cols-2 gap-x-3">
            {r.seats.map((s, i) => (
              <span key={i}>
                {s ? `${s.name}${s.isCpu ? "(CPU)" : ""}` : "空席"}
                {r.summary && `：${r.summary.scores[i].toLocaleString()}`}
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <Link href={`/room/${r.code}?watch=1`} className="btn-secondary text-xs" target="_blank">
              観戦
            </Link>
            {r.status === "playing" && (
              <button
                className="btn-danger text-xs"
                onClick={() =>
                  confirmRun(
                    `ルーム${r.code}の対局を強制終了します。この対局は戦績に記録されません。よろしいですか？`,
                    () => api("forceEndRoom", { code: r.code }),
                    flash,
                    () => void reload(),
                  )
                }
              >
                強制終了
              </button>
            )}
            <button
              className="btn-danger text-xs"
              onClick={() =>
                confirmRun(`ルーム${r.code}を削除します。よろしいですか？`, () => api("deleteRoom", { code: r.code }), flash, () => void reload())
              }
            >
              ルームを削除
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function MatchesTab({ api, flash }: { api: Api; flash: (m: string) => void }) {
  const { data, error, reload } = useLoader(() => api<MatchDoc[]>("listMatches", { limit: 100 }), [api]);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2 flex-wrap">
        <button className="btn-secondary text-sm" onClick={() => void reload()}>
          再読み込み
        </button>
        <button
          className="btn-danger text-sm"
          onClick={() =>
            confirmRun(
              "これまでに記録されたCPU対戦（あなた＋CPU3人）を、まとめてランキングから除外します。よろしいですか？",
              async () => {
                const r = await api<{ count: number }>("excludeCpuMatches");
                window.alert(`CPU対戦 ${r.count}件を除外しました`);
              },
              flash,
              () => void reload(),
            )
          }
        >
          CPU対戦の記録をまとめてランキングから除外
        </button>
      </div>
      <p className="text-xs text-dp-muted">新しいCPU対戦は、最初からランキングに含まれません。</p>
      {error && <p className="text-dp-bad text-sm">{error}</p>}
      {data && data.length === 0 && <p className="text-dp-muted text-sm">記録された対局はありません。</p>}
      {data?.map((m) => (
        <div key={m.id} className={`card p-3 flex flex-col gap-1 text-sm ${m.excluded ? "opacity-60" : ""}`}>
          <div className="flex items-center justify-between">
            <span className="font-bold">
              {GAME_LENGTH_LABEL[m.mode] ?? m.mode}・{fmtTime(m.endedAt)}
              {m.cpuGame && <span className="ml-2 text-xs text-dp-muted">CPU戦</span>}
              {m.excluded && <span className="ml-2 text-dp-bad">除外中</span>}
            </span>
            <span className="text-xs text-dp-muted">{m.id}</span>
          </div>
          <ol className="grid grid-cols-2 gap-x-3">
            {m.players.map((p) => (
              <li key={p.name}>
                {p.rank}位 {p.name}
                {p.isCpu && "(CPU)"} {fmtPoints(p.points)}
              </li>
            ))}
          </ol>
          <button
            className={`${m.excluded ? "btn-secondary" : "btn-danger"} text-xs self-start`}
            onClick={() =>
              confirmRun(
                m.excluded ? "この対局をランキングの集計に戻しますか？" : "この対局をランキングの集計から除外しますか？",
                () => api("setMatchExcluded", { matchId: m.id, excluded: !m.excluded }),
                flash,
                () => void reload(),
              )
            }
          >
            {m.excluded ? "除外を取り消す" : "ランキングから除外"}
          </button>
        </div>
      ))}
    </div>
  );
}

function PlayersTab({ api, flash }: { api: Api; flash: (m: string) => void }) {
  const [mode, setMode] = useState<GameLength>("tonpu");
  const { data, error, reload } = useLoader(() => api<PlayerStatsDoc[]>("listPlayers", { mode }), [api, mode]);
  const [editing, setEditing] = useState<PlayerStatsDoc | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [mergeFrom, setMergeFrom] = useState("");
  const [mergeTo, setMergeTo] = useState("");
  // 統合はすべての対局の種類に対して行うので、どれかに戦績がある名前をすべて候補にする
  const names = useLoader(async () => {
    const lists = await Promise.all(
      (["tonpu", "hanchan", "issou"] as const).map((m) => api<PlayerStatsDoc[]>("listPlayers", { mode: m })),
    );
    return Array.from(new Set(lists.flat().map((p) => p.name))).sort((x, y) => x.localeCompare(y, "ja"));
  }, [api]);
  const nameOptions = names.data ?? [];

  const startEdit = (p: PlayerStatsDoc) => {
    setEditing(p);
    setForm(Object.fromEntries(EDITABLE_FIELDS.map((f) => [f, String(p[f])])));
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1.5 items-center">
        {(["tonpu", "hanchan", "issou"] as const).map((m) => (
          <button key={m} className={mode === m ? "chip-on" : "chip-off"} onClick={() => setMode(m)}>
            {GAME_LENGTH_LABEL[m]}
          </button>
        ))}
        <button
          className="btn-secondary text-sm ml-auto"
          onClick={() => {
            void reload();
            void names.reload();
          }}
        >
          再読み込み
        </button>
      </div>

      <div className="card p-3 flex flex-col gap-2 text-sm">
        <h3 className="font-bold">2人分の戦績を統合（名前の表記ゆれ対策）</h3>
        <p className="text-xs text-dp-muted">
          統合元の戦績を統合先に足し合わせ、統合元の記録を消します（東風・東南の両方）。以後、統合元の名前で遊んだ対局は統合先として記録されます。
        </p>
        <div className="flex gap-2 items-center flex-wrap">
          <select className="input !w-44" value={mergeFrom} onChange={(e) => setMergeFrom(e.target.value)}>
            <option value="">統合元を選ぶ</option>
            {nameOptions.map((n) => (
              <option key={n} value={n} disabled={n === mergeTo}>
                {n}
              </option>
            ))}
          </select>
          <span>→</span>
          <select className="input !w-44" value={mergeTo} onChange={(e) => setMergeTo(e.target.value)}>
            <option value="">統合先を選ぶ</option>
            {nameOptions.map((n) => (
              <option key={n} value={n} disabled={n === mergeFrom}>
                {n}
              </option>
            ))}
          </select>
          <button
            className="btn-danger text-xs"
            disabled={!mergeFrom.trim() || !mergeTo.trim() || mergeFrom === mergeTo}
            onClick={() =>
              confirmRun(
                `「${mergeFrom.trim()}」の戦績を「${mergeTo.trim()}」に統合します。元に戻す機能はありません。よろしいですか？`,
                () => api("mergePlayers", { from: mergeFrom.trim(), to: mergeTo.trim() }),
                flash,
                () => {
                  setMergeFrom("");
                  setMergeTo("");
                  void reload();
                  void names.reload();
                },
              )
            }
          >
            統合する
          </button>
        </div>
      </div>

      {error && <p className="text-dp-bad text-sm">{error}</p>}
      {data && data.length === 0 && <p className="text-dp-muted text-sm">記録はありません。</p>}
      {data?.map((p) => {
        const x = derive(p);
        return (
          <div key={p.name} className={`card p-3 flex flex-col gap-1 text-sm ${p.excluded ? "opacity-60" : ""}`}>
            <div className="flex items-center justify-between">
              <span className="font-black">
                {p.name}
                {p.excluded && <span className="ml-2 text-dp-bad text-xs">ランキング除外中</span>}
              </span>
              <span className="text-xs text-dp-muted">{p.games}戦</span>
            </div>
            <div className="text-xs text-dp-muted">
              平均順位 {x.avgRank.toFixed(2)}・通算 {fmtPoints(p.totalPoints)}・和了率 {pct(x.winRate)}・放銃率 {pct(x.dealinRate)}
            </div>
            <div className="flex gap-2 flex-wrap mt-1">
              <button className="btn-secondary text-xs" onClick={() => startEdit(p)}>
                戦績を修正
              </button>
              <button
                className={`${p.excluded ? "btn-secondary" : "btn-danger"} text-xs`}
                onClick={() =>
                  confirmRun(
                    p.excluded ? `${p.name} をランキングに戻しますか？` : `${p.name} をランキングから除外しますか？`,
                    () => api("setPlayerExcluded", { mode, name: p.name, excluded: !p.excluded }),
                    flash,
                    () => void reload(),
                  )
                }
              >
                {p.excluded ? "除外を取り消す" : "ランキングから除外"}
              </button>
              <button
                className="btn-danger text-xs"
                onClick={() =>
                  confirmRun(
                    `${p.name}（${mode === "tonpu" ? "東風" : "東南"}）の戦績をリセットします。よろしいですか？`,
                    () => api("resetPlayer", { mode, name: p.name }),
                    flash,
                    () => void reload(),
                  )
                }
              >
                リセット
              </button>
            </div>
            {editing?.name === p.name && (
              <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
                {EDITABLE_FIELDS.map((f) => (
                  <label key={f} className="flex flex-col text-xs gap-0.5">
                    <span className="text-dp-muted">{FIELD_LABELS[f]}</span>
                    <input
                      className="input !py-1.5"
                      inputMode="decimal"
                      value={form[f] ?? ""}
                      onChange={(e) => setForm((v) => ({ ...v, [f]: e.target.value }))}
                    />
                  </label>
                ))}
                <div className="col-span-full flex gap-2">
                  <button
                    className="btn-primary text-sm"
                    onClick={() =>
                      confirmRun(
                        `${p.name} の戦績を保存しますか？`,
                        () => api("editPlayer", { mode, name: p.name, fields: form }),
                        flash,
                        () => {
                          setEditing(null);
                          void reload();
                        },
                      )
                    }
                  >
                    保存
                  </button>
                  <button className="btn-secondary text-sm" onClick={() => setEditing(null)}>
                    キャンセル
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function LogsTab({ api }: { api: Api }) {
  const { data, error, reload } = useLoader(() => api<LogRow[]>("listLogs", { limit: 300 }), [api]);
  const [verify, setVerify] = useState<{ ok: boolean; count: number; problem: string | null } | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-dp-muted">
        管理画面でのログイン・操作はすべてここに記録されます。ログを削除・変更する機能はありません（ブラウザからの書き込みもデータベースの設定で禁止しています）。
      </p>
      <div className="flex gap-2">
        <button className="btn-secondary text-sm" onClick={() => void reload()}>
          再読み込み
        </button>
        <button
          className="btn-secondary text-sm"
          onClick={async () => {
            try {
              setVerify(await api("verifyLogs"));
            } catch (e) {
              window.alert(e instanceof Error ? e.message : "検証に失敗しました");
            }
          }}
        >
          改ざんチェック
        </button>
      </div>
      {verify && (
        <p className={`text-sm font-bold ${verify.ok ? "text-dp-accent2" : "text-dp-bad"}`}>
          {verify.ok ? `全${verify.count}件のログに欠落・改ざんはありません` : `問題あり：${verify.problem}`}
        </p>
      )}
      {error && <p className="text-dp-bad text-sm">{error}</p>}
      <ul className="flex flex-col gap-1">
        {data?.map((l) => (
          <li key={l.seq} className="card px-3 py-2 text-sm">
            <button className="w-full text-left" onClick={() => setOpen(open === l.seq ? null : l.seq)}>
              <div className="flex gap-2 items-baseline">
                <span className="text-xs text-dp-muted w-10">#{l.seq}</span>
                <span className="text-xs text-dp-muted whitespace-nowrap">{fmtTime(l.at)}</span>
                <span className="font-bold">{l.action}</span>
              </div>
              <div className="pl-12 text-xs">{l.summary}</div>
            </button>
            {open === l.seq && (
              <pre className="mt-2 text-[11px] bg-black/30 rounded-lg p-2 overflow-x-auto whitespace-pre-wrap break-all">
                {JSON.stringify({ ip: l.ip, detail: l.detail, hash: l.hash }, null, 2)}
              </pre>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
