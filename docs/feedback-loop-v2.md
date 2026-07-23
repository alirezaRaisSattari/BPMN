# Feedback Loop v2 — quality features

Builds on [admin-feedback-plan.md](admin-feedback-plan.md). Seven additions that
make outputs measurably better over time and let admins pull missing knowledge
from users.

## 1. Retrieval provenance (which knowledge was used)

Every RAG lookup goes through one function — `ground()` in `agents/base.ts`.
Add an optional `onRetrieve` collector to `AgentContext`; `ground` calls it with
the retrieved results. The orchestrator threads a per-session ctx so all phases
of a turn accumulate unique citations into `session.citations`
(`{chunkId, docId, docTitle, kind}`).

- Enables **usage counts** (feature 5 below) and the user-facing sources list.

## 6. Show sources to the user

The chat view renders a "دانش استفاده‌شده" (knowledge used) list from
`session.citations` once the analysis is done, so users see what grounded the
model — and have something concrete to give feedback on.

## 5. Per-rule weighting

`LearnedEntry.weight` (default 1). Accepting a candidate whose normalized text
equals an existing learned entry **reinforces** it (weight++, provenance
appended) instead of duplicating. Learned tab sorts by weight; admin usage count
(sessions whose citations include the entry's chunk) is shown per entry.

## 4. Contradiction detection

When building candidates, after computing the top similar chunks, a small LLM
classifier (`runConflictCheck`) checks the top match: does the candidate
**contradict** existing knowledge (vs. merely overlap)? Conflicts render red in
the queue so an admin resolves them deliberately.

## 2. Admin corrects the diagram

Admin can paste corrected BPMN XML for a session
(`POST /api/admin/sessions/:id/correction`). It is validated (well-formed XML +
parseable) and stored as `session.correction {bpmnXml, note, at}`. This captures
the highest-signal before/after data and shows in the eval expectations.

## 3. Evaluation suite from reviewed sessions

Admin promotes a reviewed session to a **golden eval case**
(`data/eval/*.json`): request + structural expectations (bpmn valid, min roles,
min activities, must-have rejection path, expected role names). A deterministic
runner (`npm run eval` in core, also `POST /api/admin/eval/run`) reruns the
stored model through `produceOutputs` and checks expectations — no LLM needed, so
it guards the deterministic generation/validation pipeline against regressions.

## 7. Admin → user question loop

An admin reviewing a session may need info only the user has.

- Admin posts a question: `POST /api/admin/sessions/:id/questions {question}` →
  `session.adminQuestions[]` (status `pending`).
- The **user** sees pending questions in the chat view and answers them:
  `POST /api/sessions/:id/questions/:qid/answer {answer}` (public, no admin
  token) → status `answered`.
- Admin can **learn from the answer**:
  `POST /api/admin/sessions/:id/questions/:qid/learn` runs the same extraction
  pipeline on the Q&A, producing knowledge candidates that flow through the
  normal review queue.

## Data model summary

| Type | New fields |
| --- | --- |
| `SessionState` | `citations[]`, `adminQuestions[]`, `correction?` |
| `AdminQuestion` | `id, question, answer?, status, createdAt, answeredAt?` |
| `Citation` | `chunkId, docId, docTitle, kind` |
| `SimilarChunk` | `conflict`, `conflictReason` |
| `LearnedEntry` | `weight`, `sources[]` |
| `EvalCase` | `id, sessionId, request, expected{...}, note, createdAt` |

## New endpoints

- `POST /api/sessions/:id/questions/:qid/answer` (public)
- `POST /api/admin/sessions/:id/questions` · `.../questions/:qid/learn`
- `POST /api/admin/sessions/:id/correction`
- `GET/POST/DELETE /api/admin/eval` · `POST /api/admin/eval/run`
- `GET /api/admin/learned` now includes `weight` + `usageCount`
