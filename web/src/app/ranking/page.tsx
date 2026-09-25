"use client";

import Link from "next/link";
import RankingList from "@/components/RankingList";

export default function RankingPage() {
  return (
    <main className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-dp-muted text-sm">
          ‹ ロビー
        </Link>
        <h1 className="text-2xl font-black">ランキング</h1>
        <span className="w-12" />
      </div>
      <RankingList />
    </main>
  );
}
