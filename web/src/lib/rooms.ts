import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit as fsLimit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  setDoc,
  startAfter,
  where,
  type Transaction,
} from "firebase/firestore";
import {
  DEFAULT_RULES,
  applyAction,
  createGame,
  roundLabel,
  type Action,
  type CpuLevel,
  type GameState,
  type Rules,
  type SeatInfo,
} from "@dopa/shared";
import { db } from "./firebase";
import { serverNow } from "./clock";
import {
  aliasDocId,
  applyMatchPlayer,
  emptyStats,
  kifuDocId,
  parseKifu,
  playerDocId,
  type KifuDoc,
  type KifuView,
  type MatchDoc,
  type MatchPlayerRecord,
  type PlayerStatsDoc,
} from "./statsModel";

export const ROOMS = "dopa_rooms";
export const HEARTBEAT_MS = 10_000;
export const STALE_MS = 25_000;

export interface SeatDoc {
  playerId: string | null; // CPUは null
  name: string;
  isCpu: boolean;
  cpuLevel: CpuLevel;
}

export interface RoomSummary {
  label: string;
  names: string[];
  scores: number[];
  ended: boolean;
}

export type RoomStatus = "waiting" | "playing" | "ended" | "aborted";

export interface RoomDoc {
  code: string;
  createdAt: number;
  updatedAt: number;
  status: RoomStatus;
  hostId: string;
  isCpuGame: boolean;
  rules: Rules;
  /** 待機室の席 */
  seats: (SeatDoc | null)[];
  /** 対局中の席順（0が起家） */
  gameSeats: SeatDoc[] | null;
  stateJson: string | null;
  summary: RoomSummary | null;
  recorded: boolean;
  abortedReason: string | null;
  /** 前回の対局結果（部屋に戻ったときに待機室で表示する） */
  lastFinal?: LastFinalPlayer[] | null;
}

export interface LastFinalPlayer {
  name: string;
  isCpu: boolean;
  rank: number;
  score: number;
  points: number;
}

export interface PresenceDoc {
  lastSeenAt: number;
  name: string;
}

export function roomRef(code: string) {
  return doc(db, ROOMS, code);
}

export function parseState(room: RoomDoc | null): GameState | null {
  if (!room?.stateJson) return null;
  try {
    return JSON.parse(room.stateJson) as GameState;
  } catch {
    return null;
  }
}

export function subscribeRoom(code: string, cb: (room: RoomDoc | null) => void, onError?: (e: Error) => void) {
  return onSnapshot(
    roomRef(code),
    (snap) => cb(snap.exists() ? (snap.data() as RoomDoc) : null),
    (e) => onError?.(e),
  );
}

export function subscribePresence(code: string, cb: (p: Record<string, PresenceDoc>) => void) {
  return onSnapshot(collection(db, ROOMS, code, "presence"), (snap) => {
    const out: Record<string, PresenceDoc> = {};
    for (const d of snap.docs) out[d.id] = d.data() as PresenceDoc;
    cb(out);
  });
}

export async function heartbeat(code: string, playerId: string, name: string): Promise<void> {
  await setDoc(doc(db, ROOMS, code, "presence", playerId), { lastSeenAt: serverNow(), name });
}

// ------------------------------------------------------------ 放置ルームの自動終了

/** 動きがなく、参加者が誰も接続していない状態がこれだけ続いたルームは終了扱いにする */
export const ABANDON_MS = 10 * 60 * 1000;
const cleanupTried = new Set<string>();

/**
 * 放置されたルーム（待機中・対局中）を終了扱いにする。ロビーを開いた人のブラウザが、見つけたときに行う。
 * 対局中だったものは戦績に記録しない（最後まで打っていないため）。
 */
async function closeIfAbandoned(code: string): Promise<void> {
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef(code));
    if (!snap.exists()) return;
    const room = snap.data() as RoomDoc;
    if (room.status !== "waiting" && room.status !== "playing") return;
    const now = serverNow();
    if (now - room.updatedAt < ABANDON_MS) return;
    const seats = room.status === "playing" ? room.gameSeats ?? [] : room.seats;
    for (const seat of seats) {
      if (!seat || seat.isCpu || !seat.playerId) continue;
      const p = await tx.get(doc(db, ROOMS, code, "presence", seat.playerId));
      if (p.exists() && now - (p.data() as PresenceDoc).lastSeenAt < ABANDON_MS) return; // まだ誰かいる
    }
    tx.update(roomRef(code), {
      status: "aborted",
      abortedReason:
        room.status === "playing"
          ? "長い時間だれも接続していなかったため、対局を終了しました（戦績には記録されません）"
          : "長い時間だれもいなかったため、ルームを閉じました",
      updatedAt: now,
    });
  });
}

