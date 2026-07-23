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
  /** Chunks hidden from retrieval but kept in memory so they can be re-enabled. */
  private disabled = new Set<string>();

  constructor(private readonly embedder?: EmbeddingProvider) {}

  get size(): number {
    return this.chunks.length;
  }

  /** Hide a chunk from retrieval without deleting it (reversible via `enable`). */
  disable(id: string): boolean {
    if (!this.byId.has(id)) return false;
    this.disabled.add(id);
    return true;
  }

  /** Un-hide a previously disabled chunk. */
  enable(id: string): boolean {
    return this.disabled.delete(id);
  }

  isDisabled(id: string): boolean {
    return this.disabled.has(id);
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

  /** Remove a chunk by id. BM25 is rebuilt (cheap at this corpus size). */
  removeChunk(id: string): boolean {
    const idx = this.chunks.findIndex((c) => c.id === id);
    if (idx === -1) return false;
    this.chunks.splice(idx, 1);
    this.byId.delete(id);
    this.bm25 = new Bm25Index();
    for (const c of this.chunks) this.bm25.add(c.id, `${c.docTitle}\n${c.text}`);
    return true;
  }

  async search(query: string, k = 4, filter?: ChunkFilter): Promise<RetrievalResult[]> {
    const admit = (c: KnowledgeChunk) => !this.disabled.has(c.id) && (!filter || filter(c));
    const pool = this.chunks.filter(admit);
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
      if (chunk && admit(chunk)) results.push({ chunk, score: r.score });
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
