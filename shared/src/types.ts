import type { Kind, Tile } from "./tiles.ts";
import type { Meld, YakuItem } from "./yaku.ts";

export type CpuLevel = "weak" | "normal" | "strong";
export type GameLength = "tonpu" | "hanchan" | "issou";

/** 対局の長さの表示名 */
export const GAME_LENGTH_LABEL: Record<GameLength, string> = { tonpu: "東風戦", hanchan: "東南戦", issou: "一荘戦" };

/**
 * 対局の長さごとの場の数。rounds: 通常の場の数、extra: 延長戦で進める場の数
 * （東風戦は南場まで、東南戦は西場まで、一荘戦は延長なし）。
 */
export const GAME_LENGTH_ROUNDS: Record<GameLength, { rounds: number; extra: number }> = {
  tonpu: { rounds: 1, extra: 1 },
  hanchan: { rounds: 2, extra: 1 },
  issou: { rounds: 4, extra: 0 },
};

/** 局の通し番号（東1局=0）でのオーラスと延長戦の上限。1場の局数は人数と同じ */
export function roundLimits(length: GameLength, players: number): { last: number; limit: number } {
  const r = GAME_LENGTH_ROUNDS[length];
  return { last: r.rounds * players - 1, limit: (r.rounds + r.extra) * players - 1 };
}

export interface Rules {
  length: GameLength;
  /** 人数（三人麻雀は3）。古いデータには無い（=4） */
  players?: 3 | 4;
  kuitan: boolean;
  aka: boolean;
  cpuLevel: CpuLevel;
}

export const DEFAULT_RULES: Rules = {
  length: "tonpu",
  kuitan: true,
  aka: true,
  cpuLevel: "normal",
};

/** 打牌の制限時間 */
export const DISCARD_TIMEOUT_MS = 10_000;
/** 立直後・ツモ切りモード時の自動ツモ切りまでの時間 */
export const AUTO_TSUMOGIRI_MS = 1_000;
/** 山切れ後、全員の打牌が終わってから流局するまでの猶予 */
export const EXHAUST_GRACE_MS = 3_000;
/** 和了・流局画面の表示時間（全員がOKを押せば早く進む） */
export const RESULT_DISPLAY_MS = 12_000;

export const START_SCORE = 25_000;
export const RETURN_SCORE = 30_000;
export const UMA = [20, 10, -10, -20];

/** 人数ごとの持ち点・返し・ウマ（三人麻雀は天鳳の段位戦3人打ちと同じ 35000点持ち40000点返し、ウマ+20/0/-20） */
export function scoreRules(players: number): { start: number; ret: number; uma: number[] } {
  if (players === 3) return { start: 35_000, ret: 40_000, uma: [20, 0, -20] };
  return { start: START_SCORE, ret: RETURN_SCORE, uma: UMA };
}

export interface SeatInfo {
  name: string;
  isCpu: boolean;
  cpuLevel: CpuLevel;
}

export interface SeatOpts {
  autoHora: boolean;
  noCall: boolean;
  tsumogiri: boolean;
}

export interface RiverTile {
  tile: Tile;
  tsumogiri: boolean;
  riichi: boolean;
  calledBy: number | null;
  at: number;
  /** 河底撈魚の対象（その局の最後の打牌） */
  houtei: boolean;
  /** この牌を当たり牌としていて、まだ見逃しが確定していない席 */
  pendingMiss: number[];
}

export interface PlayerState {
  /** 純手牌（ツモ牌を含む） */
  hand: Tile[];
  /** 現在のツモ牌（なければ null） */
  drawn: Tile | null;
  melds: Meld[];
  river: RiverTile[];
  /** 打牌が必要な状態（3n+2枚） */
  mustDiscard: boolean;
  /** 鳴いた直後（ツモ牌なしで打牌待ち） */
  afterCall: boolean;
  /** 喰い替えで打牌できない牌種 */
  kuikae: Kind[];
  /** 現在の打牌待ちが始まった時刻 */
  phaseSince: number;
  riichi: 0 | 1 | 2;
  riichiRiverIndex: number;
  ippatsu: boolean;
  /** まだ第1打牌をしておらず、自分で鳴いてもいない */
  firstTurn: boolean;
  tempFuriten: boolean;
  riichiFuriten: boolean;
  /** 現在のツモ牌が嶺上牌 */
  rinshan: boolean;
  /** 現在のツモ牌が山の最後の1枚 */
  haitei: boolean;
  /** 打牌時（または次の嶺上ツモ直前）にめくるカンドラの枚数 */
  pendingKanDora: number;
  /** 槍槓の対象になっている加槓牌 */
  kakanTile: Tile | null;
  kakanPendingMiss: number[];
  /** 三人麻雀で抜いた北（古いデータには無い） */
  nuki?: Tile[];
  /** 直前に抜いた北（ロンの対象になっている間だけ） */
  nukiTile?: Tile | null;
  nukiPendingMiss?: number[];
  /** 包の責任者 */
  pao: { seat: number; yaku: string } | null;
  calledThisKyoku: boolean;
  riichiThisKyoku: boolean;
}

