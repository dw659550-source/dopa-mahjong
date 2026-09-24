import { NUM_KINDS, YAOCHU_KINDS, type Kind } from "./tiles.ts";

// 和了形の分解（役判定用）。counts は和了牌を含む純手牌。

export interface ConcealedSet {
  type: "seq" | "trip"; // 順子（kindは先頭）/ 刻子
  kind: Kind;
}

export interface StandardDecomposition {
  form: "standard";
  pair: Kind;
  sets: ConcealedSet[];
}

export interface ChiitoiDecomposition {
  form: "chiitoi";
  pairs: Kind[];
}

export interface KokushiDecomposition {
  form: "kokushi";
  pair: Kind;
}

export type Decomposition = StandardDecomposition | ChiitoiDecomposition | KokushiDecomposition;

function decomposeSets(counts: number[], start: number, acc: ConcealedSet[], out: ConcealedSet[][]) {
  let i = start;
  while (i < NUM_KINDS && counts[i] === 0) i++;
  if (i >= NUM_KINDS) {
    out.push(acc.slice());
    return;
  }
  if (counts[i] >= 3) {
    counts[i] -= 3;
    acc.push({ type: "trip", kind: i });
    decomposeSets(counts, i, acc, out);
    acc.pop();
    counts[i] += 3;
  }
  if (i < 27 && i % 9 <= 6 && counts[i + 1] > 0 && counts[i + 2] > 0) {
    counts[i]--;
    counts[i + 1]--;
    counts[i + 2]--;
    acc.push({ type: "seq", kind: i });
    decomposeSets(counts, i, acc, out);
    acc.pop();
    counts[i]++;
    counts[i + 1]++;
    counts[i + 2]++;
  }
}

export function decompose(countsIn: number[], meldCount: number): Decomposition[] {
  const counts = countsIn.slice();
  const total = counts.reduce((a, b) => a + b, 0);
  const result: Decomposition[] = [];
  if (total !== 14 - meldCount * 3) return result;

  for (let p = 0; p < NUM_KINDS; p++) {
    if (counts[p] < 2) continue;
    counts[p] -= 2;
    const outs: ConcealedSet[][] = [];
    decomposeSets(counts, 0, [], outs);
    counts[p] += 2;
    for (const sets of outs) {
      if (sets.length === 4 - meldCount) result.push({ form: "standard", pair: p, sets });
    }
  }

  if (meldCount === 0) {
    const pairs: Kind[] = [];
    for (let k = 0; k < NUM_KINDS; k++) if (counts[k] === 2) pairs.push(k);
    if (pairs.length === 7) result.push({ form: "chiitoi", pairs });

    let ok = true;
    let pair = -1;
    for (const k of YAOCHU_KINDS) {
      if (counts[k] === 0) ok = false;
      if (counts[k] === 2) pair = k;
    }
    if (ok && pair >= 0 && total === 14) result.push({ form: "kokushi", pair });
  }
  return result;
}
