import { NextResponse, type NextRequest } from "next/server";
import { CANONICAL_HOST, shouldRedirectHost } from "@/lib/canonicalHost";

// Vercelが自動で作るURL（アカウント名入りの *.vercel.app）で開かれたら、
// 決まったURL（CANONICAL_HOST）に切り替える。URLにアカウント名が出ないようにするため。
// 本番・プレビューを問わず切り替える（ローカル開発・独自ドメインでは何もしない）。
export function middleware(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  if (!shouldRedirectHost(host)) return NextResponse.next();
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