function cleanupAbandoned(rooms: RoomDoc[]) {
  const now = serverNow();
  for (const r of rooms) {
    if (now - r.updatedAt < ABANDON_MS || cleanupTried.has(r.code)) continue;
    cleanupTried.add(r.code);
    void closeIfAbandoned(r.code).catch(() => undefined);
  }
}

export function subscribePlayingRooms(cb: (rooms: RoomDoc[]) => void) {
  const q = query(collection(db, ROOMS), where("status", "==", "playing"), fsLimit(50));
  return onSnapshot(q, (snap) => {
    const now = serverNow();
    const all = snap.docs.map((d) => d.data() as RoomDoc);
    cleanupAbandoned(all);
    const rooms = all
      .filter((r) => now - r.updatedAt < 30 * 60 * 1000)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    cb(rooms);
  });
}

/** 参加者を募集中（開始前）の対人戦ルーム。しばらく動きのないルームは出さない */
export function subscribeWaitingRooms(cb: (rooms: RoomDoc[]) => void) {
  const q = query(collection(db, ROOMS), where("status", "==", "waiting"), fsLimit(50));
  return onSnapshot(q, (snap) => {
    const now = serverNow();
    const all = snap.docs.map((d) => d.data() as RoomDoc);
    cleanupAbandoned(all);
    const rooms = all
      .filter((r) => !r.isCpuGame && now - r.updatedAt < 2 * 60 * 60 * 1000)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    cb(rooms);
  });
}

function summarize(state: GameState): RoomSummary {
  return {
    label: state.phase === "ended" ? "終了" : roundLabel(state),
    names: state.seats.map((s) => s.name),
    scores: state.scores.slice(),
    ended: state.phase === "ended",
  };
}

function randomCode(): string {
  return String(Math.floor(10000 + Math.random() * 90000));
}

export function cpuName(level: CpuLevel, index: number): string {
  const label = level === "weak" ? "弱" : level === "normal" ? "普" : "強";
  return `CPU${index}(${label})`;
}

function cpuSeat(level: CpuLevel, index: number): SeatDoc {
  return { playerId: null, name: cpuName(level, index), isCpu: true, cpuLevel: level };
}

function newGameFromSeats(seats: SeatDoc[], rules: Rules, now: number): { gameSeats: SeatDoc[]; state: GameState } {
  // 席順（起家）はランダム
  const order = seats.map((s) => ({ s, r: Math.random() })).sort((a, b) => a.r - b.r).map((x) => x.s);
  const infos: SeatInfo[] = order.map((s) => ({ name: s.name, isCpu: s.isCpu, cpuLevel: s.cpuLevel }));
  const seed = Math.floor(Math.random() * 2 ** 31);
  return { gameSeats: order, state: createGame(infos, rules, seed, now) };
}

export async function createRoom(
  playerId: string,
  name: string,
  rules: Rules = DEFAULT_RULES,
  isCpuGame = false,
): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode();
    const ok = await runTransaction(db, async (tx) => {
      const snap = await tx.get(roomRef(code));
      if (snap.exists()) {
        const r = snap.data() as RoomDoc;
        // 古いルームのコードは再利用する
        if (serverNow() - r.updatedAt < 24 * 60 * 60 * 1000) return false;
      }
      const now = serverNow();
      const me: SeatDoc = { playerId, name, isCpu: false, cpuLevel: rules.cpuLevel };
      const room: RoomDoc = {
        code,
        createdAt: now,
        updatedAt: now,
        status: "waiting",
        hostId: playerId,
        isCpuGame,
        rules,
        seats: [me, null, null, null],
        gameSeats: null,
        stateJson: null,
        summary: null,
        recorded: false,
        abortedReason: null,
      };
      if (isCpuGame) {
        room.seats = [me, cpuSeat(rules.cpuLevel, 1), cpuSeat(rules.cpuLevel, 2), cpuSeat(rules.cpuLevel, 3)];
        const { gameSeats, state } = newGameFromSeats(room.seats as SeatDoc[], rules, now);
        room.status = "playing";
        room.gameSeats = gameSeats;
        room.stateJson = JSON.stringify(state);
        room.summary = summarize(state);
      }
      tx.set(roomRef(code), room);
      return true;
    });
    if (ok) return code;
  }
  throw new Error("ルームを作成できませんでした。もう一度お試しください");
}

export interface JoinResult {
  ok: boolean;
  spectator?: boolean;
  error?: string;
}

