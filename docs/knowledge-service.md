# Knowledge service — how it works, who uses it, how to swap the vectorizer

This is a consumer-focused map of `packages/core/src/knowledge/`: what each piece
does, exactly which callers use which function and when, and a recipe for
plugging in a different embedding/vectorizing package. For the broader
architecture (agents, orchestrator, server) see [TECHNICAL.md](TECHNICAL.md)
§7–8, which this doc complements rather than replaces.

## 1. File map

```
packages/core/src/knowledge/
  bm25.ts        tokenizer + BM25Index — zero-dependency keyword retrieval
  embeddings.ts  EmbeddingProvider interface + local transformers.js embedder
  store.ts       KnowledgeStore — in-memory index (BM25 or cosine) + file persistence
  ingest.ts      markdown/txt file parsing + chunking → KnowledgeChunk[]
  retriever.ts   KnowledgeRetriever facade + buildKnowledge() bootstrap
  learned.ts     LearnedKnowledgeStore — admin-approved knowledge, separate from the corpus
  index.ts       barrel export (re-exports all of the above)

packages/core/src/schemas/knowledge.ts   KnowledgeChunk / RetrievalResult / RetrievalLogEntry (zod)
packages/core/src/state/knowledge-overrides.ts   durable disable/enable list
packages/core/src/state/retrieval-log.ts         JSONL log + knowledge-gap analysis
packages/core/src/agents/base.ts                 ground() / knowledgeBlock() — how agents consume it
```

Everything downstream imports from `@bpmn-analyst/core`, which re-exports the
`knowledge/index.ts` barrel — so `import { buildKnowledge, KnowledgeRetriever, learnedToChunk } from "@bpmn-analyst/core"` is the normal way in, not deep imports into `knowledge/*`.

## 2. Data model

```ts
// schemas/knowledge.ts
KnowledgeChunk { id, docId, docTitle, kind, text, embedding: number[], tags: string[] }
RetrievalResult { chunk: KnowledgeChunk, score: number }
RetrievalLogEntry { at, sessionId, phase, query, topScore, chunkIds[] }
```

`kind` is one of `bpmn_guideline | validation | domain | glossary | other`
([schemas/knowledge.ts:9-16](../packages/core/src/schemas/knowledge.ts)). `embedding`
is `[]` when a chunk was never vectorized (pure keyword retrieval).

## 3. Core building blocks — how it's implemented

- **`Bm25Index`** ([bm25.ts](../packages/core/src/knowledge/bm25.ts)) — pure-TS,
  unicode-aware (works for Persian and English) BM25 scorer. This is the
  zero-dependency default; no package or network call needed.
- **`EmbeddingProvider`** ([embeddings.ts](../packages/core/src/knowledge/embeddings.ts)) —
  the entire vectorizer contract:
  ```ts
  interface EmbeddingProvider {
    readonly name: string;
    readonly dimension: number;
    embed(texts: string[]): Promise<number[][]>;
  }
  ```
  `createLocalEmbedder()` is the only implementation today: it dynamically
  `import()`s `@huggingface/transformers` (optional peer dep, not installed by
  default) and runs `Xenova/all-MiniLM-L6-v2` (384-dim) locally, offline, free.
  `cosineSimilarity(a, b)` is the matching similarity function used at query time.
- **`KnowledgeStore`** ([store.ts](../packages/core/src/knowledge/store.ts)) — the
  in-memory index. Holds `chunks[]`, a `Bm25Index`, and a `disabled` id set.
  - `addChunks(chunks)` — if an embedder is configured, embeds any chunk with
    `embedding.length === 0` (best-effort: embedding failure silently falls back
    to BM25), then indexes every chunk into both the array and the BM25 index.
  - `search(query, k, filter)` — if an embedder exists **and** at least one
    chunk in the filtered pool actually has a vector, does cosine search over
    vectors; otherwise (or on embedder failure) falls back to BM25. This is a
    **per-query, per-pool decision** — a store can serve semantic results for
    one filter and BM25 for another if only some chunks were embedded.
  - `save(path)` / `KnowledgeStore.load(path, embedder?)` — flat JSON
    persistence of `{ chunks }`. **The `disabled` set is not part of this file**
    — see `KnowledgeOverridesStore` below.
