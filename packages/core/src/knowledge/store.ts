import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { KnowledgeChunk, RetrievalResult } from "../schemas/knowledge.js";
import { Bm25Index } from "./bm25.js";
import { cosineSimilarity, type EmbeddingProvider } from "./embeddings.js";

export type ChunkFilter = (chunk: KnowledgeChunk) => boolean;

/**
 * In-memory knowledge store with file persistence. Uses semantic (cosine)
 * retrieval when an embedder is supplied and chunks carry vectors; otherwise
 * falls back to BM25 keyword search. This is the swappable point for a real
 * vector DB later.
 */
export class KnowledgeStore {
  private chunks: KnowledgeChunk[] = [];
  private bm25 = new Bm25Index();
  private byId = new Map<string, KnowledgeChunk>();

  constructor(private readonly embedder?: EmbeddingProvider) {}

  get size(): number {
    return this.chunks.length;
  }

  private index(chunk: KnowledgeChunk): void {
    this.chunks.push(chunk);
    this.byId.set(chunk.id, chunk);
    this.bm25.add(chunk.id, `${chunk.docTitle}\n${chunk.text}`);
  }

  /** Add chunks, embedding them if an embedder is configured (best-effort). */
  async addChunks(chunks: KnowledgeChunk[]): Promise<void> {
    if (this.embedder) {
      const pending = chunks.filter((c) => c.embedding.length === 0);
      if (pending.length > 0) {
        try {
          const vectors = await this.embedder.embed(pending.map((c) => c.text));
          pending.forEach((c, i) => {
            c.embedding = vectors[i] ?? [];
          });
        } catch {
          /* embedding unavailable → keyword retrieval still works */
        }
      }
    }
    for (const c of chunks) this.index(c);
  }

  async search(query: string, k = 4, filter?: ChunkFilter): Promise<RetrievalResult[]> {
    const pool = filter ? this.chunks.filter(filter) : this.chunks;
    const canSemantic = this.embedder && pool.some((c) => c.embedding.length > 0);

    if (this.embedder && canSemantic) {
      try {
        const [q] = await this.embedder.embed([query]);
        if (q) {
          return pool
            .filter((c) => c.embedding.length > 0)
            .map((chunk) => ({ chunk, score: cosineSimilarity(q, chunk.embedding) }))
            .sort((a, b) => b.score - a.score)
            .slice(0, k);
        }
      } catch {
        /* fall through to keyword */
      }
    }

    const results: RetrievalResult[] = [];
    for (const r of this.bm25.search(query, k * 3)) {
      const chunk = this.byId.get(r.id);
      if (chunk && (!filter || filter(chunk))) results.push({ chunk, score: r.score });
      if (results.length >= k) break;
    }
    return results;
  }

  toArray(): KnowledgeChunk[] {
    return this.chunks;
  }

  async save(path: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ chunks: this.chunks }, null, 0), "utf8");
  }

  static async load(path: string, embedder?: EmbeddingProvider): Promise<KnowledgeStore> {
    const store = new KnowledgeStore(embedder);
    const raw = await readFile(path, "utf8");
    const data = JSON.parse(raw) as { chunks: KnowledgeChunk[] };
    for (const c of data.chunks) store.index(c);
    return store;
  }
}
