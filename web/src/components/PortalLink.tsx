"use client";

// ゲームのトップページ(一覧)へ戻るリンク。全画面の最上部に置く
const PORTAL_URL = "https://vip-game-top.vercel.app";

export default function PortalLink() {
  return (
    <nav className="mx-auto max-w-3xl px-2 sm:px-4 pt-2 text-sm">
      <a
        href={PORTAL_URL}
        className="text-dp-muted hover:underline"
        onClick={(e) => {
          if (!window.confirm("ゲームTOPへ移動しますか?\n遊んでいる途中なら、このゲームから離れることになります。")) {
            e.preventDefault();
          }
        }}
      >
        ← ゲームTOPへ
      </a>
    </nav>
  );
}