/** 入室。空席があれば着席、対局中なら同じID（または同じ名前）の席に再入場、それ以外は観戦。 */
export async function joinRoom(code: string, playerId: string, name: string): Promise<JoinResult> {
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef(code));
    if (!snap.exists()) return { ok: false, error: "ルームが見つかりません" };
    const room = snap.data() as RoomDoc;
    if (room.status === "aborted") return { ok: false, error: "このルームは終了しています" };

    if (room.status === "waiting") {
      if (room.seats.some((s) => s && s.playerId === playerId)) return { ok: true };
      const sameName = room.seats.findIndex((s) => s && !s.isCpu && s.name === name);
      if (sameName >= 0) {
        // 同じ名前は同一人物として扱う（別の端末からの入り直し）
        room.seats[sameName] = { ...room.seats[sameName]!, playerId };
        tx.update(roomRef(code), { seats: room.seats, updatedAt: serverNow() });
        return { ok: true };
      }
      const empty = room.seats.findIndex((s) => s === null);
      if (empty < 0) return { ok: true, spectator: true };
      room.seats[empty] = { playerId, name, isCpu: false, cpuLevel: room.rules.cpuLevel };
      tx.update(roomRef(code), { seats: room.seats, updatedAt: serverNow() });
      return { ok: true };
    }

    const gs = room.gameSeats ?? [];
    if (gs.some((s) => s.playerId === playerId)) return { ok: true };
    const idx = gs.findIndex((s) => !s.isCpu && s.name === name);
    if (idx >= 0 && room.status === "playing") {
      gs[idx] = { ...gs[idx], playerId };
      tx.update(roomRef(code), { gameSeats: gs, updatedAt: serverNow() });
      return { ok: true };
    }
    return { ok: true, spectator: true };
  });
}

export async function leaveWaitingRoom(code: string, playerId: string): Promise<void> {
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef(code));
    if (!snap.exists()) return;
    const room = snap.data() as RoomDoc;
    if (room.status !== "waiting") return;
    const idx = room.seats.findIndex((s) => s && s.playerId === playerId);
    if (idx < 0) return;
    room.seats[idx] = null;
    const humans = room.seats.filter((s) => s && !s.isCpu);
    const update: Partial<RoomDoc> = { seats: room.seats, updatedAt: serverNow() };
    if (humans.length === 0) {
      update.status = "aborted";
      update.abortedReason = "全員が退出しました";
    } else if (room.hostId === playerId) {
      update.hostId = humans[0]!.playerId!;
    }
    tx.update(roomRef(code), update);
  });
}

async function hostTx(code: string, playerId: string, fn: (room: RoomDoc, tx: Transaction) => Partial<RoomDoc> | string) {
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef(code));
    if (!snap.exists()) return "ルームが見つかりません";
    const room = snap.data() as RoomDoc;
    if (room.hostId !== playerId) return "ホストのみ操作できます";
    if (room.status !== "waiting") return "対局が始まっています";
    const r = fn(room, tx);
    if (typeof r === "string") return r;
    tx.update(roomRef(code), { ...r, updatedAt: serverNow() });
    return null;
  });
}

export async function setSeatCpu(code: string, playerId: string, seatIndex: number, level: CpuLevel | null) {
  return hostTx(code, playerId, (room) => {
    const cur = room.seats[seatIndex];
    if (cur && !cur.isCpu) return "その席には人が座っています";
    room.seats[seatIndex] = level ? cpuSeat(level, seatIndex) : null;
    return { seats: room.seats };
  });
}

export async function fillCpu(code: string, playerId: string, level: CpuLevel) {
  return hostTx(code, playerId, (room) => {
    room.seats = room.seats.map((s, i) => s ?? cpuSeat(level, i));
    return { seats: room.seats };
  });
}

export async function updateRules(code: string, playerId: string, rules: Rules) {
  return hostTx(code, playerId, () => ({ rules }));
}

