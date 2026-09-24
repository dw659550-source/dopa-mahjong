import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "./firebase";

// 端末の時計のずれを補正するため、Firestoreのサーバー時刻との差を測っておく。
// 打牌の制限時間・CPUの反応時間はこの補正後の時刻で判定する（全員で同じ基準にするため）。
let offset = 0;
let synced = false;

export function serverNow(): number {
  return Date.now() + offset;
}

export function isClockSynced(): boolean {
  return synced;
}

export async function syncClock(playerId: string): Promise<void> {
  try {
    const ref = doc(db, "dopa_clock", playerId || "anon");
    const t0 = Date.now();
    await setDoc(ref, { t: serverTimestamp() });
    const t1 = Date.now();
    const snap = await getDoc(ref);
    const server = snap.data()?.t?.toMillis?.();
    if (typeof server === "number") {
      offset = server - (t0 + t1) / 2;
      synced = true;
    }
  } catch {
    // 失敗しても端末時計で続行
  }
}
