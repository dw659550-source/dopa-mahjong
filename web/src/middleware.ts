import { NextResponse, type NextRequest } from "next/server";

// 本番では、Vercelが自動で作るURL（アカウント名入りの *.vercel.app）で開かれても、
// 決まったURL（CANONICAL_HOST）に切り替える。URLにアカウント名が出ないようにするため。
// プレビュー環境・ローカル開発では何もしない。
const CANONICAL_HOST = process.env.CANONICAL_HOST || "dopa-mahjong.vercel.app";

export function middleware(req: NextRequest) {
  if (process.env.VERCEL_ENV !== "production") return NextResponse.next();
  const host = (req.headers.get("host") ?? "").toLowerCase();
  if (!host || host === CANONICAL_HOST || !host.endsWith(".vercel.app")) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.protocol = "https";
  url.host = CANONICAL_HOST;
  url.port = "";
  return NextResponse.redirect(url, 308);
}

export const config = {
  // 管理画面のAPIはリダイレクトしない（POSTが失われないように）
  matcher: ["/((?!api/|_next/|favicon.ico).*)"],
};