- **`ingestDirectory(dir, store, opts)`** ([ingest.ts](../packages/core/src/knowledge/ingest.ts)) —
  reads every `.md`/`.txt`/`.markdown` file in `dir`, parses optional
  `--- title/kind/tags ---` frontmatter, splits body into paragraph-bounded
  chunks (`chunkSize` chars target, `overlap` paragraphs carried into the next
  chunk), and calls `store.addChunks(...)` per file.
- **`KnowledgeRetriever`** ([retriever.ts](../packages/core/src/knowledge/retriever.ts)) —
  the **only surface agents/server touch**; wraps a `KnowledgeStore`:
  - `retrieve(query, k=4, filter?)` → `RetrievalResult[]` (`[]` if the store is empty)
  - `retrieveContext(query, k, filter?)` → same, pre-formatted as a prompt string
  - `addChunks` / `removeChunk` / `disable` / `enable` / `isDisabled` / `allChunks` — pass straight through to the store, used by the admin layer
  - `formatContext(results)` (standalone export) renders `[i] (kind) docTitle\n<text>` blocks joined by `\n\n---\n\n`
- **`buildKnowledge(opts)`** (also in retriever.ts) — the bootstrap entry point:
  1. if `opts.useEmbeddings`, tries `createLocalEmbedder()`; **warns and
     continues without it** if the package isn't installed (never throws).
  2. if `!opts.rebuild` and `opts.indexPath` exists → loads the cached JSON index.
  3. otherwise → fresh `KnowledgeStore`, `ingestDirectory(opts.knowledgeDir, ...)`, saves the index (if non-empty).
  4. returns a `KnowledgeRetriever` wrapping the store.
- **`LearnedKnowledgeStore`** ([learned.ts](../packages/core/src/knowledge/learned.ts)) —
  a *separate* source of truth (`data/learned-knowledge.json`) for admin-approved
  knowledge extracted from session feedback. Kept apart from the markdown corpus
  so entries carry provenance (`sources[]`, `weight`) and can be individually
  removed. `learnedToChunk(entry)` converts an entry to a `KnowledgeChunk` (chunk
  id = entry id) for injection into the live retriever.

## 4. Who uses it, when, and how — consumer map

All analysis agents receive an `AgentContext` ([agents/base.ts](../packages/core/src/agents/base.ts)):

```ts
interface AgentContext {
  llm: LLMProvider;                 // required
  retriever?: KnowledgeRetriever;   // optional — grounding is a no-op without it
  onRetrieve?(results, query): void;
  logRetrieval?(entry): void;
  exampleBank?: ExampleBank;
  behavior?: BehaviorLookup;
}
```

Agents never import `knowledge/*` directly. They call two helpers from `base.ts`:

- **`ground(ctx, query, k=4, filter?)`** — returns `""` if `ctx.retriever` is
  unset; otherwise calls `ctx.retriever.retrieve(query, k, filter)`, fires
  `ctx.onRetrieve?.(results, query)` for provenance, and returns
  `formatContext(results)`. Swallows retrieval errors → `""`.
- **`knowledgeBlock(text)`** — wraps non-empty grounding text in a Persian
  "reference knowledge" prompt block; returns `""` when there's nothing to show.

Every agent follows the same pattern: `ground()` → `knowledgeBlock()` → splice
into the system prompt array before `sessionDigest(session)`.

| Agent (phase) | File | Query fed to `ground()` | k | Filter |
|---|---|---|---|---|
| Actors | [actors.ts:22-27](../packages/core/src/agents/actors.ts) | `نقش‌های دخیل در {request} در سامانه دانشگاهی` | 3 | `kind === "glossary" \|\| kind === "domain"` — anchors role naming to terminology docs so lane names stay consistent |
| Business rules | [business-rules.ts:23](../packages/core/src/agents/business-rules.ts) | `قوانین کسب‌وکار برای {request}` | 3 | none |
| Implicit knowledge | [implicit.ts:26-30](../packages/core/src/agents/implicit.ts) | `دانش ضمنی و قوانین رایج و best practice برای {request} در سامانه دانشگاهی` | 5 | none |
| Elicitation | [elicitation.ts:39](../packages/core/src/agents/elicitation.ts) | `{request}\nنقش‌ها و مراحل و قوانین فرآیند` | 3 | none |
| Contradiction | [contradiction.ts:29](../packages/core/src/agents/contradiction.ts) | `قوانین و ترتیب صحیح فرآیند {request}` | 3 | none |
| Logical model | [logical-model.ts:43-47](../packages/core/src/agents/logical-model.ts) | `اصول مدل‌سازی BPMN: رویداد شروع و پایان، gateway، lane، جریان توالی برای {request}` | 5 | none |
| Reviewer | [reviewer.ts:28](../packages/core/src/agents/reviewer.ts) | `چک‌لیست اعتبارسنجی و اصول مدل‌سازی BPMN` (static, not per-request) | 4 | none |
| Feedback extractor | [feedback-extractor.ts](../packages/core/src/agents/feedback-extractor.ts) | — | — | **receives `ctx.retriever` from admin-routes.ts:143 but never calls `ground()` — dead wiring today**, not a bug to fix blindly, just don't assume it grounds |

