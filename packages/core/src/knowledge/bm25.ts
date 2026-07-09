/**
 * Tiny BM25 keyword scorer (pure TS, unicode-aware — works for Persian & English).
 * Used as the zero-dependency default retrieval strategy.
 */

const TOKEN_RE = /[\p{L}\p{N}]+/gu;

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(TOKEN_RE) ?? []).filter((t) => t.length > 1);
}

export interface Bm25Doc {
  id: string;
  tokens: string[];
}

export class Bm25Index {
  private readonly docs: Bm25Doc[] = [];
  private readonly df = new Map<string, number>();
  private avgLen = 0;

  constructor(
    private readonly k1 = 1.5,
    private readonly b = 0.75,
  ) {}

  add(id: string, text: string): void {
    const tokens = tokenize(text);
    this.docs.push({ id, tokens });
    for (const term of new Set(tokens)) this.df.set(term, (this.df.get(term) ?? 0) + 1);
    const total = this.docs.reduce((s, d) => s + d.tokens.length, 0);
    this.avgLen = total / this.docs.length;
  }

  /** Returns doc ids with scores, highest first. */
  search(query: string, k: number): Array<{ id: string; score: number }> {
    const qTerms = tokenize(query);
    const N = this.docs.length;
    const scored = this.docs.map((doc) => {
      const tf = new Map<string, number>();
      for (const t of doc.tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      let score = 0;
      for (const term of qTerms) {
        const f = tf.get(term);
        if (!f) continue;
        const n = this.df.get(term) ?? 0;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        const denom = f + this.k1 * (1 - this.b + (this.b * doc.tokens.length) / this.avgLen);
        score += idf * ((f * (this.k1 + 1)) / denom);
      }
      return { id: doc.id, score };
    });
    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
}