/** 終局後、同じメンバーのまま待機室に戻す（参加者なら誰でも実行できる） */
export async function returnToRoom(code: string, playerId: string): Promise<string | null> {
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef(code));
    if (!snap.exists()) return "ルームが見つかりません";
    const room = snap.data() as RoomDoc;
    if (room.status === "waiting") return null; // すでに誰かが戻している
    if (room.status !== "ended") return "対局が終わっていません";
    const gs = room.gameSeats ?? [];
    if (!gs.some((x) => x.playerId === playerId)) return "この対局の参加者ではありません";
    const state = parseState(room);
    // 再入場で端末が変わった人がいれば、新しい端末のIDを席に反映する
    const seats = room.seats.map((seat) => {
      if (!seat || seat.isCpu) return seat;
      const g = gs.find((x) => !x.isCpu && x.name === seat.name);
      return g ? { ...seat, playerId: g.playerId } : seat;
    });
    const humans = seats.filter((x) => x && !x.isCpu) as SeatDoc[];
    const hostId = humans.some((x) => x.playerId === room.hostId) ? room.hostId : humans[0]?.playerId ?? room.hostId;
    tx.update(roomRef(code), {
      status: "waiting",
      seats,
      hostId,
      gameSeats: null,
      stateJson: null,
      summary: null,
      recorded: false,
      lastFinal:
        state?.final?.players.map((p) => ({ name: p.name, isCpu: p.isCpu, rank: p.rank, score: p.score, points: p.points })) ??
        null,
      updatedAt: serverNow(),
    });
    return null;
  });
}

export async function startGame(code: string, playerId: string) {
  return hostTx(code, playerId, (room) => {
    if (room.seats.some((s) => s === null)) return "4人そろっていません（空席はCPUで補充できます）";
    const names = room.seats.filter((s) => s && !s.isCpu).map((s) => s!.name);
    if (new Set(names).size !== names.length) return "同じ名前のプレイヤーがいます";
    const now = serverNow();
    const { gameSeats, state } = newGameFromSeats(room.seats as SeatDoc[], room.rules, now);
    return {
      status: "playing",
      gameSeats,
      stateJson: JSON.stringify(state),
      summary: summarize(state),
    };
  });
}

// ------------------------------------------------------------ 対局中の操作

export interface ActionResult {
  error?: string;
  state?: GameState;
}

/**
 * 対局の操作を送る。Firestoreのトランザクションで「先にコミットした方が勝ち」になるため、
 * 早押しの判定はサーバー（Firestore）に届いた順になる。
 */
/**
 * 書き込みがぶつかったときのやり直しを自前で行う。
 * Firestoreに任せると、やり直しのたびに約1秒→1.5秒→2.3秒…と待つため、3回ぶつかると約5秒かかる。
 * ここでは待たずに（ごく短いランダムな間だけ空けて）すぐ再挑戦する。
 */
async function runTxFast<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  const MAX_TRIES = 25;
  for (let attempt = 1; ; attempt++) {
    try {
      return await runTransaction(db, fn, { maxAttempts: 1 });
    } catch (e) {
      const code = (e as { code?: string }).code;
      const retryable = code === "aborted" || code === "failed-precondition" || code === "unavailable";
      if (!retryable || attempt >= MAX_TRIES) throw e;
      await new Promise((r) => setTimeout(r, Math.random() * Math.min(120, 15 * attempt)));
    }
  }
}

export async function sendGameAction(code: string, action: Action): Promise<ActionResult> {
  return runTxFast(
    async (tx) => {
      const snap = await tx.get(roomRef(code));
      if (!snap.exists()) return { error: "ルームが見つかりません" };
      const room = snap.data() as RoomDoc;
      if (room.status !== "playing" || !room.stateJson) return { error: "対局中ではありません" };
      const prevJson = room.stateJson;
      const prev = JSON.parse(prevJson) as GameState;
      const { state, error } = applyAction(prev, action, serverNow());
      const nextJson = JSON.stringify(state);
      if (nextJson === prevJson) return { error, state };

      const update: Partial<RoomDoc> = {
        stateJson: nextJson,
        summary: summarize(state),
        updatedAt: serverNow(),
      };
      // 局が終わったら牌譜（終局時の盤面）を1局1件で保存する。
      // ここでの書き込みが失敗すると対局そのものが進まなくなるので、形と大きさに気をつける
      const kifu = state.lastKifu;
      const kifuJson = kifu && kifu.serial !== prev.lastKifu?.serial ? JSON.stringify(kifu) : null;
      if (kifu && kifuJson && kifuJson.length < 200_000) {
        const matchId = `${code}-${state.startedAt}`;
        const rec: KifuDoc = {
          kind: "kifu",
          kifuOf: matchId,
          serial: kifu.serial,
          mode: state.rules.length,
          aka: state.rules.aka,
          json: kifuJson,
        };
        tx.set(doc(db, "dopa_matches", kifuDocId(matchId, kifu.serial)), rec);
      }
      if (state.phase === "ended" && !room.recorded) {
        const plan = await prepareRecord(tx, room, state);
        update.status = "ended";
        update.recorded = true;
        writeRecord(tx, plan);
      }
      tx.update(roomRef(code), update);
      return { error, state };
    },
  );
}

