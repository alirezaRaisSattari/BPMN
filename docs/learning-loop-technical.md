# Learning Loop — Technical Reference (v3)

> English technical reference for the "learn from your data over time" subsystem.
> Extends [TECHNICAL.md](TECHNICAL.md). Design/rationale for these features lives
> in [admin-feedback-plan.md](admin-feedback-plan.md), [feedback-loop-v2.md](feedback-loop-v2.md),
> and [feedback-loop-v3.md](feedback-loop-v3.md). Operator instructions are in
> [admin-guide.md](admin-guide.md) (Persian).

The system improves in three ways as admins use it:

1. **RAG knowledge** grows — accepted feedback and mined corrections become
   retrievable chunks (the learned layer).
2. **Agent behavior** adapts — some accepted feedback becomes per-agent prompt
   instructions that apply on every run.
3. **Worked examples** accumulate — reviewed sessions become few-shot exemplars
   for the logical-model agent.

Everything is observable and reversible from the admin panel, and nothing enters
retrieval or prompts without an explicit human accept.

---

## 1. What v3 adds (map of new code)

| Area | File | What's new |
|---|---|---|
| schema | `core/src/schemas/knowledge.ts` | `RetrievalLogEntry` (telemetry record) |
| schema | `core/src/schemas/session.ts` | `Citation.helpful?`, `BpmnCorrection.learnedFeedbackId?` |
| schema | `core/src/schemas/example.ts` | `ExampleEntry` (worked example = request + `ProcessModel`) |
| schema | `core/src/schemas/behavior.ts` | `BehaviorEntry`, `BehaviorAgent`, `behaviorAgents` |
| store | `core/src/state/retrieval-log.ts` | `RetrievalLog` (JSONL) + `computeGaps()` |
| store | `core/src/state/knowledge-overrides.ts` | `KnowledgeOverridesStore` (durable chunk-disable set) |
| store | `core/src/state/example-store.ts` | `ExampleStore` implements `ExampleBank` (+ BM25 `findSimilar`) |
| store | `core/src/state/behavior-store.ts` | `BehaviorStore` implements `BehaviorLookup` (+ reinforce/update) |
| knowledge | `core/src/knowledge/store.ts` | reversible `disable`/`enable`/`isDisabled`; `search` skips disabled |
| knowledge | `core/src/knowledge/retriever.ts` | `allChunks`, `disable`, `enable`, `isDisabled` passthroughs |
| knowledge | `core/src/knowledge/learned.ts` | public `save()` (persist after in-place edit) |
| agents | `core/src/agents/base.ts` | `AgentContext` gains `logRetrieval`, `exampleBank`, `behavior`; `onRetrieve(results, query)`; `ground(…, filter?)`; new `behaviorBlock()` |
| agents | `core/src/agents/correction-diff.ts` | `runCorrectionDiff` agent (new) |
| agents | `core/src/agents/logical-model.ts` | few-shot `exampleBlock` + `modelDigest` |
| agents | `actors/elicitation/business-rules/implicit/ambiguity/contradiction` | inject `behaviorBlock(ctx, <agent>)`; actors also filters RAG to `glossary`/`domain` |
| agents | `core/src/agents/orchestrator.ts` | per-session ctx now also emits `logRetrieval` |
| server | `server/src/paths.ts` | `retrievalLogPath`, `overridesPath`, `examplesPath`, `behaviorPath` |
| server | `server/src/app.ts` | wires the 4 new stores; applies overrides at startup; passes `exampleBank`/`behavior`/`logRetrieval` to the orchestrator |
| server | `server/src/admin-routes.ts` | knowledge dashboard, gaps, chunk enable/disable, citation flags, manual learned add/edit, stats, correction-learn, examples CRUD, behavior CRUD, behavior accept-destination |
| web | `web/src/admin-api.ts` | typed client for all new endpoints |
| web | `web/src/api.ts` | `Citation.helpful?`, `BpmnCorrection.learnedFeedbackId?` |
| web | `web/src/components/AdminPage.tsx` | 4 new tabs + citation flags + correction-learn + example-promote + behavior destination |
| web | `web/src/styles.css` | styles for the above |

New git-ignored data files under `data/`:

- `retrieval-log.jsonl` — append-only retrieval telemetry.
- `knowledge-overrides.json` — `{ disabled: string[] }` chunk ids.
- `examples.json` — `{ entries: ExampleEntry[] }`.
- `behavior.json` — `{ entries: BehaviorEntry[] }`.

---

## 2. Retrieval telemetry & knowledge gaps

Two things are recorded on every grounding retrieval:

- **Provenance (hits)** — already existed: chunk ids merged into `session.citations`.
- **Telemetry (all lookups)** — new: `RetrievalLogEntry { at, sessionId, phase,
  query, topScore, chunkIds }` appended to `data/retrieval-log.jsonl`.

