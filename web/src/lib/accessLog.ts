// 接続記録（利用状況の把握・不正チェック用）。書き込み・閲覧はサーバー（/api/visit・管理画面）のみ。
// Firestoreのルールでこのコレクションを許可していないので、ブラウザから直接は読み書きできない。

export const ACCESS_LOGS = "dopa_access_logs";

export interface AccessLog {
  at: number;
  ip: string;
  /** 経由したプロキシも含む接続元の一覧（x-forwarded-for） */
  forwardedFor: string;
  /** IPから推定した地域（Vercelが付けるヘッダー。推定なので外れることがある。付かない場合は空） */
  country: string;
  region: string;
  city: string;
  postalCode: string;
  ipTimezone: string;
  /** IPから推定したおおよその緯度経度（GPSではない） */
  ipLatLng: string;
  userAgent: string;
  acceptLanguage: string;
  playerId: string;
  name: string;
  /** どの画面で記録したか（lobby / room） */
  page: string;
  lang: string;
  langs: string;
  tz: string;
  screen: string;
  viewport: string;
  pixelRatio: number | null;
  colorDepth: number | null;
  touch: boolean;
  /** CPUのコア数・メモリ量の目安（ブラウザが丸めた値。対応ブラウザのみ） */
  cores: number | null;
  memoryGb: number | null;
  /** 通信の種類・速度の目安（対応ブラウザのみ） */
  conn: string;
  connEffective: string;
  downlinkMbps: number | null;
  rttMs: number | null;
  saveData: boolean | null;
  referrer: string;
  /** Chrome系ブラウザが渡す端末情報（機種名など。Safari・Firefoxでは空） */
  hints: {
    platform: string;
    platformVersion: string;
    model: string;
    mobile: boolean;
    architecture: string;
    brands: string;
  };
}

/** ブラウザ・OSのざっくりした名前（User-Agentから推定） */
export function describeUserAgent(ua: string): string {
  const os = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X/.test(ua)
          ? "Mac"
          : /Linux/.test(ua)
            ? "Linux"
            : "不明";
  const br = /Edg\//.test(ua)
    ? "Edge"
    : /CriOS|Chrome\//.test(ua)
      ? "Chrome"
      : /FxiOS|Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "不明";
  return `${os}・${br}`;
}
