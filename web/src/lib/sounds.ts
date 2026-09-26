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
  if (muted && speechAvailable()) window.speechSynthesis.cancel();
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
  unlockSpeech();
}

// ---------------------------------------------------------------- 音声（読み上げ）

let speechUnlocked = false;

function speechAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

/** スマホは操作をきっかけにしないと読み上げが鳴らないため、最初のタップで無音の読み上げをしておく */
function unlockSpeech() {
  if (speechUnlocked || !speechAvailable()) return;
  speechUnlocked = true;
  try {
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    window.speechSynthesis.speak(u);
  } catch {
    // 読み上げに対応していない環境では何もしない
  }
}

function japaneseVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  return voices.find((v) => v.lang === "ja-JP") ?? voices.find((v) => v.lang.toLowerCase().startsWith("ja")) ?? null;
}

/** 日本語で読み上げる（効果音オフのときは鳴らさない） */
export function speak(text: string): void {
  if (isSoundMuted() || !speechAvailable()) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ja-JP";
    const v = japaneseVoice();
    if (v) u.voice = v;
    u.rate = 1.15;
    u.pitch = 1.1;
    u.volume = 1;
    window.speechSynthesis.speak(u);
  } catch {
    // 読み上げに対応していない環境では何もしない
  }
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

// ---------------------------------------------------------------- 役満用（豪華な音）

/** 大きな音を重ねても割れないよう、役満の音はまとめて圧縮してから出す */
function busOut(c: AudioContext): AudioNode {
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 6;
  comp.attack.value = 0.003;
  comp.release.value = 0.25;
  const master = c.createGain();
  master.gain.value = 0.6;
  comp.connect(master);
  master.connect(c.destination);
  return comp;
}

/** 金管楽器風の音（少しずらした2本のノコギリ波＋明るさが変化するフィルター＋ビブラート） */
function brass(out: AudioNode, freq: number, start: number, dur: number, peak = 0.12) {
  const c = getCtx();
  if (!c) return;
  const t0 = c.currentTime + start;
  const gain = c.createGain();
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + 0.03);
  gain.gain.setValueAtTime(peak * 0.85, t0 + Math.max(0.05, dur - 0.12));
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  const filter = c.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = 2;
  filter.frequency.setValueAtTime(freq * 1.5, t0);
  filter.frequency.linearRampToValueAtTime(freq * 6, t0 + 0.06);
  filter.frequency.exponentialRampToValueAtTime(freq * 3, t0 + dur);
  filter.connect(gain);
  gain.connect(out);
  // 長い音にはビブラート
  const lfo = c.createOscillator();
  const lfoGain = c.createGain();
  lfo.frequency.value = 5.5;
  lfoGain.gain.value = dur > 0.4 ? freq * 0.008 : 0;
  lfo.connect(lfoGain);
  for (const detune of [-7, 7]) {
    const o = c.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(freq, t0);
    o.detune.value = detune;
    lfoGain.connect(o.frequency);
    o.connect(filter);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }
  lfo.start(t0);
  lfo.stop(t0 + dur + 0.05);
}

/** 銅鑼（ドラ）のような低い響き */
function gong(out: AudioNode, start: number) {
  const c = getCtx();
  if (!c) return;
  const t0 = c.currentTime + start;
  for (const [f, p, d] of [
    [82, 0.5, 2.8],
    [123, 0.25, 2.2],
    [197, 0.14, 1.6],
    [311, 0.07, 1.2],
  ] as const) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(f * 1.04, t0);
    o.frequency.exponentialRampToValueAtTime(f, t0 + 0.4);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(p, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
    o.connect(g);
    g.connect(out);
    o.start(t0);
    o.stop(t0 + d + 0.05);
  }
  // 打った瞬間の「ジャーン」という金属的な雑音
  const len = Math.floor(c.sampleRate * 1.2);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 2400;
  bp.Q.value = 0.7;
  const g = c.createGain();
  g.gain.value = 0.35;
  src.connect(bp);
  bp.connect(g);
  g.connect(out);
  src.start(t0);
}

/** きらきらした高い音をばらまく */
function sparkle(out: AudioNode, start: number, dur: number, count: number) {
  const c = getCtx();
  if (!c) return;
  const scale = [2093, 2349.3, 2637, 3136, 3520, 4186];
  for (let i = 0; i < count; i++) {
    const t0 = c.currentTime + start + Math.random() * dur;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = "sine";
    o.frequency.value = scale[Math.floor(Math.random() * scale.length)];
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.05, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
    o.connect(g);
    g.connect(out);
    o.start(t0);
    o.stop(t0 + 0.4);
  }
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
    tone(880, 0, 0.12, "sine", 0.14);
    tone(1175, 0.1, 0.12, "sine", 0.14);
    speak("リーチ");
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
  /** 役満（約4秒の豪華なファンファーレ） */
  yakuman() {
    const c = getCtx();
    if (!c) return;
    const out = busOut(c);
    // 1. 銅鑼＋駆け上がり
    gong(out, 0);
    [261.63, 329.63, 392, 523.25, 659.25, 783.99, 1046.5, 1318.5, 1568, 2093].forEach((f, i) =>
      tone(f, 0.05 + i * 0.035, 0.18, "triangle", 0.07),
    );
    // 2. 金管のファンファーレ「タタタ・ターン」（C）→「タタタ・ターン」（D）
    const C = [523.25, 659.25, 783.99];
    const D = [587.33, 739.99, 880];
    const hit = (chord: number[], t: number, d: number, p = 0.09) => chord.forEach((f) => brass(out, f, t, d, p));
    hit(C, 0.5, 0.11);
    hit(C, 0.64, 0.11);
    hit(C, 0.78, 0.11);
    hit(C, 0.92, 0.42);
    hit(D, 1.4, 0.11);
    hit(D, 1.54, 0.11);
    hit(D, 1.68, 0.11);
    hit(D, 1.82, 0.42);
    // 3. 最後に大きな和音（E♭→F→G と上がって、Cで締める）
    hit([622.25, 783.99, 932.33], 2.3, 0.2);
    hit([698.46, 880, 1046.5], 2.52, 0.2);
    hit([783.99, 987.77, 1174.66], 2.74, 0.2);
    hit([523.25, 659.25, 783.99, 1046.5], 2.98, 1.5, 0.1);
    brass(out, 130.81, 2.98, 1.5, 0.16); // 低音
    brass(out, 261.63, 2.98, 1.5, 0.1);
    gong(out, 2.98);
    sparkle(out, 2.98, 1.4, 26);
    // 読み上げ（音の区切りに合わせる）
    setTimeout(() => speak("役満"), 3100);
  },
  fanfare() {
    const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5];
    notes.forEach((f, i) => tone(f, i * 0.13, i === notes.length - 1 ? 0.6 : 0.14, "triangle", 0.26));
  },
};
