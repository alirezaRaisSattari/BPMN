# Admin Feedback → Knowledge Loop

Admins review finished chat sessions, write feedback, and the system turns the
generalizable parts of that feedback into reviewed knowledge that improves RAG.

## Flow

1. Admin opens the admin panel (`#admin`, token-gated via `ADMIN_TOKEN`).
2. Picks a session → sees transcript + BPMN output → writes feedback.
3. Server saves the feedback and runs the **feedback-extractor agent**: an LLM
   pass that extracts only *generalizable* knowledge points (statement,
   rationale, kind, tags). Session-specific one-off corrections are filtered out.
4. Each candidate is snapshotted with the top-3 most similar existing knowledge
   chunks (duplicate/conflict warning) and enters the **review queue** as
   `pending`.
5. Admin can edit statement/kind/tags, then **accept** or **reject**.
6. Accepted candidates become `LearnedEntry` records in
   `data/learned-knowledge.json` (with sessionId/feedbackId provenance) and are
   injected into the live retriever immediately. On startup, learned entries are
   re-injected after the base markdown index loads — so rebuilding the base
   index never loses learned knowledge.
7. The **learned** tab lists all learned entries; deleting one removes it from
   both the JSON file and the in-memory index (BM25 rebuilt).

## Pieces

| Layer | File | What |
| --- | --- | --- |
| core | `schemas/feedback.ts` | `AdminFeedback`, `KnowledgeCandidate`, `LearnedEntry`, `SimilarChunk` |
| core | `state/feedback-store.ts` | `FileFeedbackStore` — one JSON per feedback in `data/feedback/` |
| core | `knowledge/learned.ts` | `LearnedKnowledgeStore` (persists learned JSON) + `learnedToChunk` |
| core | `knowledge/store.ts` | `removeChunk()` + BM25 rebuild; retriever passthroughs |
| core | `agents/feedback-extractor.ts` | structured extraction (Persian prompt, `generalizable` flag) |
| server | `admin-routes.ts` | `/api/admin/*` guarded by `x-admin-token` = `ADMIN_TOKEN` (empty → open, dev mode) |
| server | `app.ts`, `paths.ts` | wire stores, inject learned chunks at startup |
| web | `admin-api.ts` | typed client, token from localStorage |
| web | `components/admin/AdminPage.tsx` | login gate + tabs: جلسات / صف بررسی / دانش آموخته |
| web | `App.tsx` | hash-based view switch (`#admin`) |

## API

- `GET  /api/admin/ping` — token check
- `GET  /api/admin/feedback` — all feedback with candidates
- `POST /api/admin/sessions/:id/feedback` `{ text }` — save + extract candidates
- `POST /api/admin/feedback/:fid/candidates/:cid/accept` `{ statement?, kind?, tags? }`
- `POST /api/admin/feedback/:fid/candidates/:cid/reject`
- `DELETE /api/admin/feedback/:id`
- `GET  /api/admin/learned` / `DELETE /api/admin/learned/:id`

## Design decisions

- **Human gate before RAG**: nothing enters retrieval without explicit accept.
- **Learned knowledge is a separate layer** (`learned-knowledge.json`), not
  appended to the markdown corpus — markdown ingest assumes one kind per file,
  and a separate layer keeps provenance and reversibility trivial.
- **Extraction failure is non-fatal**: feedback is stored with
  `extractionError` so the admin's text is never lost.
- **Auth is a single shared token** — deliberate scope choice for this project;
  swap for real users later if needed.
