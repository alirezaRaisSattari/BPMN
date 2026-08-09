# Knowledge service

Current implementation lives in [knowledge.py](../bpmn_analyst/knowledge.py), with schemas in
[models.py](../bpmn_analyst/models.py), durable learning stores in
[stores.py](../bpmn_analyst/stores.py), and API wiring in [app.py](../bpmn_analyst/app.py).

## Data flow

1. `build_knowledge()` loads `data/knowledge-index.json` when valid.
2. Missing or corrupt cache triggers ingestion of Markdown/text files under `knowledge/`.
3. Frontmatter supplies `title`, `kind`, and comma-separated `tags`.
4. Paragraph-aware chunks are indexed by Unicode BM25.
5. Approved learned entries are injected as `learned-from-feedback` chunks.
6. Durable overrides disable selected chunks without deleting them.
7. Agents call `ground()` and receive formatted context; retrieval hits become session citations.
8. Every retrieval is appended to JSONL. Low-score or empty searches become knowledge gaps.

## Retrieval

`KnowledgeStore` owns chunks, a BM25 index, disabled IDs, and optional embeddings.
`KnowledgeRetriever` exposes retrieval, formatted context, live add/remove, and enable/disable.

Default retrieval is dependency-free BM25 and supports Persian and English tokens. Semantic
retrieval is optional: set `KNOWLEDGE_EMBEDDINGS=on` and install `sentence-transformers`.
`create_local_embedder()` loads `sentence-transformers/all-MiniLM-L6-v2`; loading or inference
failure falls back to BM25 without losing service availability.

## Agent grounding

| Agent | Query | Top K | Filter |
|---|---|---:|---|
| Elicitation | request plus roles/stages/rules | 3 | none |
| Actors | roles involved in request | 3 | glossary or domain |
| Business rules | business rules for request | 3 | none |
| Implicit knowledge | domain conventions and best practices | 5 | none |
| Contradiction | correct rules and ordering | 3 | none |
| Logical model | BPMN events, gateways, lanes, flows | 5 | none |
| Reviewer | BPMN validation checklist | 4 | none |

Prompts are in [agents](../bpmn_analyst/agents). `AgentContext` injects retriever, example bank,
behavior store, citation callback, and retrieval logger.

## Learning layer

Admin feedback is extracted into typed candidates. Accepted knowledge candidates are stored in
`data/learned-knowledge.json`, deduplicated by normalized text, reinforced by weight, and inserted
into live retrieval. Behavior candidates instead become per-agent prompt instructions in
`data/behavior.json`. Reviewed sessions may become examples in `data/examples.json`.

Knowledge dashboard combines all base and learned chunks with:

- enabled/disabled state;
- citation usage and unique sessions;
- helpful/irrelevant ratings;
- source, kind, and tags;
- recurring low-score retrieval gaps.

All JSON snapshot writes are atomic (`.tmp` plus replace). Retrieval telemetry remains append-only
JSONL and tolerates malformed partial lines while reading.
