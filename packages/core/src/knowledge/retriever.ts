import { existsSync } from "node:fs";
import type { RetrievalResult } from "../schemas/knowledge.js";
import { createLocalEmbedder, type EmbeddingProvider } from "./embeddings.js";
import { ingestDirectory, type IngestOptions } from "./ingest.js";
import { KnowledgeStore, type ChunkFilter } from "./store.js";

/** High-level retrieval facade consumed by the analysis agents. */
export class KnowledgeRetriever {
  constructor(private readonly store: KnowledgeStore) {}

  get size(): number {
    return this.store.size;
  }

  retrieve(query: string, k = 4, filter?: ChunkFilter): Promise<RetrievalResult[]> {
    if (this.store.size === 0) return Promise.resolve([]);
    return this.store.search(query, k, filter);
  }

  /** Retrieve and format results as a compact context block for prompts. */
  async retrieveContext(query: string, k = 4, filter?: ChunkFilter): Promise<string> {
    const results = await this.retrieve(query, k, filter);
    return formatContext(results);
  }
}

export function formatContext(results: RetrievalResult[]): string {
  if (results.length === 0) return "";
  return results
    .map((r, i) => `[${i + 1}] (${r.chunk.kind}) ${r.chunk.docTitle}\n${r.chunk.text}`)
    .join("\n\n---\n\n");
}

export interface BuildKnowledgeOptions extends IngestOptions {
  knowledgeDir: string;
  indexPath: string;
  /** Force a rebuild even if an index file exists. */
  rebuild?: boolean;
  /** Enable semantic embeddings (requires @huggingface/transformers). */
  useEmbeddings?: boolean;
}

/**
 * Build (or load) the knowledge index. On first run it ingests `knowledgeDir`
 * and writes the index to `indexPath`; subsequent runs load the cached index.
 */
export async function buildKnowledge(opts: BuildKnowledgeOptions): Promise<KnowledgeRetriever> {
  let embedder: EmbeddingProvider | undefined;
  if (opts.useEmbeddings) {
    try {
      embedder = await createLocalEmbedder();
    } catch (err) {
      console.warn(`[knowledge] embeddings disabled: ${err instanceof Error ? err.message : err}`);
    }
  }

  if (!opts.rebuild && existsSync(opts.indexPath)) {
    const store = await KnowledgeStore.load(opts.indexPath, embedder);
    return new KnowledgeRetriever(store);
  }

  const store = new KnowledgeStore(embedder);
  const { files, chunks } = await ingestDirectory(opts.knowledgeDir, store, opts);
  if (chunks > 0) await store.save(opts.indexPath);
  console.log(`[knowledge] ingested ${files} file(s), ${chunks} chunk(s)`);
  return new KnowledgeRetriever(store);
}
