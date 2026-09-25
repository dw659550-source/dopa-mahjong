// 公開用のURL（ホスト名）。アカウント名入りの *.vercel.app で開かれたら、ここへ切り替える。
export const CANONICAL_HOST = (
  process.env.NEXT_PUBLIC_CANONICAL_HOST ||
  process.env.CANONICAL_HOST ||
  "dopa-mahjong.vercel.app"
).toLowerCase();

export function shouldRedirectHost(hostWithPort: string): boolean {
  const host = hostWithPort.toLowerCase().split(":")[0];
  return !!host && host !== CANONICAL_HOST && host.endsWith(".vercel.app");
}
