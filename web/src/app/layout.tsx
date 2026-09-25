import type { Metadata, Viewport } from "next";
import "./globals.css";
import HelpButton from "@/components/HowToPlay";
import SoundToggle from "@/components/SoundToggle";
import CanonicalHostRedirect from "@/components/CanonicalHostRedirect";
import TileImagePreloader from "@/components/TileImagePreloader";

export const metadata: Metadata = {
  title: "ドパ麻雀",
  description: "手番のないリアルタイム麻雀。4人が同時にツモ・打牌し、鳴き・和了は早押しで決まる。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0d1f2d",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-screen bg-dp-bg text-dp-text">
        <CanonicalHostRedirect />
        <TileImagePreloader />
        <div className="mx-auto max-w-3xl min-h-screen px-2 sm:px-4 py-3 pb-20">{children}</div>
        <HelpButton />
        <SoundToggle />
      </body>
    </html>
  );
}
