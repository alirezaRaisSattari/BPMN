# BPMN Analyst AI — Technical Documentation

> An AI Business-Analyst that turns a vague, natural-language request into a valid
> **BPMN 2.0** model plus supporting documentation. It runs a multi-phase
> "interview", extracts requirements, proposes implicit domain knowledge, detects
> ambiguity and contradictions, builds a logical process model, and compiles it to
> laid-out BPMN 2.0 XML.
>
> **Target domain:** university-system processes (enrollment, course selection,
> academic leave, thesis defense, financial clearance, loans/dorms, …). The domain
> is injected via the `knowledge/` corpus, so the system generalizes to other
> domains by adding documents — no code changes.

This document describes the system as it is actually implemented. The user-facing
README and `PLAN.md` are in Persian; this file is the English technical reference.

---

## 1. Table of contents

1. [High-level architecture](#2-high-level-architecture)
2. [Tech stack](#3-tech-stack)
3. [Repository layout](#4-repository-layout)
4. [Core data model (zod schemas)](#5-core-data-model-zod-schemas)
5. [LLM abstraction layer](#6-llm-abstraction-layer)
6. [Knowledge base / RAG](#7-knowledge-base--rag)
7. [Agents & orchestration](#8-agents--orchestration)
8. [BPMN generation pipeline](#9-bpmn-generation-pipeline)
9. [Output stage](#10-output-stage)
10. [Server (Fastify API + SSE)](#11-server-fastify-api--sse)
11. [Web frontend (React + bpmn-js)](#12-web-frontend-react--bpmn-js)
12. [Configuration](#13-configuration)
13. [Build, run, test](#14-build-run-test)
14. [Extension points](#15-extension-points)
15. [Design decisions & rationale](#16-design-decisions--rationale)
16. [Known limitations](#17-known-limitations)

---

## 2. High-level architecture

The system is a TypeScript **monorepo** (npm workspaces) with three packages:

| Package | Responsibility |
|---|---|
| `@bpmn-analyst/core` | All domain logic: zod schemas, provider-agnostic LLM layer, RAG knowledge base, analysis agents, orchestrator, BPMN generation, output builders, session persistence. No web/server dependency. |
| `@bpmn-analyst/server` | Fastify HTTP API + SSE streaming, session lifecycle, wiring of core into a running service. |
| `@bpmn-analyst/web` | React SPA: multi-step chat, live `bpmn-js` diagram viewer, analysis panels, session history. |

Supporting directories:

- `knowledge/` — reference documents (`.md`/`.txt`) fed into RAG.
- `data/` — generated artifacts, git-ignored: `knowledge-index.json`, one JSON file per session under `data/sessions/`, plus the admin learning-loop stores (`feedback/`, `eval/`, `learned-knowledge.json`, `examples.json`, `behavior.json`, `knowledge-overrides.json`, `retrieval-log.jsonl`).

> **Admin learning loop.** On top of the generation pipeline, an admin subsystem
> lets reviewers turn feedback into knowledge, mine corrected diagrams, curate the
> RAG corpus (usage/usefulness/gaps, enable-disable, edit), teach per-agent
> behavior, and bank worked examples for few-shot modeling. It is documented
> separately in [learning-loop-technical.md](learning-loop-technical.md)
> (technical) and [admin-guide.md](admin-guide.md) (operator guide, Persian).

### Request → BPMN flow (end to end)

```
User request (NL)
   │
   ▼
[Server]  POST /api/sessions/stream  ──SSE──▶ [Web] live chat + phase progress
   │
   ▼
[Orchestrator]  deterministic phase machine
   │   intake → elicitation → actors → business_rules → implicit_knowledge
   │        → ambiguity → contradiction → logical_model → bpmn_generation → outputs → done
   │
   ├─▶ each phase calls a specialized Agent  ──▶ LLMProvider.completeStructured() → zod-validated result
   │        each Agent may pull grounding context from the KnowledgeRetriever (RAG)
   │
   ▼
[LogicalModel agent]  produces a ProcessModel (abstract, tool-independent)
   │
   ▼
[BPMN pipeline]  toBpmnXml() → bpmn-auto-layout (DI) ; validateModel() (structural)
   │
   ▼
[Output]  buildProcessSummary() + buildFinalDocument()  →  session.outputs
   │
   ▼
Persisted session (FileSessionStore) → downloadable process.bpmn / process.md, live diagram
```

### Key principles (as implemented)

1. **Modular / extensible** — each analysis phase is an independent agent with a single responsibility.
2. **Model-agnostic** — no analysis module imports an LLM SDK; everything goes through the `LLMProvider` interface.
3. **Structured output everywhere** — inter-module communication is typed zod values, never free text.
4. **Deterministic orchestration** — a phase machine decides which agent runs, not an autonomous agent-swarm (cheaper, debuggable, predictable).
5. **Never guesses the process** — on gaps/ambiguity the system asks questions and waits.
6. **Serializable state** — the entire `SessionState` can be saved/reloaded.

---

## 3. Tech stack

| Layer | Technology |
|---|---|
| Language | TypeScript 5.6, ES2022, `NodeNext` modules (ESM) |
| Runtime | Node.js ≥ 20 (developed on Node 24) |
| Validation / typing | `zod` (schemas + inferred types), `zod-to-json-schema` (for structured LLM prompts) |
| LLM transport | Node core `http`/`https` (deliberately **not** `fetch`/undici) |
| RAG | Custom BM25 (zero-dep default) + optional `@huggingface/transformers` (`all-MiniLM-L6-v2`) semantic embeddings |
| BPMN layout | `bpmn-auto-layout` (adds DI coordinates) |
| Server | `fastify` 5 + `@fastify/cors`; SSE via raw response hijack |
| Web | React 18, Vite 5, `bpmn-js` 17 (`NavigatedViewer`), Vazirmatn font |
| Dev tooling | `tsx` (run/watch TS), `vitest` (tests), `concurrently` |

No database: session and knowledge-index persistence is file-based JSON (deliberately swappable).

---

## 4. Repository layout

```
BPMN/
├── package.json                # workspace root, aggregate scripts
├── tsconfig.base.json          # shared strict TS config
├── README.md / PLAN.md         # Persian overview & project plan
├── .env / .env.example         # LLM provider configuration
├── knowledge/                  # RAG corpus
│   ├── bpmn-guidelines.md      # kind: bpmn_guideline
│   ├── validation-checklist.md # kind: validation
│   ├── implicit-knowledge.md   # kind: domain/implicit
│   └── university-domain.md     # kind: domain (roles/systems/rules)
├── data/                       # git-ignored generated output
│   ├── knowledge-index.json    # cached chunk index
│   └── sessions/*.json         # one file per session
└── packages/
    ├── core/src/
    │   ├── index.ts            # public barrel export
    │   ├── e2e.ts              # live end-to-end script (real tokens)
    │   ├── schemas/            # analysis, process-model, session, knowledge
    │   ├── llm/                # provider, openai-compatible, mock, registry, config, transport, models, smoke
    │   ├── knowledge/          # bm25, embeddings, ingest, store, retriever, smoke
    │   ├── agents/             # base, chat, elicitation, actors, business-rules, implicit,
    │   │                       #   ambiguity, contradiction, logical-model, reviewer, orchestrator
    │   ├── bpmn/               # generator, layout, validator
    │   ├── output/             # document, finalize
    │   └── state/              # store (Memory + File session stores)
    ├── server/src/             # app, routes, index, paths
    └── web/src/                # App.tsx, api.ts, components/, phases.ts, styles.css
```

`core/src/index.ts` re-exports every subsystem barrel, so `@bpmn-analyst/core` exposes schemas, LLM, knowledge, agents, BPMN, output and state from a single entry point.

---

## 5. Core data model (zod schemas)

All cross-module data is defined with `zod` in `packages/core/src/schemas/`. Types are inferred from schemas (`z.infer`), so runtime validation and static types never drift.

### 5.1 `session.ts` — the master state

**`SessionState`** is the single serializable object that flows through the whole pipeline:

| Field | Type | Notes |
|---|---|---|
| `id`, `createdAt`, `updatedAt` | string | identity + timestamps (ISO) |
| `request` | string | the initial user request |
| `phase` | `Phase` enum | current pipeline phase |
| `messages` | `ChatMessage[]` | chat history (`role`, `content`, `at`, optional `phase`) |
| `requirements` | `Requirement[]` | extracted requirements |
| `roles` | `Role[]` | actors/participants |
| `businessRules` | `BusinessRule[]` | explicit + implicit rules |
| `ambiguities` | `Ambiguity[]` | open/resolved ambiguities |
| `contradictions` | `Contradiction[]` | detected conflicts |
| `openQuestions` | `Question[]` | interview follow-ups |
| `processModel` | `ProcessModel?` | the logical model once built |
| `outputs` | `Outputs` | `bpmnXml`, `diagramSvg?`, `summary`, `document` |

`Phase` is an ordered enum:
`intake → elicitation → actors → business_rules → implicit_knowledge → ambiguity → contradiction → logical_model → bpmn_generation → outputs → done`.

`newSession(id, request?)` builds an empty, schema-validated session.

### 5.2 `analysis.ts` — structured analysis artifacts

- **`Role`** — `type: human | system | organization`.
- **`Requirement`** — one of 14 `category` values (`initiator`, `role`, `activity`, `ordering`, `decision`, `approval`, `rejection`, `exception`, `error_handling`, `time_constraint`, `parallel`, `end_state`, `input_output`, `other`); `source: user | inferred | implicit`; `confirmed`.
- **`BusinessRule`** — `kind: explicit | implicit`; `source: user | suggested`; `rationale?`; `confirmed`.
- **`Ambiguity`** — `description` + clarifying `question`; `status: open | resolved`.
- **`Contradiction`** — `conflictingItems[]`, `severity: low | medium | high`, `suggestedResolution`, `status`.
- **`Question`** — interview item with `category`, `rationale?`, `answered`.

### 5.3 `process-model.ts` — the logical model

An abstract, tool-independent representation later compiled to BPMN XML. All node ids must match the BPMN identifier rule `^[A-Za-z_][A-Za-z0-9_-]*$`.

| Element | Key fields |
|---|---|
| `Lane` | `id`, `name`, `roleId?` |
| `StartEvent` | `type: none \| message \| timer \| conditional`, `lane?` |
| `EndEvent` | `type: none \| message \| error \| terminate` |
| `IntermediateEvent` | `type: message \| timer \| error \| signal`, `throwing` |
| `Activity` | `type: task \| userTask \| serviceTask \| manualTask \| scriptTask \| businessRuleTask`, `lane?`, `inputs[]`, `outputs[]` |
| `Gateway` | `type: exclusive \| parallel \| inclusive \| eventBased` |
| `SequenceFlow` | `sourceRef`, `targetRef`, `name?`, `condition?` |
| `DataObject` | `id`, `name` |

`ProcessModelSchema` requires **at least one `startEvent` and one `endEvent`** (`.min(1)`).

### 5.4 `knowledge.ts` — RAG types

- **`KnowledgeChunk`** — `docId`, `docTitle`, `kind` (`bpmn_guideline | validation | domain | glossary | other`), `text`, `embedding: number[]` (empty for keyword-only), `tags[]`.
- **`RetrievalResult`** — `{ chunk, score }`.

---

## 6. LLM abstraction layer

Location: `packages/core/src/llm/`. This is the "swap the model with a config change, not a code change" boundary.

### 6.1 `LLMProvider` interface (`provider.ts`)

```ts
interface LLMProvider {
  readonly name: string;
  readonly model: string;
  complete(opts: CompleteOptions): Promise<string>;
  completeStructured<S extends z.ZodTypeAny>(opts: StructuredOptions<S>): Promise<z.infer<S>>;
}
```

- `complete` — plain text completion.
- `completeStructured` — the workhorse: given a zod `schema`, `schemaName`, optional `schemaDescription`, and `retries`, it returns a **parsed & validated** value of the schema's type. Every analysis agent uses this exclusively.
- `extractJson(raw)` — a helper that pulls the first balanced JSON object/array out of a model response, tolerating ```json fences, leading reasoning/prose, and trailing text (string-aware brace matching).

### 6.2 `OpenAICompatibleProvider` (`openai-compatible.ts`)

Targets any OpenAI-compatible `/chat/completions` endpoint (default: AgentRouter, model `glm-5.2`).

- `completeStructured` converts the zod schema to JSON Schema (`zodToJsonSchema`), embeds it in a system instruction demanding a single JSON value, calls the endpoint, then `extractJson` → `JSON.parse` → `schema.parse`. On validation failure it appends a corrective user message ("Your previous answer was invalid: …") and retries (default `retries + 1` = 3 attempts total).
- `postWithRetry` retries transient upstream failures (HTTP 5xx / 429, socket errors) with linear backoff (`500ms * attempt`, 3 attempts).
- Default temperatures: `0.3` for `complete`, `0.2` for `completeStructured`.

### 6.3 `MockProvider` (`mock.ts`)

Offline provider for tests and no-key demos. `complete` echoes a canned reply; `completeStructured` either returns a fixture keyed by `schemaName`, or **synthesizes a minimal schema-valid value** by walking the zod definition (`synthesize`). This lets the entire pipeline run without an API key.

### 6.4 Configuration & transport

- `config.ts` — `getLLMConfig()` reads env (with `overrides`), self-loads the nearest `.env` via Node's built-in `loadEnvFile` (no dotenv dependency). Builds anti-abuse headers (`User-Agent`, `x-app`) required by AgentRouter. Defaults: `provider=mock`, `baseUrl=https://agentrouter.org/v1`, `model=glm-5.2`, `maxTokens=4096`.
- `registry.ts` — `createProvider()` selects the implementation from config (`openai-compatible` | `mock`).
- `transport.ts` — `getJson` / `postJson` over Node core `http`/`https`. **`fetch` (undici) is deliberately avoided**: some constrained/proxied environments reset undici's TLS sockets while the core stack connects fine. Includes explicit timeouts (30s GET / 60s POST).
- `models.ts` / `smoke.ts` — CLI scripts: list endpoint models (`npm run llm:models`) and a live connectivity + structured-output smoke test (`npm run smoke:llm`).

---

## 7. Knowledge base / RAG

Location: `packages/core/src/knowledge/`. This subsystem turns the `knowledge/`
markdown corpus into retrievable **chunks** and grounds every analysis agent in
the most relevant ones — the **chunk → vectorize → retrieve** path. In full:
**ingest → (embed) → store → retrieve → format → inject into prompt**. It is designed so retrieval *always works with
zero dependencies* (BM25) and *upgrades to semantic vectors* only when you opt in.

Data flow:

```
knowledge/*.md ──ingest──▶ KnowledgeChunk[]  ──addChunks──▶ KnowledgeStore
                                (embedding=[] )              │  ├─ BM25 index (always)
                                                             │  └─ vectors (if embedder)
                                                             ▼
                        agent ──ground(query,k,filter)──▶ KnowledgeRetriever.retrieve
                                                             ▼
                        semantic cosine  OR  BM25 fallback  ──▶ RetrievalResult[] {chunk,score}
                                                             ▼
                        formatContext ──▶ labeled text block ──▶ knowledgeBlock() ──▶ system prompt
```

### 7.1 The chunk (`schemas/knowledge.ts`)

`KnowledgeChunk` is the unit of retrieval:

| Field | Type | Notes |
|---|---|---|
| `id` | string | `docId#index` (e.g. `university-domain#3`) |
| `docId` | string | source filename without extension |
| `docTitle` | string | from frontmatter `title`, else `docId` |
| `kind` | `bpmn_guideline \| validation \| domain \| glossary \| other` | drives filtered retrieval; defaults `other` |
| `text` | string | the chunk body |
| `embedding` | `number[]` | **empty at ingest**; filled lazily only if an embedder is configured |
| `tags` | `string[]` | optional, from frontmatter `tags` (comma-split) |

`RetrievalResult = { chunk, score }`. `RetrievalLogEntry` (query telemetry) is
also defined here — see [storage](#114-persistence--storage-layer) and
[learning-loop-technical.md](learning-loop-technical.md).

### 7.2 Ingestion & chunking (`ingest.ts`)

`ingestDirectory(dir, store, opts)` reads every `.md` / `.txt` / `.markdown` file
in `dir` (case-insensitive extension match; returns `{files:0, chunks:0}` if the
dir is unreadable) and, per file:

1. **`parseDoc(raw, fallbackTitle)`** — strips optional YAML-style frontmatter
   matched by `^---\n … \n---\n?`. Recognized keys: `title`, `kind` (only if the
   value is one of the five `knowledgeKinds`, else ignored → `other`), and `tags`
   (comma-separated). Everything after the fence is the `body`.
2. **`chunkText(body, chunkSize=1000, overlap=1)`** — splits the body into
   paragraphs on blank lines (`/\n\s*\n/`, trimmed, empties dropped), then
   **greedily packs** paragraphs into a chunk until adding the next would exceed
   `chunkSize` characters; at that boundary it flushes the chunk and **carries the
   last `overlap` paragraph(s)** into the next one for context continuity.
   `chunkSize` is a *soft* target: a single paragraph longer than `chunkSize`
   becomes its own oversized chunk (the size check requires `size > 0` first).
3. **`docToChunks`** — emits `KnowledgeChunk`s with `id = docId#i`,
   `embedding: []`, and the parsed `kind`/`tags`, then `store.addChunks(...)`.

Tuning: pass `chunkSize` / `overlap` through `IngestOptions` (also accepted by
`buildKnowledge`).

### 7.3 Retrieval strategy A — BM25 (`bm25.ts`, the zero-dep default)

A small, pure-TS Okapi BM25 scorer. **This always works — no model, no install.**

- **Tokenizer**: `text.toLowerCase().match(/[\p{L}\p{N}]+/gu)`, dropping 1-char
  tokens. The Unicode `\p{L}\p{N}` classes make it work for **Persian and
  English** alike (no stemming/stop-words).
- **`Bm25Index(k1=1.5, b=0.75)`**. `add(id, text)` tokenizes, stores the doc,
  updates per-term document frequency `df`, and recomputes the average document
  length `avgLen` (O(N) per add — fine at this corpus size).
- **`search(query, k)`** scores each doc as `Σ_term idf · (f·(k1+1)) / (f + k1·(1 − b + b·|doc|/avgLen))`
  where `idf = ln(1 + (N − n + 0.5)/(n + 0.5))` (the smoothed, always-positive
  form), `f` = term frequency in the doc, `n` = docs containing the term.
  Returns ids with `score > 0`, highest first, sliced to `k`.

BM25 is also reused outside RAG: `ExampleStore.findSimilar` ranks worked examples
by request-text overlap with the same index.

### 7.4 Retrieval strategy B — semantic embeddings (`embeddings.ts`, opt-in)

- **`EmbeddingProvider`** interface: `{ name, dimension, embed(texts) => number[][] }`.
- **`createLocalEmbedder(model = "Xenova/all-MiniLM-L6-v2")`** dynamically imports
  `@huggingface/transformers` through a **computed specifier** (`const pkg = "…"`)
  so TS/bundlers never require the optional dependency at build time; if it isn't
  installed it throws a clear "run `npm i …`" message. Runs a `feature-extraction`
  pipeline with `{ pooling: "mean", normalize: true }`. Model: `all-MiniLM-L6-v2`,
  **384-dim, CPU, offline, free**.
- **`cosineSimilarity(a, b)`** — dot / (‖a‖·‖b‖) over the shared length; returns
  `0` if either vector has zero norm (so empty embeddings never match).

### 7.5 Store — where vectors live and how search is chosen (`store.ts`)

`KnowledgeStore` holds the chunks in memory alongside three indexes: the BM25
index, a `byId` map, and a `disabled` id-set. **`new KnowledgeStore(embedder?)`** —
passing an embedder is what turns on semantic mode.

- **`addChunks(chunks)`** — if an embedder is configured, it embeds only chunks
  whose `embedding` is still empty (best-effort: on embedding failure the vector
  stays `[]` and the chunk is still keyword-retrievable), then indexes each.
- **`search(query, k=4, filter?)`** — the decision point:
  1. `admit(c)` = *not disabled* **and** (no filter or `filter(c)` passes) → builds
     the candidate `pool`.
  2. `canSemantic` = an embedder exists **and** at least one pooled chunk carries a
     vector. If so, it embeds the query and ranks the pool by cosine similarity,
     top-`k`. **Any error falls through to BM25** (never fails a turn).
  3. Otherwise (or on fallthrough) it runs `bm25.search(query, k*3)` — over-fetching
     3× so the `admit` filter can drop disabled/filtered hits and still return `k`.
- **`disable(id)` / `enable(id)` / `isDisabled(id)`** — reversibly hide a chunk from
  retrieval **without deleting it** (it stays in memory, re-enableable). Used by the
  admin dashboard. `removeChunk(id)` fully deletes and rebuilds the BM25 index.
- **Persistence**: `save(path)` writes `{ chunks }` as compact JSON; `load(path,
  embedder?)` re-indexes them. **Note the `disabled` set is *not* persisted here** —
  the BM25 index is a rebuildable cache, so durable disables live in a separate
  `KnowledgeOverridesStore` that the server re-applies at startup (see
  [learning-loop-technical.md](learning-loop-technical.md)).

This class is the **explicit swap point for a real vector DB**: replace it (or
supply a different `EmbeddingProvider`) and the retriever facade is unchanged.

### 7.6 Retriever facade & index lifecycle (`retriever.ts`)

- **`KnowledgeRetriever`** is the only surface the agents touch. `retrieve(query,
  k=4, filter?)` returns `[]` when the index is empty, else delegates to
  `store.search`. `retrieveContext()` = retrieve + `formatContext`. It also
  exposes `addChunks` / `removeChunk` / `disable` / `enable` / `isDisabled` /
  `allChunks` so the admin layer can inject learned knowledge and curate the corpus
  on the live index.
- **`formatContext(results)`** renders each hit as `[i] (kind) docTitle\n<text>`,
  joined by `\n\n---\n\n` (empty string when there are no hits). Agents wrap this in
  `knowledgeBlock()` before putting it in the system prompt.
- **`buildKnowledge(opts)`** builds or loads the index:
  - If `useEmbeddings`, it tries `createLocalEmbedder()` and **warns (does not fail)**
    if the dependency is missing — retrieval degrades to BM25.
  - If `!rebuild` and `indexPath` exists → `KnowledgeStore.load` the cache.
  - Otherwise → new store, `ingestDirectory`, `save` (only if any chunks), log counts.

  **To rebuild after editing docs, delete `data/knowledge-index.json`** (or pass
  `rebuild: true`). Enabling embeddings later also warrants a rebuild so chunks get
  vectors.

> **What "vectorize" means here.** Vectors are optional and lazy: chunks are stored
> with `embedding: []` and only get a vector when an embedder is present at
> `addChunks` time. Turn it on with `KNOWLEDGE_EMBEDDINGS=on` **plus** installing
> `@huggingface/transformers`; otherwise the system runs entirely on BM25.

---

## 8. Agents & orchestration

Location: `packages/core/src/agents/`. Every analysis agent is a single async
function `runX(ctx: AgentContext, session): Promise<Result>` that builds a system
prompt, calls **`ctx.llm.completeStructured({ schema, … })`**, and returns a
zod-validated value. Agents never mutate the session — the **orchestrator** owns
all state changes. Agents never talk to each other; the orchestrator sequences them.

### 8.1 `AgentContext` — the dependency bundle (`base.ts`)

```ts
interface AgentContext {
  llm: LLMProvider;                 // required — the only hard dependency
  retriever?: KnowledgeRetriever;   // RAG grounding (optional)
  onRetrieve?(results, query): void;// provenance hook — fires on every ground() hit
  logRetrieval?(entry): void;       // telemetry sink for knowledge-gap analysis
  exampleBank?: ExampleBank;        // few-shot worked examples (logical-model only)
  behavior?: BehaviorLookup;        // admin-taught per-agent prompt instructions
}
```

Only `llm` is required — an agent runs with no retriever, no examples, no behavior.
The orchestrator wraps a base context per session to fill `onRetrieve`/`logRetrieval`
(see §8.4). `exampleBank`/`behavior` come from the admin learning loop
([learning-loop-technical.md](learning-loop-technical.md)).

### 8.2 Shared prompt primitives (`base.ts`)

- **`BA_PERSONA`** — the Persian "senior BPMN business-analyst, university-systems
  domain" system persona prepended by every agent: *never guess the process; ask
  targeted questions; propose & confirm implicit domain knowledge; detect
  contradictions; answer concisely in Persian.*
- **`sessionDigest(session)`** — a compact text digest of everything known so far:
  the request, current phase, requirements (`[category] statement ✓`), roles
  (`name (type)`), business rules (`[kind] statement ✓`), and the **open** (unanswered)
  questions / ambiguities / contradictions. Injected into most agent prompts so each
  agent sees the full running state cheaply.
- **`ground(ctx, query, k=4, filter?)`** — the safe RAG entry point: returns `""`
  if there is no retriever or on any error; otherwise retrieves, **fires
  `ctx.onRetrieve(results, query)`** (this is how citations + telemetry get recorded),
  and returns `formatContext(results)`. `knowledgeBlock(text)` wraps that as a labeled
  Persian prompt section (empty string when there was no hit).
- **`behaviorBlock(ctx, agent)`** — pulls up to 8 admin-approved behavioral
  instructions for that agent from `ctx.behavior` and renders them as a prompt block.
  Unlike RAG (which only appears on a retrieval hit), a behavior rule applies on
  **every** run of that agent.
- **`genId(prefix)`** — `` `${prefix}_${Date.now().toString(36)}${counter}` `` with a
  process counter mod 1e6; guaranteed to satisfy the BPMN id rule
  `^[A-Za-z_][A-Za-z0-9_-]*$`. The orchestrator uses it for every entity id.

### 8.3 The specialized agents — exact wiring

Each row lists the output schema, the RAG grounding query (and any `kind` filter /
`k`), how chat context is supplied, the `behaviorBlock` key, and notable LLM params.

| Agent (`file`) | Output schema | Grounding query · k · filter | Messages | Behavior key · params |
|---|---|---|---|---|
| **Elicitation** (`elicitation.ts`) | `ElicitationResult` = `{ extractedRequirements[], questions[], assistantMessage, readyToModel }` | `"<request>\nنقش‌ها و مراحل و قوانین فرآیند"` · k=3 · none | `recentChat` | `elicitation` |
| **Actors** (`actors.ts`) | `ActorsResult` = `{ roles[] }` | `"نقش‌های دخیل در <request> …"` · k=3 · **filter `kind ∈ {glossary, domain}`** | fixed user turn | `actors` |
| **Business Rules** (`business-rules.ts`) | `RulesResult` = `{ rules[] }` | `"قوانین کسب‌وکار برای <request>"` · k=3 · none | fixed user turn | `business_rules` |
| **Implicit** (`implicit.ts`) | `ImplicitResult` = `{ implicitRules[{statement, rationale}] }` | `"دانش ضمنی … best practice …"` · k=5 · none | fixed user turn | `implicit` |
| **Ambiguity** (`ambiguity.ts`) | `AmbiguityResult` = `{ ambiguities[{description, question}] }` | **no grounding** | `recentChat` | `ambiguity` |
| **Contradiction** (`contradiction.ts`) | `ContradictionResult` = `{ contradictions[{description, conflictingItems[], severity, suggestedResolution}] }` | `"قوانین و ترتیب صحیح فرآیند <request>"` · k=3 · none | `recentChat` | `contradiction` |
| **Logical Model** (`logical-model.ts`) | `ProcessModel` | `"اصول مدل‌سازی BPMN … <request>"` · k=5 · none | fixed user turn | `logical_model` · **maxTokens 8000, retries 3**, + few-shot example |
| **Reviewer** (`reviewer.ts`) | `ReviewResult` = `{ ok, issues[] }` | `"چک‌لیست اعتبارسنجی و اصول مدل‌سازی BPMN"` · k=4 · none | fixed user turn | *(no behavior block; not wired into the default turn flow — see below)* |

Notes:

- **Actors filters RAG** to `glossary`/`domain` chunks so lane/role names stay
  consistent with the project's terminology across sessions.
- **Implicit** rules are proposals only — the orchestrator adds them **unconfirmed**
  and asks the user to confirm before they count.
- **Logical Model** adds *case-based few-shot*: `ctx.exampleBank?.findSimilar(request,
  1, session.id)` fetches the single closest admin-approved worked example and folds a
  `modelDigest` of it into the prompt ("use the structure as a template, don't copy").
  It's the only agent given a raised token budget and explicit retries because it emits
  the whole `ProcessModel`.
- **Reviewer** is a *soft* critic complementing the deterministic `validateModel`
  (§9.3). It is defined and exported but **not invoked by the orchestrator's default
  finalize path** — the pipeline reports structural validity from `validateModel`, not
  from the Reviewer. Wire it in where a guideline-level critique is wanted.
- **`recentChat(session, limit=12)`** (`chat.ts`) maps the last 12 user/assistant
  turns to `LLMMessage[]`, and falls back to a single user turn built from
  `session.request` if there are none — so the model always has something to answer.
- Admin-loop agents (`feedback-extractor.ts`, `conflict-check.ts`,
  `correction-diff.ts`) live here too but run from the admin routes, not the
  interview — documented in [learning-loop-technical.md](learning-loop-technical.md).

### 8.4 The Orchestrator — deterministic phase machine (`orchestrator.ts`)

A **coordinator, not an autonomous agent**: a `switch` on `session.phase` decides
which agent runs and applies its result. Public surface:

- **`begin(session, request, onProgress?)`** — sets `request`, advances to
  `elicitation`, records the user message, runs the first elicitation turn.
- **`respond(session, userText, onProgress?)`** — appends the user message and
  dispatches on the current phase.

**`agentCtx(session)`** wraps the base context with an `onRetrieve` that, on every
grounding hit, (a) merges the chunks into `session.citations` deduped by `chunkId`
(`recordCitations`) and (b) emits a `RetrievalLogEntry` (`at, sessionId, phase,
query, topScore, chunkIds`) via `logRetrieval`. So **provenance and gap telemetry
are captured automatically** for any agent that calls `ground()`.

Phase dispatch in `respond`:

| Phase | Handler | Behavior |
|---|---|---|
| `intake` / `elicitation` | `runElicitationTurn`, or cascade | If `isAffirmative(text)` **and** text matches `/(بساز\|ادامه\|مدل\|proceed\|بله)/i` → jump straight to the modeling cascade; else run another elicitation turn |
| `implicit_knowledge` | `handleImplicitConfirmation` | Affirmative → mark all implicit rules `confirmed`; either way advance to ambiguity |
| `ambiguity` | `handleAmbiguityPhase` | — |
| `contradiction` | `handleContradictionPhase` | — |
| *default* | — | "this phase needs no further interaction" |

Turn logic in detail:

1. **Elicitation** (`runElicitationTurn`) — runs `runElicitation`; pushes each new
   requirement (`source: "user"`, `confirmed: true`); **replaces** `openQuestions`
   with the agent's questions. If `readyToModel && questions.length === 0` it enters
   the cascade; otherwise it replies with `assistantMessage` + a bullet list of
   questions and sets `awaitingUser = true`.
2. **Modeling cascade** (`startModelingCascade`) — a fixed sequence at hand-off:
   `actors` (roles deduped by name) → `business_rules` (explicit, `confirmed: true`)
   → `implicit_knowledge` (implicit, `source: "suggested"`, **`confirmed: false`**).
   If the implicit agent proposed nothing, it falls straight through to ambiguity;
   otherwise it lists the proposals and waits for confirmation.
3. **Ambiguity** then **Contradiction** — each gate: `runAmbiguity` /
   `runContradiction`, keep only items with a non-empty `description`. If any remain,
   store them `status: "open"`, surface them, and wait. If none, mark any previously
   open items `resolved` and advance.
4. **Logical model** (`buildLogicalModel`) — `runLogicalModel` → store
   `session.processModel` → phase `bpmn_generation` → `produceOutputs(session)` (BPMN
   XML + `validateModel` + docs) → phase `done`. The final reply reports activity /
   gateway / role counts and structural validity.

Every turn returns a **`TurnResult` `{ session, reply, phase, awaitingUser,
processModel? }`**. `setPhase` fires `onProgress(phase)` on each transition; the
server relays these as SSE `phase` events for live UI progress.

> **Ordered `Phase` enum** (from `schemas/session.ts`): `intake → elicitation →
> actors → business_rules → implicit_knowledge → ambiguity → contradiction →
> logical_model → bpmn_generation → outputs → done`.

> **Interaction cost:** one LLM call per turn during elicitation; then a short,
> bounded cascade (actors + rules + implicit, then ambiguity, contradiction, logical
> model — one call each) at the modeling hand-off. Predictable and debuggable, with
> no open-ended agent loop.

---

## 9. BPMN generation pipeline

Location: `packages/core/src/bpmn/`.

### 9.1 `generator.ts` — logical model → semantic BPMN XML

`toBpmnXml(model)` emits standards-compliant BPMN 2.0 **semantic** XML (no DI). It:

- Declares the standard BPMN/BPMNDI/DC/DI namespaces.
- Builds incoming/outgoing flow reference maps and emits `<bpmn:incoming>`/`<bpmn:outgoing>` per node.
- Maps activity types → tags (`userTask`, `serviceTask`, …) and gateway types → tags (`exclusiveGateway`, …).
- Emits event definitions (`messageEventDefinition`, `timerEventDefinition`, `errorEventDefinition`, `terminateEventDefinition`, `conditionalEventDefinition`, `signalEventDefinition`).
- Chooses `intermediateThrowEvent` vs `intermediateCatchEvent` from `throwing`.
- Emits `sequenceFlow`s with optional `name` and `conditionExpression`.
- Records a node's role as `<bpmn:documentation>نقش: …</bpmn:documentation>` (lanes are documented, not rendered as swimlanes — see limitations).
- XML-escapes all names.

### 9.2 `layout.ts` — add DI

`generateBpmn(model)` calls `toBpmnXml` then `bpmn-auto-layout`'s `layoutProcess` to inject Diagram Interchange coordinates (`BPMNShape`/`BPMNEdge`). **If auto-layout throws, it returns the valid semantic XML** so downstream BPMN tools can lay it out themselves — the pipeline never fails on layout.

### 9.3 `validator.ts` — deterministic structural validation

`validateModel(model)` is a hard, no-LLM correctness check complementing the soft Reviewer agent. It returns `{ valid, errors[], warnings[] }`:

- **Errors** (block validity): duplicate node ids; missing start/end events; sequence flows referencing unknown source/target; start events with no outgoing; end events with no incoming.
- **Warnings** (non-blocking): activities with no incoming/outgoing; gateways with incomplete connections; exclusive gateways with an unconditioned/unnamed branch.

---

## 10. Output stage

Location: `packages/core/src/output/`. A **deterministic, no-LLM** stage.

- **`finalize.ts` → `produceOutputs(session)`** — requires `session.processModel`; runs `validateModel`, `generateBpmn` (laid-out XML), `buildProcessSummary`, `buildFinalDocument`; writes them into `session.outputs`; returns `{ bpmnXml, validation, summary, document }`.
- **`document.ts`**:
  - `buildProcessSummary(session)` — a short template summary (activity/gateway/role/event counts).
  - `buildFinalDocument(session, validation?)` — assembles the final Markdown document: roles, main activities (with role + type), explicit rules, implicit rules (confirmed/pending), resolved ambiguities, detected contradictions, and a validation section.

Outputs are downloadable via the server (`process.bpmn`, `process.md`) and the BPMN XML renders live in the web viewer.

---

## 11. Server (Fastify API + SSE)

Location: `packages/server/src/`.

### 11.1 Bootstrap (`app.ts`, `index.ts`, `paths.ts`)

`buildApp()` wires core into a Fastify instance: creates the LLM provider, builds the knowledge retriever, constructs a `FileSessionStore` and an `Orchestrator`, registers CORS (`origin: true`) and routes. `paths.ts` walks up from cwd to find the repo root (the dir containing `knowledge/` + `package.json`) and resolves `knowledgeDir`, `indexPath`, `sessionsDir`. Server listens on `PORT` (default **8787**).

### 11.2 REST endpoints (`routes.ts`)

| Method & path | Purpose |
|---|---|
| `GET /api/health` | provider, model, knowledge chunk count |
| `POST /api/sessions` | create session + run first turn (non-streaming) |
| `POST /api/sessions/:id/messages` | continue a session (non-streaming) |
| `POST /api/sessions/stream` | create session + stream first turn (SSE) |
| `POST /api/sessions/:id/messages/stream` | continue a session, streamed (SSE) |
| `GET /api/sessions` | list session summaries |
| `GET /api/sessions/:id` | full session |
| `DELETE /api/sessions/:id` | delete session |
| `GET /api/sessions/:id/bpmn` | download BPMN XML (`application/xml`) |
| `GET /api/sessions/:id/document` | download Markdown doc (`text/markdown`) |

### 11.3 SSE streaming model

`runStreamingTurn` hijacks the Fastify reply and writes an event stream:

```
created  → session persisted & listable up front (before any reply)
phase    → one per orchestrator phase transition (live progress)
delta    → reply text streamed word-by-word (~18ms/word)
done     → { session, reply, awaitingUser }
error    → { error, session }   (localized message)
```

Headers disable proxy buffering (`X-Accel-Buffering: no`) so events flush live. `llmError()` maps provider failures to friendly Persian messages (insufficient balance, content-blocked, network).

### 11.4 Persistence & storage layer

Location: `packages/core/src/state/`. **There is no database** — every store is
file-backed JSON under `data/` (git-ignored), each behind an interface so a real DB
can drop in without touching call sites. All stores share three invariants:
**validate-on-read** with the owning zod schema, **tolerate corrupt/partial files**
(skip or return empty rather than throw), and **`mkdir -p` on write**.

**Session persistence (`store.ts`)** — `SessionStore` (`get` / `save` / `list` /
`remove`) with two implementations: `MemorySessionStore` (tests/ephemeral) and
`FileSessionStore` (one `<id>.json` per session under `data/sessions/`). Reads run
through `SessionStateSchema.parse` (a corrupt file → `undefined`, and is simply
skipped in `list()`). `list()` returns lightweight `SessionSummary`s (`id`, `request`,
`phase`, timestamps, `messageCount` — no message/analysis payload) sorted by
`updatedAt` desc. `remove` resolves `false` when nothing was deleted. This interface
is the explicit swap point for a real database.

The `state/` barrel also exports the **admin learning-loop stores**. They come in
three deliberate file layouts, chosen by access pattern:

| Store | File(s) under `data/` | Layout | Schema | Purpose |
|---|---|---|---|---|
| `FileSessionStore` | `sessions/<id>.json` | one file per record | `SessionState` | interview sessions |
| `FileFeedbackStore` | `feedback/<id>.json` | one file per record | `AdminFeedback` | admin feedback items |
| `FileEvalStore` | `eval/<id>.json` | one file per record | `EvalCase` | golden evaluation cases |
| `LearnedKnowledgeStore` | `learned-knowledge.json` | single aggregate `{entries}` | `LearnedEntry` | admin-approved RAG chunks (provenance + `weight`) |
| `ExampleStore` | `examples.json` | single aggregate `{entries}` | `ExampleEntry` | worked examples (few-shot; `findSimilar` via BM25) |
| `BehaviorStore` | `behavior.json` | single aggregate `{entries}` | `BehaviorEntry` | per-agent prompt instructions (cap 8/agent) |
| `KnowledgeOverridesStore` | `knowledge-overrides.json` | single aggregate `{disabled:[]}` | ids | durable base-chunk disables |
| `RetrievalLog` | `retrieval-log.jsonl` | append-only JSONL | `RetrievalLogEntry` | grounding telemetry / gap analysis |

Why three layouts:

- **One file per record** (sessions, feedback, eval) — records are larger and listed
  infrequently; per-file writes avoid rewriting a big blob on every save, and a single
  corrupt file can't take down the rest.
- **Single aggregate JSON** (learned, examples, behavior, overrides) — small curated
  sets loaded fully into memory at startup and read on the hot path (every retrieval /
  every agent run); a single file is cheapest to load and mutate. `LearnedKnowledgeStore`
  and `BehaviorStore` add **reinforce-on-duplicate**: `findByText` normalizes text
  (`normalizeStatement`) and, on a match, bumps `weight` + appends provenance instead of
  inserting a duplicate; both sort highest-`weight`-first.
- **Append-only JSONL** (`RetrievalLog`) — retrieval telemetry is high-frequency; JSONL
  makes each write O(1) with no index rebuild. `read()` returns newest-first and skips
  malformed lines; `computeGaps()` collapses low-score/no-hit lines into distinct
  recurring knowledge gaps.

The semantics of the learning-loop stores (how entries are created, reinforced, and
injected back into retrieval/prompts) are documented in
[learning-loop-technical.md](learning-loop-technical.md); this section covers only the
storage mechanics.

---

## 12. Web frontend (React + bpmn-js)

Location: `packages/web/src/`.

- **`App.tsx`** — the shell. Manages the active session, session list, and **per-session streaming state** so replies keep progressing in the background while the user browses other sessions (`pendingKeys`, `streams` keyed by session id). Uses an `activeKeyRef` to know synchronously which session the user is viewing, so in-flight requests can tell whether they're still relevant. Renders an optimistic user bubble before the server responds, and reconciles the placeholder id with the real id on the `created` event.
- **`api.ts`** — typed client. Plain `post`/`get`/`del` helpers for REST, plus a hand-written SSE reader (`streamSSE` + `dispatchSSE`) that parses `event:`/`data:` frames and dispatches to `StreamHandlers` (`onCreated`, `onPhase`, `onDelta`, `onDone`, `onError`).
- **`components/`**:
  - `Chat.tsx` — multi-step chat with live streaming text and phase status label.
  - `BpmnViewer.tsx` — wraps `bpmn-js` `NavigatedViewer`, imports the XML, zooms to fit-viewport; renders LTR inside the RTL app.
  - `Panels.tsx` — Roles / Rules / Analysis (ambiguity + contradiction) / Document tabs.
  - `SessionSidebar.tsx` — session history with pending indicators + delete.
- **`phases.ts`** — Persian labels for each pipeline phase.
- **`vite.config.ts`** — dev server on **5173**, proxies `/api` → `http://localhost:8787`.

The UI is Persian/RTL and uses the Vazirmatn font.

---

## 13. Configuration

All configuration is via `.env` at the repo root (git-ignored; copy from `.env.example`):

```ini
LLM_PROVIDER=openai-compatible          # or "mock" (no key, no cost)
LLM_BASE_URL=https://agentrouter.org/v1 # any OpenAI-compatible endpoint
LLM_API_KEY=sk-...                      # your key
LLM_MODEL=glm-5.2                       # default cheap reasoning model
LLM_USER_AGENT=claude-cli/2.1.158 (external, sdk-cli)  # AgentRouter anti-abuse header
LLM_X_APP=cli                           # AgentRouter anti-abuse header
LLM_MAX_TOKENS=4096
PORT=8787
```

Additional (non-`.env`) knobs:

- `KNOWLEDGE_EMBEDDINGS=on` + installing `@huggingface/transformers` enables semantic retrieval (otherwise BM25).
- Switching provider/model is purely a config change — no code edits. `LLM_PROVIDER=mock` runs the full pipeline offline.

> **Provider notes:** AgentRouter requires the Claude-CLI client headers (embedded via `LLM_USER_AGENT`/`LLM_X_APP`) to pass its anti-abuse filter. Some gateways block Persian prompts via content filtering — if so, switch the gateway/key.

---

## 14. Build, run, test

Root scripts (`package.json`):

| Command | Action |
|---|---|
| `npm install` | install workspace deps |
| `npm run dev` | build core, then run server + web concurrently (web `:5173`, API `:8787`) |
| `npm run dev:server` / `npm run dev:web` | run one side only |
| `npm run build` | build `@bpmn-analyst/core` (`tsc`) |
| `npm start` | build core + server, run compiled server |
| `npm test` | run all workspace tests (`vitest`) |
| `npm run typecheck` | typecheck all packages |
| `npm run smoke:llm` | live LLM connectivity + structured-output test |
| `npm run llm:models` | list models exposed by the endpoint |

Test suites live in core: `llm/llm.test.ts`, `knowledge/knowledge.test.ts`, `agents/orchestrator.test.ts` (mock end-to-end), `bpmn/bpmn.test.ts`. A live end-to-end script (`core/src/e2e.ts`) exercises chat → logical model → BPMN with real tokens.

TypeScript is strict (`strict`, `noUncheckedIndexedAccess`), ESM (`NodeNext`), targeting ES2022. Core builds to `dist/` with declarations + source maps; server/web build via `tsc`/Vite.

---

## 15. Extension points

The architecture is intentionally pluggable at these seams:

1. **New LLM provider/model** — implement `LLMProvider` and register it in `registry.ts`, or just change `.env` for any OpenAI-compatible endpoint.
2. **New analysis phase/agent** — add a phase to the `Phase` enum, write an agent (function + zod result schema), and wire it into the `Orchestrator` phase machine.
3. **New domain** — drop `.md`/`.txt` docs into `knowledge/` (optionally with frontmatter `kind`/`tags`); delete `data/knowledge-index.json` to rebuild. No code changes.
4. **Real vector DB** — replace `KnowledgeStore` (or supply a different `EmbeddingProvider`); the `KnowledgeRetriever` facade stays the same.
5. **Real database** — implement `SessionStore` (interface already abstracts get/save/list/remove).
6. **New BPMN elements** — extend `ProcessModelSchema` + the tag/eventDefinition maps in `generator.ts` + rules in `validator.ts`.
7. **New outputs** — add builders in `output/` and surface them through `produceOutputs` + server routes.

---

## 16. Design decisions & rationale

- **Deterministic phase machine over autonomous agent-swarm** — chosen for lower cost, debuggability, and predictable behavior. Each phase is a single-responsibility agent; the orchestrator decides ordering.
- **Structured output (zod) everywhere** — every inter-module boundary is a validated type, eliminating free-text parsing errors and keeping runtime + static types in sync.
- **Provider-agnostic LLM layer** — no analysis code depends on a concrete SDK, so models/providers swap via config. `MockProvider` makes the whole system runnable and testable with zero cost/keys.
- **Node core http over fetch/undici** — undici's TLS sockets get reset in some constrained/proxied environments; the core stack connects reliably.
- **BM25 default, embeddings optional** — retrieval always works with zero dependencies; semantic search is an opt-in upgrade.
- **Separation of hard vs soft validation** — deterministic structural rules live in `bpmn/validator.ts`; soft, guideline-based checks live in the knowledge base and the Reviewer agent.
- **File-based persistence** — appropriate for this scale; abstracted so a DB can replace it without touching call sites.
- **Never guess** — ambiguity/contradiction phases gate finalization; the model is only built from confirmed information.

---

## 17. Known limitations

- **Lanes/swimlanes are documented, not drawn.** Each activity's role is recorded as BPMN `documentation` and appears in the roles list and final document, but the current auto-layout does not position swimlanes — rendering lanes in the diagram is a future enhancement.
- **Persian content filtering.** Some providers/gateways may block Persian prompts or need specific network/proxy access. Mitigation: switch the provider/key in `.env`.
- **Semantic retrieval is opt-in.** Without `@huggingface/transformers` + `KNOWLEDGE_EMBEDDINGS=on`, retrieval is keyword-only (BM25) — good, but not semantic.
- **No auth / multi-tenant isolation.** Sessions are stored as plain JSON files with no access control; intended for local/single-user use.
- **Auto-layout is best-effort.** If `bpmn-auto-layout` fails, the system falls back to semantic-only XML (valid, but the receiving tool must lay it out).
```
