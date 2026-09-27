// 接続記録を送る（利用状況の把握・不正チェック用。利用者の同意は運営側で取得済み）。
// 同じ端末・同じ名前では1日1回まで。
// 位置情報（GPS）など、ブラウザの許可画面が出る情報は取らない。
const KEY = "dopa_visit_day";

interface UAData {
  platform?: string;
  mobile?: boolean;
  brands?: { brand: string; version: string }[];
  getHighEntropyValues?: (hints: string[]) => Promise<Record<string, unknown>>;
}

type Nav = Navigator & {
  connection?: { effectiveType?: string; type?: string; downlink?: number; rtt?: number; saveData?: boolean };
  deviceMemory?: number;
  userAgentData?: UAData;
};

/** Chrome系ブラウザが渡す端末の詳しい情報（許可画面は出ない。対応していないブラウザでは空） */
async function clientHints(nav: Nav): Promise<Record<string, unknown>> {
  const d = nav.userAgentData;
  if (!d) return {};
  const out: Record<string, unknown> = {
    platform: d.platform ?? "",
    mobile: !!d.mobile,
    brands: (d.brands ?? []).map((b) => `${b.brand} ${b.version}`).join(", "),
  };
  try {
    const hi = await d.getHighEntropyValues?.(["model", "platformVersion", "architecture", "fullVersionList"]);
    if (hi) {
      out.model = hi.model ?? "";
      out.platformVersion = hi.platformVersion ?? "";
      out.architecture = hi.architecture ?? "";
      const list = hi.fullVersionList as { brand: string; version: string }[] | undefined;
      if (list) out.fullVersions = list.map((b) => `${b.brand} ${b.version}`).join(", ");
    }
  } catch {
    // 取れなくても続行
  }
  return out;
}

export function reportVisit(page: string, playerId: string, name: string): void {
  if (typeof window === "undefined" || !playerId) return;
  // 1日（端末の日付）1回。その日のうちに名前を変えた場合は、もう1回記録する（不正チェックの手がかりになるため）
  const day = new Date().toLocaleDateString("ja-JP");
  try {
    const last = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as { day?: string; names?: string[] } | null;
    const names = last?.day === day ? last.names ?? [] : [];
    if (names.includes(name)) return;
    window.localStorage.setItem(KEY, JSON.stringify({ day, names: [...names, name] }));
  } catch {
    // 保存できない環境では毎回送る
  }
  void send(page, playerId, name);
}

async function send(page: string, playerId: string, name: string) {
  const nav = navigator as Nav;
  const c = nav.connection;
  const body = {
    playerId,
    name,
    page,
    lang: navigator.language,
    langs: (navigator.languages ?? []).join(","),
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "",
    screen: `${window.screen.width}x${window.screen.height}`,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    pixelRatio: window.devicePixelRatio,
    colorDepth: window.screen.colorDepth,
    touch: navigator.maxTouchPoints > 0,
    cores: navigator.hardwareConcurrency ?? null,
    memoryGb: nav.deviceMemory ?? null,
    conn: c?.type ?? "",
    connEffective: c?.effectiveType ?? "",
    downlinkMbps: c?.downlink ?? null,
    rttMs: c?.rtt ?? null,
    saveData: c?.saveData ?? null,
    referrer: document.referrer,
    hints: await clientHints(nav),
  };
  // 失敗しても遊ぶのには影響しないので、結果は見ない
  void fetch("/api/visit", { method: "POST", body: JSON.stringify(body), keepalive: true }).catch(() => undefined);
}
