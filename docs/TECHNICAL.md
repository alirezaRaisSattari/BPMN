# BPMN Analyst — Technical Reference

## Runtime

Python 3.13 backend uses FastAPI, Pydantic v2, HTTPX, and Uvicorn. React/Vite frontend remains TypeScript. File-backed JSON persistence keeps former session, feedback, eval, learned-knowledge, behavior, example, and override shapes readable.

## Request flow

`FastAPI → deterministic orchestrator → LLM provider + BM25 knowledge → process model validation → BPMN XML/DI + Markdown → atomic JSON persistence`

Public API supports session CRUD, normal/streamed turns, downloads, and user answers. SSE order is `created`, zero or more `phase`, `delta`, then `done` or `error`. Admin API retains feedback, learned knowledge, chunk controls, questions, corrections, examples, behavior, statistics, and evals. FastAPI publishes OpenAPI at `/docs` and `/openapi.json`.

## BPMN layout

Python generator creates semantic BPMN 2.0 XML and deterministic DI. Topological levels form columns; stable ID ordering forms rows. Events, gateways, and tasks use distinct dimensions. Sequence flows use orthogonal waypoints. Cyclic or disconnected nodes receive stable fallback columns. Layout failure returns semantic XML rather than losing output.

## Storage

Session, feedback, and eval records remain one JSON file per entity. Single-file stores retain existing wrapper keys. Writes use same-directory temporary files followed by atomic replacement.

## Verification

- `python -m pytest`: models, legacy persistence, RAG, BPMN validation/layout, public API, SSE, and admin workflows.
- `npm.cmd run typecheck && npm.cmd run build`: frontend contract and production bundle.
- `tests/e2e_browser.py`: streamed chat, completed model, rendered BPMN SVG, session history, admin access, browser errors.
- Real-provider verification depends on configured endpoint availability and balance.
