# Learning loop: technical reference

Learning has three destinations. All preserve source provenance and reinforcement weight.

| Destination | Store | Runtime use |
|---|---|---|
| Knowledge | `data/learned-knowledge.json` | Injected into BM25/semantic retrieval |
| Agent behavior | `data/behavior.json` | Top weighted instructions appended to selected agent prompt |
| Golden example | `data/examples.json` | Closest reviewed process injected into logical-model prompt |

Schemas are in [models.py](../bpmn_analyst/models.py). Persistence and duplicate normalization are in
[stores.py](../bpmn_analyst/stores.py). Admin workflows are in [app.py](../bpmn_analyst/app.py).

## Feedback extraction

1. Admin text is always persisted, even when provider fails.
2. Feedback-extractor returns typed points with statement, rationale, kind, tags, and
   `generalizable`.
3. Session-only points are discarded from review queue.
4. Each reusable candidate stores three closest chunks.
5. Strongest match receives best-effort LLM conflict classification.
6. Pending candidate can be rejected or accepted into knowledge/behavior.
7. Repeated normalized statement reinforces existing entry instead of adding duplicate.

Accepted learned entries are immediately searchable. Editing refreshes live chunk. Removing deletes
both durable entry and live chunk. Base Markdown chunks remain immutable through API; they can be
disabled/re-enabled via durable overrides.

## Correction and answer mining

Correction-diff compares generated process structure with admin BPMN and note. Its output passes
through normal extraction and human review. Empty diff falls back to admin note. Each correction and
answered admin question can be mined once; `learnedFeedbackId` enforces idempotency.

## Retrieval provenance

Every grounded phase:

- adds deduplicated chunk citations to session;
- appends query, phase, score, and chunk IDs to `data/retrieval-log.jsonl`;
- exposes citation helpful/irrelevant flag in admin review.

Knowledge dashboard aggregates per-chunk usage, helpful/irrelevant counts, unique sessions, source,
kind, tags, and disabled state. `compute_gaps()` groups empty/low-score retrievals by normalized query,
then orders by recurrence and recency.

## Behavioral instructions

Behavior entry belongs to one of: `elicitation`, `actors`, `business_rules`, `implicit`, `ambiguity`,
`contradiction`, `logical_model`. Agents receive at most eight instructions, highest weight/newest
first. Same normalized text for same agent reinforces weight and provenance.

## Examples and evaluation

Reviewed session with process model can be promoted to example. `ExampleStore.find_similar()` ranks
request text using BM25 and excludes current session. Logical-model prompt receives closest example’s
roles, activities, gateways, and conditions.

Eval promotion derives baseline expectations from reviewed session. Deterministic runner checks:

- structural validity and BPMN generation;
- minimum roles and activities;
- required role names;
- exclusive-gateway rejection/return branch.

## Durability

Session, feedback, and eval objects use one JSON file per ID. Learned, behavior, examples, and
overrides use atomic JSON snapshots. Retrieval log uses append-only JSONL and skips corrupt lines.
Existing TypeScript-era JSON shapes remain readable and round-trip through Pydantic models.