export interface PendingAbort {
  type: "suucha" | "suukaikan";
  seat: number;
  armed: boolean;
}

export interface KyokuState {
  wall: Tile[];
  rinshan: Tile[];
  doraIndicators: Tile[];
  uraIndicators: Tile[];
  doraRevealed: number;
  players: PlayerState[];
  kanCount: number;
  kanSeats: number[];
  firstDiscardKinds: (Kind | null)[];
  riichiCount: number;
  pendingAbort: PendingAbort | null;
  /** 山切れ後、全員の打牌が終わった時刻 */
  allDoneAt: number | null;
  /** CPUが鳴き判断済みの捨て牌（"cpu:from:index"） */
  cpuSeen: Record<string, boolean>;
  startedAt: number;
}

export interface WinDetail {
  seat: number;
  fromSeat: number | null; // ロンなら放銃者
  yaku: YakuItem[];
  han: number;
  fu: number;
  yakumanMult: number;
  label: string;
  points: number; // 和了者が受け取った合計（積み棒・供託を除く）
  hand: Tile[];
  melds: Meld[];
  winTile: Tile;
  pao: number | null;
}

export interface KyokuResult {
  kind: "win" | "ryukyoku" | "abort";
  title: string; // 例: ロン / ツモ / 流局 / 九種九牌
  roundLabel: string;
  wins: WinDetail[];
  deltas: number[];
  tenpai: boolean[];
  /** 公開する手牌（和了者・聴牌者など） */
  revealed: (Tile[] | null)[];
  doraIndicators: Tile[];
  uraIndicators: Tile[];
  nagashi: number[];
  scoresAfter: number[];
}

/** 牌譜（局が終わった時点の盤面） */
export interface KifuPlayer {
  hand: Tile[];
  drawn: Tile | null;
  melds: Meld[];
  river: { tile: Tile; tsumogiri: boolean; riichi: boolean; calledBy: number | null }[];
  riichi: boolean;
  /** 三人麻雀で抜いた北 */
  nuki?: Tile[];
}

export interface KifuRecord {
  /** 対局内の局の通し番号（1〜） */
  serial: number;
  roundLabel: string;
  dealer: number;
  names: string[];
  scoresBefore: number[];
  players: KifuPlayer[];
  result: KyokuResult;
}

export interface PlayerGameStats {
  kyokus: number;
  wins: number;
  dealins: number;
  calls: number;
  riichis: number;
  yakuman: string[];
}

export interface FinalPlayer {
  seat: number;
  name: string;
  isCpu: boolean;
  rank: number;
  score: number;
  points: number;
}

export interface FinalResult {
  players: FinalPlayer[]; // 順位順
  endedAt: number;
}

export type GameEventType =
  | "kyokuStart"
  | "discard"
  | "riichi"
  | "chi"
  | "pon"
  | "kan"
  | "nuki"
  | "ron"
  | "tsumo"
  | "ryukyoku"
  | "abort"
  | "gameEnd";

export interface GameEvent {
  id: number;
  type: GameEventType;
  seat: number | null;
  at: number;
}

export interface GameState {
  version: 1;
  rules: Rules;
  seats: SeatInfo[];
  connected: boolean[];
  opts: SeatOpts[];
  scores: number[];
  /** 0=東 1=南 2=西 3=北 */
  roundWind: number;
  /** 0〜3（親の席） */
  kyokuNum: number;
  honba: number;
  kyotaku: number;
  phase: "playing" | "result" | "ended";
  kyoku: KyokuState | null;
  result: KyokuResult | null;
  resultUntil: number;
  resultAck: boolean[];
  /** 次局の予定（result中のみ） */
  next: { end: boolean; roundWind: number; kyokuNum: number; honba: number } | null;
  final: FinalResult | null;
  stats: PlayerGameStats[];
  seed: number;
  kyokuSerial: number;
  /** 直前に終わった局の牌譜（古い保存データには無い） */
  lastKifu?: KifuRecord | null;
  events: GameEvent[];
  eventSeq: number;
  startedAt: number;
}

export type RonTarget =
  | { type: "discard"; from: number; index: number }
  | { type: "kakan"; from: number }
  /** 三人麻雀の北抜きで抜かれた北 */
  | { type: "nuki"; from: number };

export type Action =
  | { type: "discard"; seat: number; tile: Tile; riichi?: boolean }
  | { type: "tsumo"; seat: number }
  | { type: "ron"; seat: number; target: RonTarget }
  | { type: "chi" | "pon" | "minkan"; seat: number; from: number; index: number; tiles: Tile[] }
  | { type: "ankan"; seat: number; kind: Kind }
  | { type: "kakan"; seat: number; kind: Kind }
  /** 三人麻雀の北抜き */
  | { type: "nuki"; seat: number }
  | { type: "kyuushu"; seat: number }
  | { type: "opts"; seat: number; opts: Partial<SeatOpts> }
  | { type: "connected"; seat: number; connected: boolean }
  | { type: "ack"; seat: number }
  | { type: "tick" };