// ------------------------------------------------------------ 戦績の記録

interface RecordPlan {
  match: MatchDoc;
  players: { id: string; doc: PlayerStatsDoc }[];
}

async function resolveAlias(tx: Transaction, name: string): Promise<string> {
  let cur = name;
  for (let i = 0; i < 5; i++) {
    const snap = await tx.get(doc(db, "dopa_aliases", aliasDocId(cur)));
    if (!snap.exists()) return cur;
    const to = (snap.data() as { to: string }).to;
    if (!to || to === cur) return cur;
    cur = to;
  }
  return cur;
}

async function prepareRecord(tx: Transaction, room: RoomDoc, state: GameState): Promise<RecordPlan> {
  const mode = state.rules.length;
  const final = state.final!;
  const matchId = `${room.code}-${state.startedAt}`;
  const players: MatchPlayerRecord[] = [];
  for (const fp of final.players) {
    const st = state.stats[fp.seat];
    const name = fp.isCpu ? fp.name : await resolveAlias(tx, fp.name);
    players.push({
      name,
      isCpu: fp.isCpu,
      rank: fp.rank,
      score: fp.score,
      points: fp.points,
      kyokus: st.kyokus,
      wins: st.wins,
      dealins: st.dealins,
      calls: st.calls,
      riichis: st.riichis,
      tobi: fp.score < 0,
      yakuman: st.yakuman,
    });
  }
  const match: MatchDoc = {
    id: matchId,
    mode,
    roomCode: room.code,
    startedAt: state.startedAt,
    endedAt: final.endedAt,
    // CPU対戦は記録だけ残し、ランキング（戦績）には加算しない
    excluded: room.isCpuGame,
    cpuGame: room.isCpuGame,
    players,
  };
  const out: RecordPlan = { match, players: [] };
  if (room.isCpuGame) return out;
  for (const p of players) {
    if (p.isCpu) continue;
    const id = playerDocId(mode, p.name);
    const snap = await tx.get(doc(db, "dopa_players", id));
    const cur = snap.exists() ? (snap.data() as PlayerStatsDoc) : emptyStats(p.name, mode);
    out.players.push({ id, doc: applyMatchPlayer(cur, p, matchId, final.endedAt, 1) });
  }
  return out;
}

function writeRecord(tx: Transaction, plan: RecordPlan) {
  tx.set(doc(db, "dopa_matches", plan.match.id), plan.match);
  for (const p of plan.players) tx.set(doc(db, "dopa_players", p.id), p.doc);
}

/** 東風戦・東南戦・一荘戦すべての戦績（ランキングは名前ごとに合計して表示する） */
export function subscribeAllPlayerStats(cb: (docs: PlayerStatsDoc[]) => void) {
  const q = query(collection(db, "dopa_players"), fsLimit(1000));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => d.data() as PlayerStatsDoc)));
}

export function subscribeRanking(mode: string, cb: (docs: PlayerStatsDoc[]) => void) {
  const q = query(collection(db, "dopa_players"), where("mode", "==", mode), fsLimit(1000));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => d.data() as PlayerStatsDoc)));
}

// ------------------------------------------------------------ 対局履歴・牌譜

/** 1回に読む対局数（Firestoreのルールで一覧は100件まで） */
export const HISTORY_PAGE = 100;

/**
 * 終わった対局を新しい順に読む（before を渡すとそれより前）。
 * 名前での絞り込みはブラウザ側で行う（名前ごとの索引を作らずに済むように）。
 */
export async function fetchMatchesPage(before?: number): Promise<MatchDoc[]> {
  const base = collection(db, "dopa_matches");
  const q =
    before === undefined
      ? query(base, orderBy("endedAt", "desc"), fsLimit(HISTORY_PAGE))
      : query(base, orderBy("endedAt", "desc"), startAfter(before), fsLimit(HISTORY_PAGE));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as MatchDoc);
}

export async function fetchMatch(id: string): Promise<MatchDoc | null> {
  const snap = await getDoc(doc(db, "dopa_matches", id));
  if (!snap.exists()) return null;
  const m = snap.data() as MatchDoc | KifuDoc;
  return "kind" in m ? null : m;
}

export async function fetchKifu(matchId: string): Promise<KifuView[]> {
  const q = query(collection(db, "dopa_matches"), where("kifuOf", "==", matchId), fsLimit(HISTORY_PAGE));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => d.data() as KifuDoc)
    .sort((a, b) => a.serial - b.serial)
    .map(parseKifu);
}
