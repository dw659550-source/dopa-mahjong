import { NextResponse, type NextRequest } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { ACCESS_LOGS, type AccessLog } from "@/lib/accessLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 文字列を長さ制限つきで取り出す（おかしな値は空文字） */
function s(v: unknown, max: number): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function decode(v: string | null): string {
  if (!v) return "";
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

/**
 * 利用状況の把握・不正チェック用の接続記録。
 * IPアドレスはブラウザからは分からないため、ここ（サーバー）で受け取ったときの接続元を記録する。
 * 地域はVercelがIPから推定して付けるヘッダー（x-vercel-ip-*）を使う（推定なので外れることがある）。
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    const text = await req.text();
    if (text.length > 4000) return NextResponse.json({ ok: false }, { status: 413 });
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const h = req.headers;
  const fwd = h.get("x-forwarded-for") ?? "";
  const hintsIn = (body.hints && typeof body.hints === "object" ? body.hints : {}) as Record<string, unknown>;
  const log: AccessLog = {
    at: Date.now(),
    ip: fwd.split(",")[0].trim() || h.get("x-real-ip") || "unknown",
    forwardedFor: fwd.slice(0, 200),
    country: h.get("x-vercel-ip-country") ?? "",
    region: h.get("x-vercel-ip-country-region") ?? "",
    city: decode(h.get("x-vercel-ip-city")),
    postalCode: h.get("x-vercel-ip-postal-code") ?? "",
    ipTimezone: h.get("x-vercel-ip-timezone") ?? "",
    ipLatLng: [h.get("x-vercel-ip-latitude"), h.get("x-vercel-ip-longitude")].filter(Boolean).join(","),
    userAgent: (h.get("user-agent") ?? "").slice(0, 400),
    acceptLanguage: (h.get("accept-language") ?? "").slice(0, 100),
    playerId: s(body.playerId, 64),
    name: s(body.name, 32),
    page: s(body.page, 64),
    lang: s(body.lang, 32),
    langs: s(body.langs, 100),
    tz: s(body.tz, 64),
    screen: s(body.screen, 32),
    viewport: s(body.viewport, 32),
    pixelRatio: num(body.pixelRatio),
    colorDepth: num(body.colorDepth),
    touch: body.touch === true,
    cores: num(body.cores),
    memoryGb: num(body.memoryGb),
    conn: s(body.conn, 16),
    connEffective: s(body.connEffective, 16),
    downlinkMbps: num(body.downlinkMbps),
    rttMs: num(body.rttMs),
    saveData: typeof body.saveData === "boolean" ? body.saveData : null,
    referrer: s(body.referrer, 200),
    hints: {
      platform: s(hintsIn.platform, 32),
      platformVersion: s(hintsIn.platformVersion, 32),
      model: s(hintsIn.model, 64),
      mobile: hintsIn.mobile === true,
      architecture: s(hintsIn.architecture, 16),
      brands: s(hintsIn.fullVersions, 200) || s(hintsIn.brands, 200),
    },
  };
  if (!log.playerId) return NextResponse.json({ ok: false }, { status: 400 });
  try {
    await adminDb().collection(ACCESS_LOGS).add(log);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
