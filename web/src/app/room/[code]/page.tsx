"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { applyAction, nextDueAt, type Action, type GameState } from "@dopa/shared";
import GameView from "@/components/GameView";
import ResultView from "@/components/ResultView";
import FinalView from "@/components/FinalView";
import WaitingRoom from "@/components/WaitingRoom";
import { syncClock, serverNow } from "@/lib/clock";
import { getLastName, getOrCreatePlayerId, normalizeName, saveName } from "@/lib/identity";
import {
  HEARTBEAT_MS,
  STALE_MS,
  returnToRoom,
  activeSeats,
  playersOf,
  heartbeat,
  joinRoom,
  parseState,
  sendGameAction,
  subscribePresence,
  subscribeRoom,
  type PresenceDoc,
  type RoomDoc,
} from "@/lib/rooms";
import { SE } from "@/lib/sounds";

/** 進行役（CPU・時間切れ処理）の書き込み間隔の下限 */
const DRIVER_MIN_INTERVAL_MS = 1000;

export default function RoomPageWrapper() {
  return (
    <Suspense fallback={<p className="text-center text-dp-muted pt-10">読み込み中…</p>}>
      <RoomPage />
    </Suspense>
  );
}

function RoomPage() {
  const params = useParams<{ code: string }>();
  const code = params.code;
  const search = useSearchParams();
  const watch = search.get("watch") === "1";
  const router = useRouter();

  const [playerId, setPlayerId] = useState("");
  const [name, setName] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [joined, setJoined] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomDoc | null | undefined>(undefined);
  const [presence, setPresence] = useState<Record<string, PresenceDoc>>({});
  // 送信済みでまだサーバーに反映されていない自分の打牌
  const [pending, setPending] = useState<{
    seat: number;
    tile: number;
    riichi: boolean;
    kyokuSerial: number;
    riverLen: number;
  } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [clock, setClock] = useState(0);

  // 接続状態の表示を定期的に更新する
  useEffect(() => {
    const iv = setInterval(() => setClock((c) => c + 1), 5000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const pid = getOrCreatePlayerId();
    setPlayerId(pid);
    const n = getLastName();
    setName(n);
    setNameInput(n);
    void syncClock(pid);
  }, []);

  useEffect(
    () =>
      subscribeRoom(code, setRoom, (e) => {
        console.error(e);
        setJoinError(`ルームを読み込めませんでした（${(e as { code?: string }).code ?? e.message}）`);
      }),
    [code],
  );
  useEffect(() => subscribePresence(code, setPresence), [code]);

  // 入室（観戦URLの場合は入室しない）
  useEffect(() => {
    if (watch || !playerId || !name || joined) return;
    joinRoom(code, playerId, name)
      .then((r) => {
        if (!r.ok) setJoinError(r.error ?? "入室できませんでした");
        else if (r.spectator) router.replace(`/room/${code}?watch=1`);
        else setJoined(true);
      })
      .catch((e) => {
        console.error(e);
        const c = (e as { code?: string }).code;
        setJoinError(`入室できませんでした${c ? `（${c}）` : e instanceof Error ? `（${e.message}）` : ""}`);
      });
  }, [code, playerId, name, watch, joined, router]);

  const serverState = useMemo(() => parseState(room ?? null), [room]);
  // 送信中は手元で先に反映した状態を表示する（届いたら差し替え）
  // 自分の打牌が確定するまでは、届いた最新の状態に打牌だけを重ねて表示する。
  // 次のツモ牌は確定するまで表示しない（確定前に他家が鳴くと山の先頭が変わり、別の牌が配られるため）。
  const state = useMemo(() => {
    const st = serverState;
    if (!pending || !st?.kyoku || st.phase !== "playing" || st.kyokuSerial !== pending.kyokuSerial) return st;
    const p = st.kyoku.players[pending.seat];
    if (p.river.length !== pending.riverLen || !p.hand.includes(pending.tile)) return st; // 反映済み
    const r = applyAction(st, { type: "discard", seat: pending.seat, tile: pending.tile, riichi: pending.riichi }, serverNow());
    if (r.error || r.state.phase !== "playing" || !r.state.kyoku) return st;
    const me = r.state.kyoku.players[pending.seat];
    if (me.drawn !== null) {
      me.hand = me.hand.filter((t) => t !== me.drawn);
      me.drawn = null;
    }
    me.mustDiscard = false;
    return r.state;
  }, [serverState, pending]);

  const mySeat = useMemo(() => {
    if (watch || !room || !playerId) return null;
    if (room.status === "waiting") return null;
    const idx = room.gameSeats?.findIndex((s) => s.playerId === playerId) ?? -1;
    return idx >= 0 ? idx : null;
  }, [room, playerId, watch]);

  const seatedWaiting = !!room && room.status === "waiting" && room.seats.some((s) => s?.playerId === playerId);
  const isParticipant = mySeat !== null || seatedWaiting;

  // 接続確認（ハートビート）
  useEffect(() => {
    if (!isParticipant || !playerId) return;
    const beat = () => void heartbeat(code, playerId, name).catch(() => undefined);
    beat();
    const iv = setInterval(beat, HEARTBEAT_MS);
    const onVis = () => document.visibilityState === "visible" && beat();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [isParticipant, playerId, name, code]);

  // 各席の接続状態（CPUは常に接続扱い）
  const connected = useMemo(() => {
    const now = serverNow();
    const gs = room?.gameSeats ?? [];
    return gs.map((s) => {
      if (!s) return false;
      if (s.isCpu) return true;
      const p = s.playerId ? presence[s.playerId] : undefined;
      return !!p && now - p.lastSeenAt < STALE_MS;
    });
    // presence が変わるたび・一定時間ごとに再計算
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.gameSeats, presence, clock]);

  // 通信の失敗が続いているか（続いている間は画面上部に知らせる）
  const [netFailSince, setNetFailSince] = useState<number | null>(null);
  const markNet = useCallback((ok: boolean) => {
    setNetFailSince((cur) => (ok ? null : cur ?? Date.now()));
  }, []);
  // 送信中の書き込み（サーバーが応答しないと失敗にならず待ち続けるため、時間で判定する）
  const sendingStarts = useRef<Set<number>>(new Set());
  const track = useCallback(async <T,>(p: Promise<T>): Promise<T> => {
    const t = Date.now() + Math.random();
    sendingStarts.current.add(t);
    try {
      return await p;
    } finally {
      sendingStarts.current.delete(t);
    }
  }, []);
  const oldestSending = () => (sendingStarts.current.size ? Math.floor(Math.min(...sendingStarts.current)) : null);
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  // 待機中に全員が揃った・対局が始まったことを、別のタブを見ていても気づけるように知らせる
  const filledCount = room ? activeSeats(room).filter((x) => x !== null).length : 0;
  const prevRoomInfo = useRef<{ status?: string; filled: number }>({ filled: 0 });
  useEffect(() => {
    if (!room || !isParticipant) {
      prevRoomInfo.current = { status: room?.status, filled: filledCount };
      return;
    }
    const prev = prevRoomInfo.current;
    const started = prev.status === "waiting" && room.status === "playing";
    const cap = playersOf(room.rules);
    const filled = room.status === "waiting" && prev.filled > 0 && prev.filled < cap && filledCount === cap;
    prevRoomInfo.current = { status: room.status, filled: filledCount };
    if (!started && !filled) return;
    const text = started ? "【対局開始】" : `【${cap}人揃いました】`;
    if (filled) SE.chance();
    if (typeof document === "undefined" || document.visibilityState === "visible") return;
    const original = document.title;
    let on = false;
    const iv = setInterval(() => {
      on = !on;
      document.title = on ? text : original;
    }, 1000);
    const stop = () => {
      if (document.visibilityState !== "visible") return;
      clearInterval(iv);
      document.title = original;
      document.removeEventListener("visibilitychange", stop);
    };
    document.addEventListener("visibilitychange", stop);
  }, [room, filledCount, isParticipant]);

  // 同じ端末から送る書き込み同士がぶつかると、Firestoreがやり直し（待ち時間つき）をするため、
  // 自分の操作を送っている間は進行役の送信を止め、進行役の送信中に操作したときはその完了を待ってから送る。
  const inflight = useRef(false);
  const lastDriverTickAt = useRef(0);
  const driverSending = useRef<Promise<unknown> | null>(null);
  const userBusy = useRef(0);
  const pendingKey = useRef(0);
  const send = useCallback(
    async (a: Action, opts: { optimistic?: boolean } = {}) => {
      const key = Date.now();
      if (opts.optimistic && a.type === "discard" && serverState?.kyoku) {
        setPending({
          seat: a.seat,
          tile: a.tile,
          riichi: !!a.riichi,
          kyokuSerial: serverState.kyokuSerial,
          riverLen: serverState.kyoku.players[a.seat].river.length,
        });
        pendingKey.current = key;
      }
      let failed = false;
      userBusy.current++;
      try {
        if (driverSending.current) await driverSending.current.catch(() => undefined);
        const res = await track(sendGameAction(code, a));
        markNet(true);
        if (res.error && a.type !== "tick" && a.type !== "connected") {
          failed = true;
          // 局が終わった直後に届いた操作は、知らせる必要がないので黙って捨てる
          if (res.error !== "対局中ではありません") {
            setToast(res.error);
            SE.error();
            setTimeout(() => setToast(null), 3000);
          }
        }
      } catch (e) {
        failed = true;
        markNet(false);
        if (a.type !== "tick") {
          setToast(e instanceof Error ? e.message : "通信エラー");
          setTimeout(() => setToast(null), 1800);
        }
      } finally {
        userBusy.current--;
      }
      // 成功時はサーバーの状態が届いた時点で自動的に重ね表示が外れる（念のため一定時間後にも外す）
      if (pendingKey.current === key) {
        if (failed) setPending(null);
        else setTimeout(() => pendingKey.current === key && setPending(null), 5000);
      }
    },
    [code, serverState, markNet, track],
  );

  // 進行役：時間切れの自動ツモ切り・CPUの操作・次局への移行を行う。
  // 接続中の人間のうち席番号が最も小さい人が担当し、その人が落ちていれば他の人が少し遅れて代行する。
  const latest = useRef<{ state: GameState | null; connected: boolean[]; room: RoomDoc | null | undefined }>({
    state: null,
    connected: [],
    room: undefined,
  });
  latest.current = { state: serverState, connected, room };
  useEffect(() => {
    if (mySeat === null) return;
    const iv = setInterval(async () => {
      const { state: st, connected: conn, room: rm } = latest.current;
      if (!st || !rm || rm.status !== "playing" || inflight.current || userBusy.current > 0) return;
      const now = serverNow();
      const humans = st.seats.map((_, i) => i).filter((i) => !st.seats[i].isCpu);
      const onlineHumans = humans.filter((i) => conn[i] || i === mySeat);
      const driver = onlineHumans.length ? Math.min(...onlineHumans) : mySeat;
      const amDriver = driver === mySeat;

      let action: Action | null = null;
      if (!st.connected[mySeat]) action = { type: "connected", seat: mySeat, connected: true };
      else if (amDriver) {
        const mismatch = humans.find((i) => i !== mySeat && st.connected[i] !== conn[i]);
        if (mismatch !== undefined) action = { type: "connected", seat: mismatch, connected: conn[mismatch] };
      }
      if (!action) {
        const due = nextDueAt(st);
        const grace = amDriver ? 0 : 2500 + mySeat * 700;
        // Firestoreは1つのデータへの書き込みが毎秒1回程度を超えると遅くなるため、
        // 進行役の書き込みは最低 DRIVER_MIN_INTERVAL_MS あけ、その間に来たCPUの操作などはまとめて処理する
        const throttled = Date.now() - lastDriverTickAt.current < DRIVER_MIN_INTERVAL_MS;
        if (due !== null && now >= due + grace && !throttled) action = { type: "tick" };
      }
      if (!action) return;
      inflight.current = true;
      if (action.type === "tick") lastDriverTickAt.current = Date.now();
      const p = track(sendGameAction(code, action));
      driverSending.current = p;
      try {
        await p;
        markNet(true);
      } catch {
        // 次の周期で再試行
        markNet(false);
      } finally {
        inflight.current = false;
        if (driverSending.current === p) driverSending.current = null;
      }
    }, 200);
    return () => clearInterval(iv);
  }, [mySeat, code, markNet, track]);

  const onAction = useCallback((a: Action) => void send(a, { optimistic: a.type === "discard" }), [send]);

  const backToRoom = useCallback(async () => {
    try {
      const err = await returnToRoom(code, playerId);
      if (err) {
        setToast(err);
        SE.error();
        setTimeout(() => setToast(null), 1800);
      } else SE.button();
    } catch (e) {
      setToast(e instanceof Error ? e.message : "通信エラー");
      setTimeout(() => setToast(null), 1800);
    }
  }, [code, playerId]);

  // ---------------------------------------------------------------- 表示

  if (!watch && !name) {
    return (
      <main className="flex flex-col gap-3 max-w-sm mx-auto pt-10">
        <h1 className="text-xl font-black text-center">名前を入力して入室</h1>
        <input className="input" value={nameInput} maxLength={16} onChange={(e) => setNameInput(e.target.value)} placeholder="名前" />
        <button
          className="btn-primary"
          onClick={() => {
            const n = normalizeName(nameInput);
            if (!n) return;
            saveName(n);
            setName(n);
          }}
        >
          入室する
        </button>
        <Link href={`/room/${code}?watch=1`} className="text-center text-sm text-dp-muted">
          観戦だけする
        </Link>
      </main>
    );
  }

  if (room === undefined && !joinError) return <p className="text-center text-dp-muted pt-10">読み込み中…</p>;
  if (!room || joinError) {
    return (
      <main className="flex flex-col gap-3 items-center pt-10">
        <p className="text-dp-bad font-bold">{joinError ?? "ルームが見つかりません"}</p>
        <Link href="/" className="btn-secondary">
          ロビーへ戻る
        </Link>
      </main>
    );
  }

  const header = (
    <div className="flex items-center justify-between mb-2 text-sm">
      <Link href="/" className="text-dp-muted">
        ‹ ロビー
      </Link>
      <span className="text-dp-muted">
        ルーム {room.code}
        {watch && "（観戦）"}
      </span>
    </div>
  );

  if (room.status === "aborted") {
    return (
      <main>
        {header}
        <div className="card p-6 text-center flex flex-col gap-3">
          <p className="font-bold">この対局は終了しました</p>
          {room.abortedReason && <p className="text-sm text-dp-muted">{room.abortedReason}</p>}
          <Link href="/" className="btn-secondary self-center">
            ロビーへ戻る
          </Link>
        </div>
      </main>
    );
  }

  if (room.status === "waiting") {
    if (watch) {
      return (
        <main>
          {header}
          <p className="card p-6 text-center text-dp-muted">対局が始まるのを待っています…</p>
        </main>
      );
    }
    return (
      <main>
        {header}
        <WaitingRoom room={room} playerId={playerId} presence={presence} onLeft={() => router.push("/")} />
      </main>
    );
  }

  if (!state) return <p className="text-center text-dp-muted pt-10">読み込み中…</p>;

  return (
    <main>
      {header}
      {state.phase === "ended" ? (
        <FinalView state={state} recorded={room.recorded} onBackToRoom={mySeat !== null ? backToRoom : undefined} cpuGame={room.isCpuGame} matchId={`${room.code}-${state.startedAt}`} />
      ) : (
        <GameView state={state} mySeat={mySeat} onAction={onAction} connected={connected} />
      )}
      {state.phase === "result" && state.result && (
        <ResultView state={state} mySeat={mySeat} onAck={() => mySeat !== null && void send({ type: "ack", seat: mySeat })} />
      )}
      <NetBanner
        failSince={minOrNull(netFailSince, oldestSending())}
        stalledSince={stalledSince(serverState, room)}
        now={nowTick}
      />
      {toast && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 rounded-xl bg-dp-bad text-white px-4 py-2 text-sm font-bold shadow-lg">
          {toast}
        </div>
      )}
    </main>
  );
}

/** 対局の進行が予定より大きく遅れている場合、その予定時刻（遅れていなければ null） */
function stalledSince(st: GameState | null, room: RoomDoc): number | null {
  if (!st || room.status !== "playing" || st.phase === "ended") return null;
  const due = nextDueAt(st);
  if (due === null) return null;
  return serverNow() - due > STALL_MS ? due : null;
}

function minOrNull(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

/** 進行が止まったとみなすまでの時間 */
const STALL_MS = 8000;
/** 再読み込みボタンを出すまでの時間 */
const RELOAD_HINT_MS = 15000;

function NetBanner({ failSince, stalledSince, now }: { failSince: number | null; stalledSince: number | null; now: number }) {
  void now; // 1秒ごとに再描画するため
  const failFor = failSince === null ? 0 : Date.now() - failSince;
  const stallFor = stalledSince === null ? 0 : serverNow() - stalledSince;
  const trouble = failFor > 4000 || stallFor > 0;
  if (!trouble) return null;
  const longTrouble = failFor > RELOAD_HINT_MS || stallFor > RELOAD_HINT_MS;
  return (
    <div
      role="status"
      className="fixed top-2 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-24px)] max-w-md rounded-xl bg-dp-panel2 border border-dp-bad/70 px-3 py-2 text-sm shadow-lg flex items-center gap-2"
    >
      <span className="flex-1">
        {failFor > 4000 ? "通信が不安定です。自動で再接続しています…" : "対局の進行が止まっています。通信を確認しています…"}
      </span>
      {longTrouble && (
        <button className="btn-primary px-3 py-1 text-xs" onClick={() => location.reload()}>
          再読み込み
        </button>
      )}
    </div>
  );
}
