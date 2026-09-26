import { NextResponse, type NextRequest } from "next/server";
import type { DocumentReference, Firestore, Transaction } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { checkPassword, issueToken, verifyToken } from "@/lib/adminAuth";
import { LOGS, appendLog, readChain, verifyAllLogs, writeLog, type AdminLogEntry, type LogContext } from "@/lib/adminLog";
import {
  EDITABLE_FIELDS,
  aliasDocId,
  applyMatchPlayer,
  emptyStats,
  mergeStats,
  playerDocId,
  type MatchDoc,
  type PlayerStatsDoc,
  ALL_STATS_MODES,
  type StatsMode,
} from "@/lib/statsModel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOMS = "dopa_rooms";
const PLAYERS = "dopa_players";
const MATCHES = "dopa_matches";
const ALIASES = "dopa_aliases";
const MODES = ALL_STATS_MODES;
type Mode = StatsMode;

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function ctxOf(req: NextRequest): LogContext {
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  return {
    ip: fwd.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown",
    userAgent: req.headers.get("user-agent") ?? "",
  };
}

function str(v: unknown, label: string): string {
  if (typeof v !== "string" || !v.trim()) throw new HttpError(400, `${label}が指定されていません`);
  return v.trim();
}

function mode(v: unknown): Mode {
  if (MODES.includes(v as Mode)) return v as Mode;
  throw new HttpError(400, "対局の種類が不正です");
}

async function resolveAlias(db: Firestore, tx: Transaction, name: string): Promise<string> {
  let cur = name;
  for (let i = 0; i < 5; i++) {
    const snap = await tx.get(db.collection(ALIASES).doc(aliasDocId(cur)));
    if (!snap.exists) return cur;
    const to = (snap.data() as { to: string }).to;
    if (!to || to === cur) return cur;
    cur = to;
  }
  return cur;
}

/** ログと変更を同じトランザクションで書き込む */
async function mutate<T>(
  db: Firestore,
  ctx: LogContext,
  action: string,
  body: (tx: Transaction) => Promise<{ summary: string; detail: unknown; writes: (tx: Transaction) => void; result?: T }>,
): Promise<T | undefined> {
  return db.runTransaction(async (tx) => {
    const r = await body(tx);
    const chain = await readChain(db, tx);
    r.writes(tx);
    writeLog(db, tx, chain, ctx, action, r.summary, r.detail);
    return r.result;
  });
}

type Handler = (db: Firestore, ctx: LogContext, p: Record<string, unknown>) => Promise<unknown>;