### Wiring

`AgentContext.onRetrieve` changed from `(results)` to `(results, query)`. The
orchestrator's per-session context ([orchestrator.ts](../packages/core/src/agents/orchestrator.ts))
now does both jobs in one place:

```ts
onRetrieve: (results, query) => {
  recordCitations(session, results);               // provenance (hits)
  this.ctx.logRetrieval?.({                          // telemetry (all)
    at, sessionId: session.id, phase: session.phase,
    query, topScore: results[0]?.score ?? 0,
    chunkIds: results.map(r => r.chunk.id),
  });
}
```

`logRetrieval` is supplied by the server (`app.ts`) as a fire-and-forget append.
Only real analysis retrievals (those routed through `ground()`) are logged; the
admin's similarity checks in the review queue use `retriever.retrieve` directly
and are intentionally not logged.

### Gaps

`computeGaps(entries, threshold = 1)` collapses low-signal lines — empty
`chunkIds` **or** `topScore < threshold` — into distinct `KnowledgeGap`s grouped
by normalized query text, sorted by recurrence. Exposed at
`GET /api/admin/knowledge/gaps`. A gap means "users ask this, the base can't
ground it" — a direct pointer to the next document to write.

> BM25 scores are unbounded, so `threshold = 1` is a heuristic starting point. If
> your corpus/query mix makes it noisy, tune the constant in
> [retrieval-log.ts](../packages/core/src/state/retrieval-log.ts).

---

## 3. Knowledge dashboard (all chunks, usage, usefulness, trace)

`GET /api/admin/knowledge` returns **every** chunk in the live index (base
markdown + learned), each annotated by walking all sessions' citations once
(`citationUsage()` in [admin-routes.ts](../packages/server/src/admin-routes.ts)):

```
{ id, docId, docTitle, kind, text, tags,
  source: "markdown" | "learned",   // docId === LEARNED_DOC_ID ⇒ learned
  disabled,                          // retriever.isDisabled(id)
  usageCount,                        // # sessions that cited it
  helpfulCount, irrelevantCount,     // from Citation.helpful votes
  sessions: string[] }               // trace → session ids
```

**Usage ≠ usefulness.** `usageCount` counts retrievals; usefulness comes from
explicit admin votes. Each `Citation` gained an optional `helpful?: boolean`
(true = helped, false = irrelevant, unset = unrated). Votes are set per session:

`POST /api/admin/sessions/:id/citations/:chunkId/flag { helpful: boolean | null }`
(`null` clears the vote).

A chunk with high `usageCount` and high `irrelevantCount` is retrieval noise —
the dashboard surfaces it for editing or disabling.

### Editing the index safely

The BM25 index is a **cache rebuilt from the markdown corpus**, so edits can't
live inside it — they'd vanish on the next rebuild. The design keeps markdown as
the single source of truth for base knowledge and routes all mutation through
durable side layers:

- **Add** (`POST /api/admin/learned`) — a manual learned entry (skips
  extraction). Goes into the learned layer, which is re-injected at startup, so
  it survives rebuilds. Reinforces on exact-text duplicate instead of duping.
- **Edit learned** (`PATCH /api/admin/learned/:id`) — updates text/kind/tags,
  persists (`LearnedKnowledgeStore.save()`), then `removeChunk` + `addChunks` to
  refresh the live chunk.
- **Disable base chunk** (`POST /api/admin/knowledge/:id/disable` / `…/enable`) —
  reversible. `KnowledgeStore` keeps the chunk in memory but excludes it from
  `search`; `KnowledgeOverridesStore` records the id in
  `data/knowledge-overrides.json`. On startup, `app.ts` re-applies every disabled
  id *after* the base index and learned chunks load (same layering as learned
  injection).
- **Edit base chunk** = disable the original + add a learned replacement (two
  panel actions; no special endpoint).

---

## 4. Correction mining

