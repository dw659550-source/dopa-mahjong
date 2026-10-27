// 少牌マイティ：手牌を12枚で打ち、架空の13枚目をオールマイティ（どの牌にもなれる牌）として扱う。
// オールマイティは「自分の手牌（副露・抜いた北を含む）で5枚目になる牌」と、三人麻雀で使わない牌（二萬〜八萬）にはなれない。
import { kokushiShanten, shanten } from "./shanten.ts";
import { NUM_KINDS, YAOCHU_KINDS, isSanmaRemoved, type Kind } from "./tiles.ts";

/**
 * オールマイティが何になれば得をしうるかの候補（計算量を減らすため、関係のある牌種だけ）。
 * 手牌にある牌種、同じ色の±2以内の数牌、么九牌（国士無双用）。
 */
function candidateKinds(counts: number[], own: number[]): Kind[] {
  const set = new Set<Kind>();
  for (let k = 0; k < NUM_KINDS; k++) {
    if (counts[k] === 0) continue;
    set.add(k);
    if (k < 27) {
      const base = Math.floor(k / 9) * 9;
      for (let d = -2; d <= 2; d++) {
        const x = k + d;
        if (x >= base && x < base + 9) set.add(x);
      }
    }
  }
  // 国士無双を狙えるほど么九牌があるときだけ、么九牌すべてを候補にする
  if (YAOCHU_KINDS.filter((k) => counts[k] > 0).length >= 8) for (const k of YAOCHU_KINDS) set.add(k);
  return [...set].filter((k) => own[k] < 4 && !isSanmaRemoved(k)).sort((a, b) => a - b);
}

const shantenCache = new Map<string, number>();
const waitCache = new Map<string, Kind[]>();

function remember<T>(cache: Map<string, T>, key: string, value: T): T {
  if (cache.size > 5000) cache.clear();
  cache.set(key, value);
  return value;
}

/**
 * オールマイティ込みの向聴数。counts は純手牌、own は自分の牌すべて（純手牌・副露・抜いた北）の枚数。
 */
export function mightyShanten(counts: number[], meldCount: number, own: number[]): number {
  const key = `${counts.join("")}|${meldCount}|${own.join("")}`;
  const hit = shantenCache.get(key);
  if (hit !== undefined) return hit;
  let best = shanten(counts, meldCount);
  for (const w of candidateKinds(counts, own)) {
    counts[w]++;
    const s = shanten(counts, meldCount);
    counts[w]--;
    if (s < best) best = s;
    if (best === -1) break;
  }
  return remember(shantenCache, key, best);
}

/**
 * オールマイティ込みの待ち（実際の牌の種類）。counts は 3n 枚（ツモ前）の純手牌。
 * 待ち t が成立するのは、t を加えた手にオールマイティ w を足して和了形になる w があるとき。
 */
export function mightyWaitingKinds(counts: number[], meldCount: number, own: number[]): Kind[] {
  const key = `${counts.join("")}|${meldCount}|${own.join("")}`;
  const hit = waitCache.get(key);
  if (hit) return hit;
  const out = new Set<Kind>();
  const ws = candidateKinds(counts, own);
  // 和了牌 t の候補も、関係のある牌種だけ（関係のない牌はオールマイティと対子にするしかなく、それは t の候補に含まれる）
  const ts = new Set<Kind>(ws);
  for (let k = 0; k < NUM_KINDS; k++) if (counts[k] > 0 && !isSanmaRemoved(k)) ts.add(k);
  for (const w of ws) {
    counts[w]++;
    for (const t of ts) {
      if (out.has(t) || counts[t] >= 4) continue;
      // オールマイティは、和了牌も含めて自分の5枚目にはなれない
      if (t === w && own[w] + 1 >= 4) continue;
      counts[t]++;
      if (isAgariFast(counts, meldCount)) out.add(t);
      counts[t]--;
    }
    counts[w]--;
  }
  // 単騎：持っていない牌 t をツモって、オールマイティを t にして対子にする形
  for (let t = 0; t < NUM_KINDS; t++) {
    if (out.has(t) || counts[t] > 0 || isSanmaRemoved(t) || own[t] + 1 >= 4) continue;
    counts[t] += 2;
    if (isAgariFast(counts, meldCount)) out.add(t);
    counts[t] -= 2;
  }
  return remember(waitCache, key, [...out].sort((a, b) => a - b));
}

/** 面子だけに分けられるか（各色を小さい数から順に、順子を優先して取る方法で判定できる） */
function setsOnly(c: number[]): boolean {
  for (let s = 0; s < 3; s++) {
    const a = c.slice(s * 9, s * 9 + 9);
    for (let i = 0; i < 9; i++) {
      const r = a[i] % 3;
      if (r === 0) continue;
      if (i > 6 || a[i + 1] < r || a[i + 2] < r) return false;
      a[i + 1] -= r;
      a[i + 2] -= r;
    }
  }
  for (let k = 27; k < NUM_KINDS; k++) if (c[k] % 3 !== 0) return false;
  return true;
}

/** 和了形かどうか（向聴数の計算より速い判定） */
function isAgariFast(c: number[], meldCount: number): boolean {
  let total = 0;
  for (const x of c) total += x;
  if (total % 3 !== 2) return false;
  if (meldCount === 0 && total === 14) {
    let pairs = 0;
    for (const x of c) if (x === 2) pairs++;
    if (pairs === 7) return true;
    if (kokushiShanten(c) === -1) return true;
  }
  for (let p = 0; p < NUM_KINDS; p++) {
    if (c[p] < 2) continue;
    c[p] -= 2;
    const ok = setsOnly(c);
    c[p] += 2;
    if (ok) return true;
  }
  return false;
}

/** 和了形にできるオールマイティの牌種の一覧（和了牌を加えた後の純手牌 counts、自分の牌すべて own） */
export function mightyAgariKinds(counts: number[], meldCount: number, own: number[]): Kind[] {
  const out: Kind[] = [];
  for (let w = 0; w < NUM_KINDS; w++) {
    if (own[w] >= 4 || isSanmaRemoved(w)) continue;
    counts[w]++;
    if (isAgariFast(counts, meldCount)) out.push(w);
    counts[w]--;
  }
  return out;
}
