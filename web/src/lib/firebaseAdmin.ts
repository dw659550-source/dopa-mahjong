import "server-only";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

let app: App | null = null;

function loadServiceAccount(): Record<string, string> {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? "";
  if (!raw.trim()) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON が設定されていません");
  const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  const json = JSON.parse(text) as Record<string, string>;
  if (json.private_key) json.private_key = json.private_key.replace(/\\n/g, "\n");
  return json;
}

export function adminDb(): Firestore {
  if (!app) {
    if (process.env.FIRESTORE_EMULATOR_HOST) {
      // ローカル開発用：エミュレータでは認証情報が不要
      app = getApps()[0] ?? initializeApp({ projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "demo-dopa" });
    } else {
      app = getApps()[0] ?? initializeApp({ credential: cert(loadServiceAccount() as never) });
    }
  }
  return getFirestore(app);
}
