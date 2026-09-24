"use client";

// 効果音（Web Audio API で合成。音源ファイルは使わない）

const MUTE_KEY = "dopa_sound_muted";
const listeners = new Set<(muted: boolean) => void>();

export function isSoundMuted(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSoundMuted(muted: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    // 保存できなくても続行
  }
  listeners.forEach((l) => l(muted));
}

export function onMuteChange(cb: (muted: boolean) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (isSoundMuted()) return null;
  const Ctor =
    window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** スマホは操作をきっかけにしないと音が鳴らないため、最初のタップで準備する */
export function unlockAudio(): void {
  getCtx();
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = "sine", peak = 0.2, endFreq?: number) {
  const c = getCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  const t0 = c.currentTime + start;
  osc.frequency.setValueAtTime(freq, t0);
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t0 + dur);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

/** 牌を打つ「カチッ」という音（ノイズの短いバースト） */
function click(start: number, peak: number, cutoff: number) {
  const c = getCtx();
  if (!c) return;
  const len = Math.floor(c.sampleRate * 0.05);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 6);
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = cutoff;
  filter.Q.value = 1.2;
  const gain = c.createGain();
  gain.gain.value = peak;
  src.connect(filter);
  filter.connect(gain);
  gain.connect(c.destination);
  src.start(c.currentTime + start);
}

export const SE = {
  /** 自分の打牌 */
  discard() {
    click(0, 0.9, 2600);
    tone(1400, 0, 0.04, "square", 0.04);
  },
  /** 他家の打牌（控えめ） */
  otherDiscard() {
    click(0, 0.25, 2200);
  },
  /** ツモ */
  draw() {
    tone(740, 0, 0.06, "triangle", 0.06);
  },
  pon() {
    tone(520, 0, 0.09, "square", 0.12);
    tone(780, 0.08, 0.14, "square", 0.12);
  },
  chi() {
    tone(620, 0, 0.08, "square", 0.11);
    tone(620, 0.09, 0.12, "square", 0.11);
  },
  kan() {
    tone(330, 0, 0.12, "sawtooth", 0.1);
    tone(495, 0.1, 0.12, "sawtooth", 0.1);
    tone(660, 0.2, 0.2, "sawtooth", 0.1);
  },
  riichi() {
    tone(880, 0, 0.12, "sine", 0.2);
    tone(1175, 0.1, 0.12, "sine", 0.2);
    tone(1760, 0.2, 0.35, "sine", 0.18);
  },
  ron() {
    tone(392, 0, 0.12, "triangle", 0.3);
    tone(523.25, 0.1, 0.12, "triangle", 0.3);
    tone(659.25, 0.2, 0.12, "triangle", 0.3);
    tone(1046.5, 0.3, 0.5, "triangle", 0.32);
    click(0, 0.8, 1500);
  },
  tsumo() {
    tone(523.25, 0, 0.1, "triangle", 0.3);
    tone(659.25, 0.09, 0.1, "triangle", 0.3);
    tone(783.99, 0.18, 0.1, "triangle", 0.3);
    tone(1046.5, 0.27, 0.12, "triangle", 0.3);
    tone(1318.5, 0.38, 0.5, "triangle", 0.3);
  },
  ryukyoku() {
    tone(523.25, 0, 0.25, "sine", 0.18);
    tone(392, 0.22, 0.25, "sine", 0.18);
    tone(261.63, 0.44, 0.45, "sine", 0.18);
  },
  kyokuStart() {
    tone(660, 0, 0.1, "sine", 0.14);
    tone(990, 0.09, 0.18, "sine", 0.14);
  },
  /** 残り3秒の警告 */
  tick() {
    tone(1200, 0, 0.05, "square", 0.06);
  },
  /** 鳴ける・和了できる牌が出たときの合図 */
  chance() {
    tone(1568, 0, 0.07, "sine", 0.12);
    tone(2093, 0.06, 0.1, "sine", 0.12);
  },
  button() {
    tone(900, 0, 0.04, "triangle", 0.08);
  },
  error() {
    tone(200, 0, 0.18, "sawtooth", 0.12);
  },
  fanfare() {
    const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5];
    notes.forEach((f, i) => tone(f, i * 0.13, i === notes.length - 1 ? 0.6 : 0.14, "triangle", 0.26));
  },
};
