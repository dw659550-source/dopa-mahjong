// 再現可能な乱数（mulberry32）

export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 複数の数値から 0〜1 の擬似乱数を作る（同じ入力なら同じ値） */
export function hashUnit(...parts: number[]): number {
  let h = 2166136261;
  for (const p of parts) {
    const v = Math.floor(p) | 0;
    for (let i = 0; i < 4; i++) {
      h ^= (v >>> (i * 8)) & 0xff;
      h = Math.imul(h, 16777619);
    }
  }
  return mulberry32(h)();
}

export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