`session.correction` (admin's hand-fixed BPMN) is the highest-signal before/after
data. The new **`runCorrectionDiff`** agent
([correction-diff.ts](../packages/core/src/agents/correction-diff.ts)) compares the
system's `processModel` digest with the corrected XML + note and produces a
*generalizable* Persian lesson.

`POST /api/admin/sessions/:id/correction/learn`:

1. Requires `session.correction`, not already mined
   (`correction.learnedFeedbackId` guards double-learning).
2. Runs `runCorrectionDiff`; falls back to the admin's `note` if the diff fails.
3. Feeds the lesson through the **same** `extractCandidates` → review queue used
   by written feedback and the question loop. Nothing new in the review UI.

The corrected diagram is passed to the LLM as raw XML (truncated to 12 kB). It is
**not** parsed back into a `ProcessModel` — reversing the generator reliably is
out of scope, so mining produces knowledge candidates, not a rebuilt model.

---

## 5. Golden example bank (case-based few-shot)

Learned *statements* are abstract; a domain-matched worked example moves accuracy
more. `ExampleEntry { id, sessionId, request, processModel, note, createdAt }` is
stored in `data/examples.json` by `ExampleStore`, which implements the read-side
`ExampleBank` interface:

```ts
interface ExampleBank {
  findSimilar(request: string, k: number, excludeSessionId?: string): ExampleEntry[];
}
```

`findSimilar` builds a throwaway `Bm25Index` over stored example *requests* and
returns the closest (excluding the current session). At the `logical_model`
phase, [logical-model.ts](../packages/core/src/agents/logical-model.ts) injects a
**compact digest** of the top match (`modelDigest`: lanes, activities with
type/lane, gateways, branch conditions) as a worked example — never the raw XML,
which would blow up context. The prompt instructs the agent to imitate structure,
not copy blindly.

Admin promotes a reviewed session via `POST /api/admin/examples { sessionId }`;
the entry uses `session.processModel` (requires the session to have produced one).

---

## 6. Behavioral instructions (the non-RAG destination)

Some feedback is about *how an agent should behave* ("always ask about exception
flows"), not domain facts. RAG only helps when retrieval hits; a behavior rule
must apply on **every** run of its agent.

`BehaviorEntry { id, agent, instruction, weight, sources[], createdAt }` lives in
`data/behavior.json` (`BehaviorStore`, implementing `BehaviorLookup`). `agent` is
one of `behaviorAgents` = elicitation, actors, business_rules, implicit,
ambiguity, contradiction, logical_model.

Each agent appends its instructions via `behaviorBlock(ctx, "<agent>")`
([base.ts](../packages/core/src/agents/base.ts)), which pulls
`ctx.behavior.instructionsFor(agent)` — highest-weight first, capped at 8 — and
formats them as a labeled prompt section. The block is empty (no-op) when the
agent has no instructions.

**Two ways to create one:**

- From the review queue: the accept dialog has a **destination** selector. Choose
  "behavior" + an agent, and `…/accept { destination: "behavior", agent }` routes
  the candidate into `BehaviorStore` instead of the learned layer (reinforce on
  duplicate, same as knowledge).
- Directly: `POST /api/admin/behavior { agent, instruction }`.

Also `PATCH /api/admin/behavior/:id` and `DELETE /api/admin/behavior/:id`.

---

## 7. Feedback & knowledge analytics

`GET /api/admin/stats` derives everything from existing stores (no new data):

```
candidates: { pending, accepted, rejected, byKind }
sessions:   { total, withFeedback, withCorrection }
learned:    { total, byKind, reinforcements }   // reinforcements = Σ(weight − 1)
behavior:   number
examples:   number
topTags:    [{ tag, count }]                     // top 10 candidate tags
```

Rendered as stat cards + breakdowns in the "آمار" (stats) tab. It shows *where*
the pipeline fails most (e.g. many `domain` candidates ⇒ thin domain docs).

---

## 8. Full new-endpoint list (`/api/admin/*`, token-guarded)

| Method & path | Purpose |
|---|---|
| `GET /knowledge` | all chunks + source/usage/usefulness/trace |
| `GET /knowledge/gaps` | queries the base couldn't ground |
| `POST /knowledge/:id/disable` · `/enable` | reversible chunk disable (durable) |
| `POST /learned` | manual learned add (reinforces on dup) |
| `PATCH /learned/:id` | edit learned text/kind/tags + refresh chunk |
| `POST /sessions/:id/citations/:chunkId/flag` | 👍/👎/clear a citation |
| `GET /stats` | feedback & knowledge analytics |
| `POST /sessions/:id/correction/learn` | mine a corrected diagram → queue |
| `GET/POST/DELETE /examples` | golden example bank |
| `GET/POST/PATCH/DELETE /behavior` | behavioral instructions |
| `POST /feedback/:fid/candidates/:cid/accept` | now also accepts `{ destination: "behavior", agent }` |

All are guarded by `x-admin-token` when `ADMIN_TOKEN` is set (open in dev when
empty), exactly like the existing admin API.

---

## 9. Design invariants

- **Human gate before anything ships.** No retrieval chunk or prompt instruction
  appears without an explicit admin accept (or manual add).
- **Reversible & provenance-carrying.** Learned/behavior entries keep `sources[]`;
  disables are tracked in a file; every mutation has a delete/enable path.
- **Markdown corpus stays the source of truth.** All admin edits live in side
  layers (learned/overrides), so `data/knowledge-index.json` can be rebuilt from
  `knowledge/` at any time without losing curation.
- **Best-effort learning never blocks a turn.** Retrieval logging is
  fire-and-forget; correction diffing falls back to the note; extraction failures
  are stored, not thrown.
- **Same review queue for every source.** Written feedback, answered questions,
  and mined corrections all converge on one `KnowledgeCandidate` queue.
