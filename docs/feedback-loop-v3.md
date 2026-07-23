# Learning Loop v3 — knowledge ops & deeper learning

Builds on [admin-feedback-plan.md](admin-feedback-plan.md) and
[feedback-loop-v2.md](feedback-loop-v2.md). v2 closed the loop *into* the
knowledge base; v3 makes the knowledge base itself observable and manageable
(features 1–3, the small wins), then adds the deeper learning channels (4–6).

Suggested build order: **1 → 2 → 3 → 4 → 5 → 6** (small wins first).

## 1. Knowledge dashboard — see, trace, and manage all RAG data

One admin tab («دانش») showing **every** chunk in the live index — base
markdown corpus *and* learned entries — with usage and usefulness signals.

### 1a. Usage stats + trace

- `GET /api/admin/knowledge` → all chunks with
  `{id, docTitle, kind, source: "markdown" | "learned", text, usageCount, sessions[]}`.
  `usageCount` = number of sessions whose `citations` include the chunk
  (same derivation the learned tab already uses — generalize it to all chunks).
- Clicking a chunk shows the sessions that cited it (trace), linking into the
  existing session review view.

### 1b. Retrieval log + knowledge gaps

Citations only record *hits*. To see what the knowledge base **fails** to
answer, log every retrieval:

- Extend `AgentContext.onRetrieve` to `(results, query)` so the query is
  available; `ground()` passes it through.
- Server appends `{at, sessionId, phase, query, topScore, chunkIds}` to
  `data/retrieval-log.jsonl` (append-only, no index rebuild).
- **Gaps view**: log lines with `topScore` below a threshold (or zero results),
  grouped by similar query text. This tells the admin exactly which document to
  write next — it directs the learning loop instead of leaving it reactive.

### 1c. Usefulness flags (usage ≠ usefulness)

A chunk can be retrieved often and never help. Add an explicit signal:

- In the session review view, the citations list gets 👍/👎 per citation →
  `Citation.helpful?: boolean` on the session.
- Dashboard aggregates per chunk: `{usageCount, helpfulCount, irrelevantCount}`.
  Chunks with high usage + high irrelevant count are retrieval noise — first
  candidates for editing or disabling.

### 1d. Add / edit / remove from the panel

The BM25 index is a **cache** rebuilt from the markdown corpus — editing chunks
inside it directly would be silently lost on the next rebuild. So:

- **Add**: `POST /api/admin/learned` — a manual learned entry (statement, kind,
  tags) that skips extraction and goes straight into the learned layer. Reuses
  `learnedToChunk` + live inject; survives rebuilds by design.
- **Edit learned**: `PATCH /api/admin/learned/:id` — update text/kind/tags,
  persist, `removeChunk` + `addChunks` to refresh the live index.
- **Disable base chunk**: tombstone list in `data/knowledge-overrides.json`
  (`{disabled: [chunkId...]}`), applied at startup *after* the index loads
  (same pattern as learned injection) and `removeChunk` live on toggle.
- **Edit base chunk** = disable original + add a learned replacement. Markdown
  files stay the single source of truth for base knowledge.

## 2. Feedback analytics (small)

`GET /api/admin/stats` → counts derived from existing stores, no new data:

- candidates accepted / rejected / pending, grouped by `kind` and top tags
- sessions with feedback vs. without; sessions with corrections
- learned entries by kind; total reinforcements (Σ weight − entries)

Rendered as summary cards at the top of the admin panel. Shows *where* the
pipeline fails most (e.g. many `domain` corrections → domain docs are thin).

## 3. Glossary-aware grounding (small)

`knowledgeKinds` already has `glossary` and `KnowledgeStore.search` already
takes a `ChunkFilter` — but `ground()` never passes one.

- `ground(ctx, query, k, filter?)` forwards the filter.
- The **actors agent** grounds with `kind ∈ {glossary, domain}` so role naming
  is anchored to learned terminology → consistent lane names across sessions.
- Admins add glossary entries via 1d (manual add with kind `glossary`).

## 4. Correction mining — learn from corrected diagrams

