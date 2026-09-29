import Link from "next/link";
import { CHANGELOG } from "@/lib/changelog";

export default function ChangelogPage() {
  return (
    <main className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-dp-muted text-sm">
          ‹ ロビー
        </Link>
        <h1 className="text-2xl font-black">更新履歴</h1>
        <span className="w-12" />
      </div>
      {CHANGELOG.map((e) => (
        <section key={e.date} className="card p-4 flex flex-col gap-2">
          <h2 className="font-black text-dp-accent">{e.date}</h2>
          <ul className="flex flex-col gap-1.5 text-sm">
            {e.items.map((it, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-dp-muted shrink-0">・</span>
                <span>{it}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
