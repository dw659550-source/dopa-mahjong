import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

function secret(): string {
  const pw = process.env.ADMIN_PASSWORD ?? "";
  if (!pw) throw new Error("ADMIN_PASSWORD が設定されていません");
  return `dopa-admin:${pw}`;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function checkPassword(input: string): boolean {
  const pw = process.env.ADMIN_PASSWORD ?? "";
  if (!pw) return false;
  // 長さの違いで時間差が出ないよう、ハッシュ同士で比較する
  const h = (s: string) => createHmac("sha256", "dopa-pw").update(s).digest("hex");
  return safeEqual(h(input), h(pw));
}

export function issueToken(): { token: string; expiresAt: number } {
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const payload = String(expiresAt);
  return { token: `${payload}.${sign(payload)}`, expiresAt };
}

export function verifyToken(token: string | null | undefined): boolean {
  if (!token) return false;
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return false;
  if (!safeEqual(sign(payload), mac)) return false;
  return Number(payload) > Date.now();
}
