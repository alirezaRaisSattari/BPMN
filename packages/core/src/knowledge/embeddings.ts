/**
 * Embedding abstraction. The base system uses BM25 keyword retrieval and needs
 * no embedder. An optional local embedder (transformers.js) can be plugged in
 * for semantic search — swappable for a hosted embeddings API or vector DB later.
 */
export interface EmbeddingProvider {
  readonly name: string;
  readonly dimension: number;
  embed(texts: string[]): Promise<number[][]>;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Local, free, offline embedder using @huggingface/transformers (all-MiniLM-L6-v2).
 * Dynamically imported so the dependency is OPTIONAL — install it and set
 * KNOWLEDGE_EMBEDDINGS=on to enable semantic retrieval.
 */
export async function createLocalEmbedder(
  model = "Xenova/all-MiniLM-L6-v2",
): Promise<EmbeddingProvider> {
  // Computed specifier so TS/bundlers don't require the optional dep at build time.
  const pkg = "@huggingface/transformers";
  const mod = (await import(pkg).catch(() => {
    throw new Error(
      "Semantic embeddings requested but '@huggingface/transformers' is not installed. " +
        "Run: npm i @huggingface/transformers -w @bpmn-analyst/core",
    );
  })) as { pipeline: (task: string, model: string) => Promise<unknown> };

  const extractor = (await mod.pipeline("feature-extraction", model)) as (
    input: string[],
    opts: { pooling: string; normalize: boolean },
  ) => Promise<{ tolist(): number[][] }>;

  return {
    name: `local:${model}`,
    dimension: 384,
    async embed(texts: string[]): Promise<number[][]> {
      const out = await extractor(texts, { pooling: "mean", normalize: true });
      return out.tolist();
    },
  };
}
