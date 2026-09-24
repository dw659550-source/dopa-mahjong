import "server-only";
import { createHash } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";

// 管理ログ。追記のみで、削除・変更の機能は一切用意しない。
// Firestoreのルールでブラウザからの読み書きをすべて禁止し、サーバー（管理画面API）だけが追記する。
// 各ログは直前のログのハッシュを含む（ハッシュチェーン）ため、途中のログが消されたり書き換えられたりすると検出できる。

export const LOGS = "dopa_admin_logs";
const META = "dopa_admin_meta";
const CHAIN_DOC = "chain";

export interface AdminLogEntry {
  seq: number;
  at: number;
  action: string;
  summary: string;
  detail: unknown;
  ip: string;
  userAgent: string;
  prevHash: string;
  hash: string;
}

export interface LogContext {
  ip: string;
  userAgent: string;
}

export function hashEntry(e: Omit<AdminLogEntry, "hash">): string {
  const body = JSON.stringify([e.seq, e.at, e.action, e.summary, e.detail ?? null, e.ip, e.userAgent, e.prevHash]);
  return createHash("sha256").update(body).digest("hex");
}

export function logDocId(seq: number): string {
  return String(seq).padStart(10, "0");
}

/**
 * トランザクション内でログを1件追記する。
 * 注意: Firestoreのトランザクションは「読み取り→書き込み」の順なので、
 * 呼び出し側は先に readChain で読み取りを済ませておくこと。
 */
export async function readChain(db: Firestore, tx: Transaction): Promise<{ seq: number; lastHash: string }> {
  const snap = await tx.get(db.collection(META).doc(CHAIN_DOC));
  if (!snap.exists) return { seq: 0, lastHash: "GENESIS" };
  const d = snap.data() as { seq: number; lastHash: string };
  return { seq: d.seq, lastHash: d.lastHash };
}

export function writeLog(
  db: Firestore,
  tx: Transaction,
  chain: { seq: number; lastHash: string },
  ctx: LogContext,
  action: string,
  summary: string,
  detail: unknown,
): AdminLogEntry {
  const base = {
    seq: chain.seq + 1,
    at: Date.now(),
    action,
    summary,
    detail: detail === undefined ? null : JSON.parse(JSON.stringify(detail)),
    ip: ctx.ip,
    userAgent: ctx.userAgent.slice(0, 200),
    prevHash: chain.lastHash,
  };
  const entry: AdminLogEntry = { ...base, hash: hashEntry(base) };
  // create() は同じIDが既にあれば失敗する＝既存ログの上書きは起きない
  tx.create(db.collection(LOGS).doc(logDocId(entry.seq)), entry);
  tx.set(db.collection(META).doc(CHAIN_DOC), { seq: entry.seq, lastHash: entry.hash });
  return entry;
}

/** ログだけを追記する（他の変更を伴わない操作用） */
export async function appendLog(db: Firestore, ctx: LogContext, action: string, summary: string, detail: unknown) {
  await db.runTransaction(async (tx) => {
    const chain = await readChain(db, tx);
    writeLog(db, tx, chain, ctx, action, summary, detail);
  });
}

/** 全ログを先頭から検証する */
export async function verifyAllLogs(db: Firestore): Promise<{ ok: boolean; count: number; problem: string | null }> {
  const snap = await db.collection(LOGS).orderBy("seq").get();
  let prev = "GENESIS";
  let expectSeq = 1;
  for (const d of snap.docs) {
    const e = d.data() as AdminLogEntry;
    if (e.seq !== expectSeq) return { ok: false, count: snap.size, problem: `ログ#${expectSeq} が見つかりません（削除された可能性）` };
    if (e.prevHash !== prev) return { ok: false, count: snap.size, problem: `ログ#${e.seq} の前後関係が一致しません` };
    const { hash, ...rest } = e;
    if (hashEntry(rest) !== hash) return { ok: false, count: snap.size, problem: `ログ#${e.seq} の内容が書き換えられています` };
    prev = hash;
    expectSeq++;
  }
  const meta = await db.collection(META).doc(CHAIN_DOC).get();
  if (meta.exists) {
    const m = meta.data() as { seq: number; lastHash: string };
    if (m.seq !== expectSeq - 1 || m.lastHash !== prev) {
      return { ok: false, count: snap.size, problem: "最新のログが削除された可能性があります" };
    }
  }
  return { ok: true, count: snap.size, problem: null };
}
