const PLAYER_ID_KEY = "dopa_player_id";
const NAME_KEY = "dopa_name";

function randomId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/** ブラウザごとの固定ID（再入場の判定用）。戦績は名前で集計する。 */
export function getOrCreatePlayerId(): string {
  if (typeof window === "undefined") return "";
  try {
    let id = window.localStorage.getItem(PLAYER_ID_KEY);
    if (!id) {
      id = randomId();
      window.localStorage.setItem(PLAYER_ID_KEY, id);
    }
    return id;
  } catch {
    return randomId();
  }
}

export function getLastName(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveName(name: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(NAME_KEY, name.trim());
  } catch {
    // 保存できなくても続行
  }
}

/** 名前の正規化（前後の空白除去・全角スペースを半角に） */
export function normalizeName(name: string): string {
  return name.replace(/　/g, " ").trim().slice(0, 16);
}
