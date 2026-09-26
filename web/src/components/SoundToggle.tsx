"use client";

import { useEffect, useState } from "react";
import { isSoundMuted, onMuteChange, setSoundMuted, unlockAudio, SE } from "@/lib/sounds";

export default function SoundToggle() {
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    setMuted(isSoundMuted());
    const off = onMuteChange(setMuted);
    // スマホは操作をきっかけにしないと音・読み上げが鳴らない。タブを離れて戻ったときなどに
    // 音が止まっていることがあるので、最初の1回だけでなく操作のたびに準備し直す（軽い処理）
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      off();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  return (
    <button
      onClick={() => {
        const next = !muted;
        setSoundMuted(next);
        if (!next) SE.button();
      }}
      aria-label={muted ? "効果音をオンにする" : "効果音をオフにする"}
      title={muted ? "効果音：オフ" : "効果音：オン"}
      className="fixed bottom-3 right-3 z-40 w-11 h-11 rounded-full bg-dp-panel2 border border-dp-muted/30 text-lg shadow-lg flex items-center justify-center active:scale-95 transition"
    >
      {muted ? "🔇" : "🔊"}
    </button>
  );
}
