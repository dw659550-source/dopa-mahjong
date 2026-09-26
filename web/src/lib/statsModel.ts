// 戦績データの形と計算（ブラウザ・管理画面サーバーの両方で使う）
import type { GameLength, KifuRecord } from "@dopa/shared";

export interface YakumanRecord {
  yaku: string;
  at: number;
  matchId: string;
}

export interface PlayerStatsDoc {
  name: string;
  mode: GameLength;
  games: number;
  rankSum: number;
  rank1: number;
  rank2: number;
  rank3: number;
  rank4: number;
  totalPoints: number;
  kyokus: number;
  wins: number;
  dealins: number;
  calls: number;
  riichis: number;
  tobi: number;
  yakuman: YakumanRecord[];
  excluded: boolean;
  updatedAt: number;
}

/** 1対局ぶんの、1人の成績 */
export interface MatchPlayerRecord {
  name: string;
  isCpu: boolean;
  rank: number;
  score: number;
  points: number;
  kyokus: number;
  wins: number;
  dealins: number;
  calls: number;
  riichis: number;
  tobi: boolean;
  yakuman: string[];
}

export interface MatchDoc {
  id: string;
  mode: GameLength;
  roomCode: string;
  startedAt: number;
  endedAt: number;
  excluded: boolean;
  /** CPU対戦（あなた＋CPU3人）。ランキングには含めない */
  cpuGame?: boolean;
  players: MatchPlayerRecord[];
}

/**
 * 牌譜（1局ぶんの終局時の盤面）。対局の記録と同じ dopa_matches に保存する
 * （Firestoreのルールを貼り替えずに済むように）。endedAt・excluded を持たないので、
 * 対局一覧（endedAt順）やランキング除外の処理には含まれない。
 */
export interface KifuDoc {
  kind: "kifu";
  /** 対局ID（MatchDoc.id） */
  kifuOf: string;
  serial: number;
  mode: GameLength;
  aka: boolean;
  /**
   * KifuRecord をJSON文字列にしたもの。
   * Firestoreは「配列の中の配列」を保存できないため、そのままでは書き込めない。
   */
  json: string;
}

/** 牌譜を画面で使う形にしたもの */
export interface KifuView extends KifuRecord {
  aka: boolean;
}

export function parseKifu(d: KifuDoc): KifuView {
  return { ...(JSON.parse(d.json) as KifuRecord), aka: d.aka };
}

export function kifuDocId(matchId: string, serial: number): string {
  return `${matchId}__k${String(serial).padStart(3, "0")}`;
}

export const EDITABLE_FIELDS = [
  "games",
  "rankSum",
  "rank1",
  "rank2",
  "rank3",
  "rank4",
  "totalPoints",
  "kyokus",
  "wins",
  "dealins",
  "calls",
  "riichis",
  "tobi",
] as const;

export type EditableField = (typeof EDITABLE_FIELDS)[number];

export const FIELD_LABELS: Record<EditableField, string> = {
  games: "対戦数",
  rankSum: "順位合計",
  rank1: "1位回数",
  rank2: "2位回数",
  rank3: "3位回数",
  rank4: "4位回数",
  totalPoints: "通算得点",
  kyokus: "局数",
  wins: "和了回数",
  dealins: "放銃回数",
  calls: "副露した局数",
  riichis: "立直した局数",
  tobi: "飛び回数",
};

export function playerDocId(mode: GameLength, name: string): string {
  return `${mode}__${encodeURIComponent(name)}`;
}

export function aliasDocId(name: string): string {
  return encodeURIComponent(name);
}

export function emptyStats(name: string, mode: GameLength): PlayerStatsDoc {
  return {
    name,
    mode,
    games: 0,
    rankSum: 0,
    rank1: 0,
    rank2: 0,
    rank3: 0,
    rank4: 0,
    totalPoints: 0,
    kyokus: 0,
    wins: 0,
    dealins: 0,
    calls: 0,
    riichis: 0,
    tobi: 0,
    yakuman: [],
    excluded: false,
    updatedAt: 0,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** 対局1回ぶんの成績を加算（sign=-1で取り消し） */
export function applyMatchPlayer(
  doc: PlayerStatsDoc,
  p: MatchPlayerRecord,
  matchId: string,
  endedAt: number,
  sign: 1 | -1,
): PlayerStatsDoc {
  const d = { ...doc, yakuman: doc.yakuman.slice() };
  d.games += sign;
  d.rankSum += sign * p.rank;
  if (p.rank === 1) d.rank1 += sign;
  if (p.rank === 2) d.rank2 += sign;
  if (p.rank === 3) d.rank3 += sign;
  if (p.rank === 4) d.rank4 += sign;
  d.totalPoints = round1(d.totalPoints + sign * p.points);
  d.kyokus += sign * p.kyokus;
  d.wins += sign * p.wins;
  d.dealins += sign * p.dealins;
  d.calls += sign * p.calls;
  d.riichis += sign * p.riichis;
  d.tobi += sign * (p.tobi ? 1 : 0);
  if (sign === 1) {
    for (const y of p.yakuman) d.yakuman.push({ yaku: y, at: endedAt, matchId });
  } else {
    d.yakuman = d.yakuman.filter((y) => y.matchId !== matchId);
  }
  d.updatedAt = Date.now();
  return d;
}

export function mergeStats(into: PlayerStatsDoc, from: PlayerStatsDoc): PlayerStatsDoc {
  const d = { ...into, yakuman: [...into.yakuman, ...from.yakuman] };
  for (const f of EDITABLE_FIELDS) d[f] = f === "totalPoints" ? round1(d[f] + from[f]) : d[f] + from[f];
  d.updatedAt = Date.now();
  return d;
}

export interface DerivedStats {
  avgRank: number;
  rankRates: number[];
  avgPoints: number;
  winRate: number;
  dealinRate: number;
  callRate: number;
  riichiRate: number;
  tobiRate: number;
}

export function derive(d: PlayerStatsDoc): DerivedStats {
  const g = Math.max(1, d.games);
  const k = Math.max(1, d.kyokus);
  return {
    avgRank: d.games ? d.rankSum / d.games : 0,
    rankRates: [d.rank1, d.rank2, d.rank3, d.rank4].map((x) => x / g),
    avgPoints: d.games ? d.totalPoints / d.games : 0,
    winRate: d.wins / k,
    dealinRate: d.dealins / k,
    callRate: d.calls / k,
    riichiRate: d.riichis / k,
    tobiRate: d.tobi / g,
  };
}

export function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

export function fmtPoints(x: number): string {
  const v = Math.round(x * 10) / 10;
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
}

/**
 * 東風戦・東南戦の戦績を名前ごとに合計する。
 * どちらかでランキング除外されている名前は、合計のランキングからも除外する。
 */
export function combineByName(docs: PlayerStatsDoc[]): PlayerStatsDoc[] {
  const byName = new Map<string, PlayerStatsDoc>();
  for (const d of docs) {
    const cur = byName.get(d.name);
    if (!cur) {
      byName.set(d.name, { ...d, yakuman: d.yakuman.slice() });
      continue;
    }
    const merged = mergeStats(cur, d);
    merged.excluded = cur.excluded || d.excluded;
    byName.set(d.name, merged);
  }
  return [...byName.values()];
}