Two **non-agent** consumers call the retriever directly (bypassing `ground()`
because they don't build an LLM system prompt):

- **`similarChunks()`** in [admin-routes.ts:73-98](../packages/server/src/admin-routes.ts) —
  `ctx.retriever.retrieve(statement, 3)` to find near-duplicate/conflicting
  chunks when an admin is about to approve a learned-knowledge candidate; the
  top hit is additionally passed through `runConflictCheck` (an LLM call) to
  distinguish overlap from contradiction.
- **`knowledge.test.ts` / `smoke.ts`** — direct `buildKnowledge(...)` +
  `kb.retrieve(query, 1)` for tests/manual probing, no server involved.

## 5. Server wiring — lifecycle and injection order

[app.ts:51-80](../packages/server/src/app.ts), in order:

1. `buildKnowledge({ knowledgeDir, indexPath })` — loads/builds the base
   markdown-corpus index (embeddings off by default; server never sets
   `useEmbeddings: true` today — see §7).
2. `LearnedKnowledgeStore.load(learnedPath)` then
   `retriever.addChunks(learned.list().map(learnedToChunk))` — admin-approved
   knowledge is layered on top of the base index, in memory, every boot.
3. `KnowledgeOverridesStore.load(overridesPath)` then `retriever.disable(id)`
   for each — **must run after step 2** because disables are keyed by chunk id
   and apply to both base and learned chunks; the store's own `disabled` set
   isn't persisted (it's a rebuildable cache), so this file is the durable
   record re-applied every startup.
4. One `KnowledgeRetriever` instance is shared: put into `AppContext.retriever`
   (for admin routes) and into `new Orchestrator({ retriever, logRetrieval, ... })`
   (for agent turns). Same object — mutations via admin routes (`addChunks`,
   `removeChunk`, `disable`/`enable`) are visible to the next agent turn
   immediately, no reload needed.

The **orchestrator** ([orchestrator.ts:67-83](../packages/core/src/agents/orchestrator.ts))
wraps the shared context per session/turn with `onRetrieve`, which does two
things on every `ground()` hit: `recordCitations(session, results)` (dedup by
chunk id, stored on the session for the UI/admin "was this helpful" flow) and
`logRetrieval(entry)` → appended to `data/retrieval-log.jsonl`. That log is what
`computeGaps()` ([retrieval-log.ts](../packages/core/src/state/retrieval-log.ts))
mines for "queries the knowledge base couldn't ground" — the admin's signal for
which doc to write next.

## 6. Recipe: ground a new agent/service in the knowledge base

1. Accept `ctx: AgentContext` (or at minimum `{ retriever?: KnowledgeRetriever }`).
2. `const grounding = await ground(ctx, queryText, k, filter?);`
   - Write `queryText` as a natural-language description of what you want
     retrieved, in the same language as the corpus (Persian, per existing docs)
     — BM25 and the local embedder both tokenize whatever you pass, no special
     query syntax.
   - Pass a `filter: (c: KnowledgeChunk) => boolean` only if you need to
     restrict by `kind`/`tags` (see the Actors row above for the pattern).
3. `system.push(knowledgeBlock(grounding))` before the rest of the prompt.
4. If this runs inside the orchestrator's per-turn context, citations/telemetry
   are automatic via `onRetrieve`. If it's a standalone call (like
   `similarChunks`), you get raw `RetrievalResult[]` back — no logging happens
   unless you wire it yourself.