const handlers: Record<string, Handler> = {
  // ---------------------------------------------------------------- 閲覧
  async listRooms(db) {
    const snap = await db.collection(ROOMS).where("status", "in", ["waiting", "playing"]).get();
    return snap.docs
      .map((d) => {
        const r = d.data();
        return {
          code: r.code,
          status: r.status,
          isCpuGame: r.isCpuGame,
          rules: r.rules,
          summary: r.summary ?? null,
          seats: (r.gameSeats ?? r.seats ?? []).map((s: { name: string; isCpu: boolean } | null) => (s ? { name: s.name, isCpu: s.isCpu } : null)),
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        };
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },

  async listMatches(db, _ctx, p) {
    const lim = Math.min(200, Math.max(1, Number(p.limit ?? 100)));
    const snap = await db.collection(MATCHES).orderBy("endedAt", "desc").limit(lim).get();
    return snap.docs.map((d) => d.data() as MatchDoc);
  },

  async listPlayers(db, _ctx, p) {
    const m = mode(p.mode);
    const snap = await db.collection(PLAYERS).where("mode", "==", m).get();
    return snap.docs.map((d) => d.data() as PlayerStatsDoc).sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
  },

  async listAliases(db) {
    const snap = await db.collection(ALIASES).get();
    return snap.docs.map((d) => d.data());
  },

  async listLogs(db, _ctx, p) {
    const lim = Math.min(500, Math.max(1, Number(p.limit ?? 200)));
    let q = db.collection(LOGS).orderBy("seq", "desc").limit(lim);
    if (typeof p.beforeSeq === "number") q = q.where("seq", "<", p.beforeSeq);
    const snap = await q.get();
    return snap.docs.map((d) => d.data() as AdminLogEntry);
  },

  async verifyLogs(db) {
    return verifyAllLogs(db);
  },

  // ---------------------------------------------------------------- 対局・ルーム
  async forceEndRoom(db, ctx, p) {
    const code = str(p.code, "ルームコード");
    return mutate(db, ctx, "対局の強制終了", async (tx) => {
      const ref = db.collection(ROOMS).doc(code);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpError(404, "ルームが見つかりません");
      const r = snap.data()!;
      if (r.status === "ended" || r.status === "aborted") throw new HttpError(400, "すでに終了しています");
      return {
        summary: `ルーム${code}の対局を強制終了（戦績には記録しない）`,
        detail: { code, statusBefore: r.status, summary: r.summary ?? null, seats: r.gameSeats ?? r.seats },
        writes: (t) =>
          t.update(ref, { status: "aborted", abortedReason: "管理者により強制終了されました", updatedAt: Date.now() }),
      };
    });
  },

  async deleteRoom(db, ctx, p) {
    const code = str(p.code, "ルームコード");
    const ref = db.collection(ROOMS).doc(code);
    const presence = await ref.collection("presence").get();
    return mutate(db, ctx, "ルームの強制削除", async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpError(404, "ルームが見つかりません");
      const r = snap.data()!;
      return {
        summary: `ルーム${code}を削除`,
        detail: { code, status: r.status, summary: r.summary ?? null, seats: r.gameSeats ?? r.seats, recorded: r.recorded },
        writes: (t) => {
          for (const d of presence.docs) t.delete(d.ref);
          t.delete(ref);
        },
      };
    });
  },

  // ---------------------------------------------------------------- 戦績
  async setMatchExcluded(db, ctx, p) {
    const matchId = str(p.matchId, "対局ID");
    const excluded = p.excluded === true;
    return mutate(db, ctx, excluded ? "対局のランキング除外" : "対局のランキング除外を取り消し", async (tx) => {
      const ref = db.collection(MATCHES).doc(matchId);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpError(404, "対局が見つかりません");
      const m = snap.data() as MatchDoc;
      if (!!m.excluded === excluded) throw new HttpError(400, excluded ? "すでに除外されています" : "除外されていません");
      const updates: { ref: DocumentReference; doc: PlayerStatsDoc }[] = [];
      for (const pl of m.players) {
        if (pl.isCpu) continue;
        const name = await resolveAlias(db, tx, pl.name);
        const pref = db.collection(PLAYERS).doc(playerDocId(m.mode, name));
        const ps = await tx.get(pref);
        const cur = ps.exists ? (ps.data() as PlayerStatsDoc) : emptyStats(name, m.mode);
        updates.push({ ref: pref, doc: applyMatchPlayer(cur, { ...pl, name }, m.id, m.endedAt, excluded ? -1 : 1) });
      }
      return {
        summary: `対局${matchId}を${excluded ? "ランキングから除外" : "ランキングに戻す"}`,
        detail: { matchId, players: m.players.map((x) => ({ name: x.name, rank: x.rank, points: x.points })) },
        writes: (t) => {
          t.update(ref, { excluded });
          for (const u of updates) t.set(u.ref, u.doc);
        },
      };
    });
  },

  /** これまでに記録されたCPU対戦（人間1人＋CPU3人）を、まとめてランキングから除外する */
  async excludeCpuMatches(db, ctx) {
    const snap = await db.collection(MATCHES).where("excluded", "==", false).get();
    const targets: string[] = [];
    for (const d of snap.docs) {
      const m = d.data() as MatchDoc;
      if (m.players.filter((x) => x.isCpu).length !== 3) continue;
      // 対人戦の空席をCPUで埋めた対局は対象外（ルームがCPU対戦として作られたものだけ）
      const room = await db.collection(ROOMS).doc(m.roomCode).get();
      if (room.exists && room.data()?.isCpuGame === false && room.data()?.createdAt <= m.startedAt) continue;
      targets.push(m.id);
    }
    for (const id of targets) {
      await handlers.setMatchExcluded(db, ctx, { matchId: id, excluded: true });
      await db.collection(MATCHES).doc(id).update({ cpuGame: true });
    }
    await appendLog(db, ctx, "CPU対戦の一括除外", `CPU対戦 ${targets.length}件をランキングから除外`, { matchIds: targets });
    return { count: targets.length };
  },

  async setPlayerExcluded(db, ctx, p) {
    const m = mode(p.mode);
    const name = str(p.name, "名前");
    const excluded = p.excluded === true;
    return mutate(db, ctx, excluded ? "プレイヤーのランキング除外" : "プレイヤーのランキング除外を取り消し", async (tx) => {
      const ref = db.collection(PLAYERS).doc(playerDocId(m, name));
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpError(404, "プレイヤーが見つかりません");
      return {
        summary: `${name}（${m === "tonpu" ? "東風" : "東南"}）を${excluded ? "ランキングから除外" : "ランキングに戻す"}`,
        detail: { mode: m, name, excluded },
        writes: (t) => t.update(ref, { excluded, updatedAt: Date.now() }),
      };
    });
  },

  async editPlayer(db, ctx, p) {
    const m = mode(p.mode);
    const name = str(p.name, "名前");
    const fields = (p.fields ?? {}) as Record<string, unknown>;
    const patch: Record<string, number> = {};
    for (const f of EDITABLE_FIELDS) {
      if (fields[f] === undefined) continue;
      const v = Number(fields[f]);
      if (!Number.isFinite(v)) throw new HttpError(400, `${f} の値が不正です`);
      patch[f] = f === "totalPoints" ? Math.round(v * 10) / 10 : Math.round(v);
    }
    if (Object.keys(patch).length === 0) throw new HttpError(400, "変更する項目がありません");
    return mutate(db, ctx, "戦績の修正", async (tx) => {
      const ref = db.collection(PLAYERS).doc(playerDocId(m, name));
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpError(404, "プレイヤーが見つかりません");
      const before = snap.data() as PlayerStatsDoc;
      const changed: Record<string, { before: number; after: number }> = {};
      for (const [k, v] of Object.entries(patch)) {
        const b = before[k as keyof PlayerStatsDoc] as number;
        if (b !== v) changed[k] = { before: b, after: v };
      }
      if (Object.keys(changed).length === 0) throw new HttpError(400, "値が変わっていません");
      return {
        summary: `${name}（${m === "tonpu" ? "東風" : "東南"}）の戦績を修正：${Object.keys(changed).join(", ")}`,
        detail: { mode: m, name, changed },
        writes: (t) => t.update(ref, { ...patch, updatedAt: Date.now() }),
      };
    });
  },

  async resetPlayer(db, ctx, p) {
    const m = mode(p.mode);
    const name = str(p.name, "名前");
    return mutate(db, ctx, "戦績のリセット", async (tx) => {
      const ref = db.collection(PLAYERS).doc(playerDocId(m, name));
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpError(404, "プレイヤーが見つかりません");
      const before = snap.data() as PlayerStatsDoc;
      const reset = { ...emptyStats(name, m), excluded: before.excluded, updatedAt: Date.now() };
      return {
        summary: `${name}（${m === "tonpu" ? "東風" : "東南"}）の戦績をリセット`,
        detail: { mode: m, name, before },
        writes: (t) => t.set(ref, reset),
      };
    });
  },

  async mergePlayers(db, ctx, p) {
    const from = str(p.from, "統合元の名前");
    const toInput = str(p.to, "統合先の名前");
    if (from === toInput) throw new HttpError(400, "同じ名前です");
    return mutate(db, ctx, "プレイヤーの統合", async (tx) => {
      const to = await resolveAlias(db, tx, toInput);
      if (to === from) throw new HttpError(400, "統合先がすでに統合元に統合されています");
      const docs: Record<string, { fromSnap: PlayerStatsDoc | null; toSnap: PlayerStatsDoc | null }> = {};
      for (const m of MODES) {
        const fs = await tx.get(db.collection(PLAYERS).doc(playerDocId(m, from)));
        const ts = await tx.get(db.collection(PLAYERS).doc(playerDocId(m, to)));
        docs[m] = {
          fromSnap: fs.exists ? (fs.data() as PlayerStatsDoc) : null,
          toSnap: ts.exists ? (ts.data() as PlayerStatsDoc) : null,
        };
      }
      if (MODES.every((m) => !docs[m].fromSnap)) throw new HttpError(404, `「${from}」の戦績が見つかりません`);
      return {
        summary: `「${from}」の戦績を「${to}」に統合（以後「${from}」の対局は「${to}」として記録）`,
        detail: { from, to, before: docs },
        writes: (t) => {
          for (const m of MODES) {
            const { fromSnap, toSnap } = docs[m];
            if (!fromSnap) continue;
            const merged = mergeStats(toSnap ?? emptyStats(to, m), fromSnap);
            merged.name = to;
            merged.mode = m;
            t.set(db.collection(PLAYERS).doc(playerDocId(m, to)), merged);
            t.delete(db.collection(PLAYERS).doc(playerDocId(m, from)));
          }
          t.set(db.collection(ALIASES).doc(aliasDocId(from)), { from, to, at: Date.now() });
        },
      };
    });
  },
};

export async function POST(req: NextRequest) {
  const ctx = ctxOf(req);
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "リクエストが不正です" }, { status: 400 });
  }
  const op = String(body.op ?? "");
  try {
    const db = adminDb();
    if (op === "login") {
      const ok = checkPassword(String(body.password ?? ""));
      await appendLog(db, ctx, ok ? "ログイン" : "ログイン失敗", ok ? "管理画面にログイン" : "パスワードが違います", null);
      if (!ok) return NextResponse.json({ error: "パスワードが違います" }, { status: 401 });
      return NextResponse.json(issueToken());
    }
    if (!verifyToken(req.headers.get("x-admin-token"))) {
      return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
    }
    if (op === "logout") {
      await appendLog(db, ctx, "ログアウト", "管理画面からログアウト", null);
      return NextResponse.json({ ok: true });
    }
    const h = handlers[op];
    if (!h) return NextResponse.json({ error: "不明な操作です" }, { status: 400 });
    const result = await h(db, ctx, (body.params ?? {}) as Record<string, unknown>);
    return NextResponse.json({ ok: true, result: result ?? null });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "サーバーエラー";
    // 失敗した変更操作も記録する（閲覧系は記録しない）
    if (handlers[op] && !READ_ONLY_OPS.has(op)) {
      try {
        await appendLog(adminDb(), ctx, "操作失敗", `${op} が失敗：${msg}`, { op, params: body.params ?? null });
      } catch {
        // ログの書き込み自体に失敗した場合は、元のエラーを返す
      }
    }
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

const READ_ONLY_OPS = new Set(["listRooms", "listMatches", "listPlayers", "listAliases", "listLogs", "verifyLogs"]);
