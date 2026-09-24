import { NUM_KINDS, YAOCHU_KINDS, type Kind } from "./tiles.ts";

// 向聴数の計算。counts は純手牌（鳴いた牌を除く）の牌種ごとの枚数。
// meldCount は副露（暗槓を含む）の数。-1 = 和了形、0 = 聴牌。

type MT = [number, number]; // [面子数, 塔子数]

const suitCache = new Map<string, MT[]>();

function suitPatterns(c: number[]): MT[] {
  const key = c.join("");
  const cached = suitCache.get(key);
  if (cached) return cached;
  const found = new Set<string>();
  const out: MT[] = [];
  const work = c.slice();
  const dfs = (i: number, m: number, t: number) => {
    while (i < 9 && work[i] === 0) i++;
    if (i >= 9) {
      const k = `${m},${t}`;
      if (!found.has(k)) {
        found.add(k);
        out.push([m, t]);
      }
      return;
    }
    if (work[i] >= 3) {
      work[i] -= 3;
      dfs(i, m + 1, t);
      work[i] += 3;
    }
    if (i <= 6 && work[i + 1] > 0 && work[i + 2] > 0) {
      work[i]--;
      work[i + 1]--;
      work[i + 2]--;
      dfs(i, m + 1, t);
      work[i]++;
      work[i + 1]++;
      work[i + 2]++;
    }
    if (work[i] >= 2) {
      work[i] -= 2;
      dfs(i, m, t + 1);
      work[i] += 2;
    }
    if (i <= 7 && work[i + 1] > 0) {
      work[i]--;
      work[i + 1]--;
      dfs(i, m, t + 1);
      work[i]++;
      work[i + 1]++;
    }
    if (i <= 6 && work[i + 2] > 0) {
      work[i]--;
      work[i + 2]--;
      dfs(i, m, t + 1);
      work[i]++;
      work[i + 2]++;
    }
    work[i]--;
    dfs(i, m, t);
    work[i]++;
  };
  dfs(0, 0, 0);
  // パレート最適なものだけ残す
  const pruned = out.filter(
    ([m, t]) => !out.some(([m2, t2]) => m2 >= m && m2 + t2 >= m + t && (m2 > m || m2 + t2 > m + t)),
  );
  suitCache.set(key, pruned);
  return pruned;
}

function shantenNoPair(counts: number[], meldCount: number, hasPair: boolean): number {
  let best = 8;
  const s0 = suitPatterns(counts.slice(0, 9));
  const s1 = suitPatterns(counts.slice(9, 18));
  const s2 = suitPatterns(counts.slice(18, 27));
  let hm = 0;
  let ht = 0;
  for (let k = 27; k < NUM_KINDS; k++) {
    if (counts[k] >= 3) hm++;
    else if (counts[k] === 2) ht++;
  }
  for (const [m0, t0] of s0)
    for (const [m1, t1] of s1)
      for (const [m2, t2] of s2) {
        const m = m0 + m1 + m2 + hm + meldCount;
        const t = t0 + t1 + t2 + ht;
        const usable = Math.min(t, 4 - m);
        const s = 8 - 2 * m - Math.max(0, usable) - (hasPair ? 1 : 0);
        if (s < best) best = s;
      }
  return best;
}

export function standardShanten(counts: number[], meldCount: number): number {
  let best = shantenNoPair(counts, meldCount, false);
  for (let k = 0; k < NUM_KINDS; k++) {
    if (counts[k] >= 2) {
      counts[k] -= 2;
      const s = shantenNoPair(counts, meldCount, true);
      counts[k] += 2;
      if (s < best) best = s;
    }
  }
  return best;
}

export function chiitoiShanten(counts: number[]): number {
  let pairs = 0;
  let kinds = 0;
  for (let k = 0; k < NUM_KINDS; k++) {
    if (counts[k] > 0) kinds++;
    if (counts[k] >= 2) pairs++;
  }
  return 6 - pairs + Math.max(0, 7 - kinds);
}

export function kokushiShanten(counts: number[]): number {
  let kinds = 0;
  let pair = false;
  for (const k of YAOCHU_KINDS) {
    if (counts[k] > 0) kinds++;
    if (counts[k] >= 2) pair = true;
  }
  return 13 - kinds - (pair ? 1 : 0);
}

export function shanten(counts: number[], meldCount: number): number {
  let s = standardShanten(counts, meldCount);
  if (meldCount === 0) {
    s = Math.min(s, chiitoiShanten(counts), kokushiShanten(counts));
  }
  return s;
}

export function isAgariCounts(counts: number[], meldCount: number): boolean {
  return shanten(counts, meldCount) === -1;
}

/**
 * 待ち牌（牌種）の一覧。counts は 3n+1 枚の純手牌。
 * 純手牌で4枚使っている牌は待ちにならない（5枚目待ちは、純手牌で4枚使っていなければ成立）。
 */
export function waitingKinds(counts: number[], meldCount: number): Kind[] {
  const out: Kind[] = [];
  for (let k = 0; k < NUM_KINDS; k++) {
    if (counts[k] >= 4) continue;
    counts[k]++;
    if (isAgariCounts(counts, meldCount)) out.push(k);
    counts[k]--;
  }
  return out;
}

export function isTenpai(counts: number[], meldCount: number): boolean {
  return waitingKinds(counts, meldCount).length > 0;
}