Don't reach into `KnowledgeStore` or `Bm25Index` directly — always go through
`KnowledgeRetriever`; that's the intentional seam.

## 7. Recipe: swap in a different vectorizing/embedding package

The **only** contract to satisfy is `EmbeddingProvider`
([embeddings.ts:6-10](../packages/core/src/knowledge/embeddings.ts)):

```ts
interface EmbeddingProvider {
  readonly name: string;
  readonly dimension: number;
  embed(texts: string[]): Promise<number[][]>;   // batch in, same-order vectors out
}
```

Nothing in `KnowledgeStore`, `KnowledgeRetriever`, or `buildKnowledge` cares
*how* vectors are produced — `store.search` just calls `cosineSimilarity` on
whatever numbers come back. To plug in e.g. an OpenAI/Voyage/Cohere hosted
embeddings API, a different local model, or a real vector DB's client SDK:

1. **Write a provider function**, mirroring `createLocalEmbedder()`'s shape:
   ```ts
   export async function createOpenAIEmbedder(apiKey: string, model = "text-embedding-3-small"): Promise<EmbeddingProvider> {
     return {
       name: `openai:${model}`,
       dimension: 1536,
       async embed(texts) {
         const res = await fetch("https://api.openai.com/v1/embeddings", {
           method: "POST",
           headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
           body: JSON.stringify({ model, input: texts }),
         });
         const data = await res.json();
         return data.data.map((d: { embedding: number[] }) => d.embedding);
       },
     };
   }
   ```
   Put it in `embeddings.ts` (or a new sibling file re-exported from
   `knowledge/index.ts`) so it's available through the `@bpmn-analyst/core` barrel.
2. **Wire it into `buildKnowledge`**: today `useEmbeddings: true` always calls
   `createLocalEmbedder()` ([retriever.ts:77-84](../packages/core/src/knowledge/retriever.ts)).
   To make the provider swappable, either add an `embedder?: EmbeddingProvider`
   option to `BuildKnowledgeOptions` and pass your instance from
   [app.ts](../packages/server/src/app.ts) directly (bypassing `useEmbeddings`
   entirely), or branch inside `buildKnowledge` on an env var/config flag. The
   former is less invasive — `buildKnowledge` already accepts everything it
   needs; you're just supplying a different `EmbeddingProvider` value at the
   call site in `app.ts` instead of relying on the built-in local one.
3. **Rebuild the index after switching providers.** Vectors from different
   models/dimensions aren't comparable — `cosineSimilarity` will happily
   compute garbage across mismatched dimensions (it just uses
   `Math.min(a.length, b.length)`, no error). `buildKnowledge` only re-embeds
   chunks with `embedding.length === 0`, so an existing `data/knowledge-index.json`
   built with the old provider will **not** be automatically re-vectorized —
   delete the index file or pass `rebuild: true` whenever you change embedder.
4. **If replacing the whole retrieval strategy** (e.g. delegating to an actual
   vector DB like pgvector/Pinecone/Qdrant instead of the in-memory
   `KnowledgeStore`), the swap point is one level up: implement a class with
   the same public surface as `KnowledgeStore.search`/`addChunks`/`removeChunk`
   and have `KnowledgeRetriever` hold that instead — the retriever's
   constructor already treats the store as an opaque dependency
   (`constructor(private readonly store: KnowledgeStore)`), so this is a
   type-widening change (`store: KnowledgeStore | VectorDbStore` or a shared
   interface), not a rewrite of any agent or route.
5. Nothing in `packages/server` or `packages/core/agents` needs to change —
   they only ever call `KnowledgeRetriever` methods.

### Gotchas

- `KnowledgeStore.search` only goes semantic if **at least one chunk in the
  filtered pool has a vector**; a partially-embedded corpus silently mixes
  strategies per query. If you're mid-migration to a new embedder, expect
  inconsistent retrieval mode until every chunk is re-embedded.
- Embedding failures inside `addChunks`/`search` are swallowed (falls back to
  BM25/no-op) — a broken API key or network outage degrades quietly rather than
  erroring. Check `[knowledge] embeddings disabled: ...` console warnings if
  semantic search seems to not be happening.
- The `disabled` set and `LearnedKnowledgeStore` are independent of whatever
  embedder/store you use — no changes needed there when swapping vectorizers.