`session.correction` captures the highest-signal before/after data, but nothing
learns from it yet. Same pattern as the question loop (`.../questions/:qid/learn`):

- **`runCorrectionDiff` agent**: input = the session's `processModel` (compact
  digest) + corrected BPMN XML (parsed to element/lane/gateway lists) + the
  admin's `note`. Output = structured Persian description of the delta
  ("مسیر رد پس از تأیید مدیر اضافه شد", "نقش مالی به دو لِین تفکیک شد").
- `POST /api/admin/sessions/:id/correction/learn` feeds that description into
  the existing `extractCandidates` → review queue. Nothing new to review-UI.
- `BpmnCorrection.learnedFeedbackId?` guards against double-learning
  (same as `AdminQuestion`).
- Bonus: sessions with a correction get a "promote to eval case" hint, with
  expectations derived from the **corrected** model (its lanes → `expectedRoles`,
  its gateways → `mustHaveRejectionPath`).

## 5. Golden example bank — case-based few-shot

Learned *statements* are abstract; a domain-matched worked example moves LLM
accuracy more.

- `ExampleEntry {id, sessionId, request, processModel, note, createdAt}` in
  `data/examples.json` (`ExampleStore`, same shape as `LearnedKnowledgeStore`).
- Admin promotes a reviewed session (prefer one with an accepted correction —
  parse the corrected XML back to a model, else use `session.processModel`).
- At the `logical_model` phase, retrieve the top-1 most similar example by
  request text (BM25 over `request`) and inject a **compact digest** of its
  model (roles, activity list, gateway conditions) into the prompt as a worked
  example — not the raw XML, which would blow up the context.
- Admin tab lists examples with delete (mirrors the learned tab).

## 6. Behavioral instructions — the non-RAG destination

Some accepted feedback is about *agent behavior*, not domain knowledge
("elicitation باید همیشه دربارهٔ مسیرهای استثنا بپرسد"). RAG only helps when
retrieval hits; behavior rules must apply **always** for their agent.

- Accept dialog gains a destination choice: **knowledge** (today's path) or
  **behavior** → `BehaviorEntry {id, agent, instruction, weight, sources[]}`
  in `data/behavior.json`.
- `agent` ∈ {elicitation, actors, business_rules, implicit, ambiguity,
  contradiction, logical_model}.
- Each agent appends its entries (sorted by weight, capped at ~8) to its system
  prompt via a shared `behaviorBlock(agent)` helper in `base.ts`.
- Admin UI: per-agent list with edit/delete (mirrors learned tab). Reinforce-on-
  duplicate applies here too.

## Deferred: full LLM session replay

The deterministic eval runner already guards the generation/validation pipeline.
Replaying full transcripts through the LLM would also catch prompt/knowledge
regressions, but costs one full session per case per run — revisit when
volume justifies it.

## Data model summary

| Type | New/changed |
| --- | --- |
| `Citation` | `helpful?: boolean` |
| `BpmnCorrection` | `learnedFeedbackId?: string` |
| `AgentContext.onRetrieve` | `(results, query)` |
| `RetrievalLogLine` | `{at, sessionId, phase, query, topScore, chunkIds}` (JSONL) |
| `KnowledgeOverrides` | `{disabled: string[]}` |
| `ExampleEntry` | `{id, sessionId, request, processModel, note, createdAt}` |
| `BehaviorEntry` | `{id, agent, instruction, weight, sources[], createdAt}` |

## New endpoints

- `GET  /api/admin/knowledge` · `POST /api/admin/knowledge/:id/disable` (+enable)
- `POST /api/admin/learned` (manual add) · `PATCH /api/admin/learned/:id`
- `POST /api/admin/sessions/:id/citations/:chunkId/flag` `{helpful}`
- `GET  /api/admin/knowledge/gaps` (from retrieval log)
- `GET  /api/admin/stats`
- `POST /api/admin/sessions/:id/correction/learn`
- `GET/POST/DELETE /api/admin/examples`
- `GET/POST/PATCH/DELETE /api/admin/behavior`
