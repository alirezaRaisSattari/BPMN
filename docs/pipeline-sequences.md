# Runtime sequences

## Streamed analysis turn

```mermaid
sequenceDiagram
  participant UI as React UI
  participant API as FastAPI app.py
  participant OR as Orchestrator
  participant AG as Specialized agents
  participant KB as KnowledgeRetriever
  participant LLM as LLMProvider
  participant FS as JSON stores

  UI->>API: POST /api/sessions/stream
  API->>FS: save new session
  API-->>UI: created
  API->>OR: begin(session, request, progress)
  OR-->>API: progress(phase)
  API-->>UI: phase
  OR->>AG: run phase agent
  AG->>KB: retrieve(query, k, filter)
  KB-->>AG: ranked chunks
  AG->>LLM: structured(Pydantic schema, prompt)
  LLM-->>AG: validated result or repair retry
  AG-->>OR: typed result
  OR->>OR: deterministic phase transition
  OR->>FS: outputs and citations in session
  API-->>UI: delta chunks
  API-->>UI: done(session, reply, awaitingUser)
```

Failures after stream open emit `error` with persisted session. Client disconnect cancels in-flight
orchestration/provider work and keeps current session state. Non-stream JSON routes return status 502
with `{ "error": "..." }`; create also includes `sessionId`.

## Phase state machine

```mermaid
flowchart LR
  Intake --> Elicitation
  Elicitation -->|needs detail| Elicitation
  Elicitation -->|ready or user says build| Actors
  Actors --> Rules[Business rules]
  Rules --> Implicit[Implicit knowledge]
  Implicit -->|proposals| Confirm[User confirmation]
  Confirm --> Ambiguity
  Implicit -->|none| Ambiguity
  Ambiguity -->|open items| Ambiguity
  Ambiguity --> Contradiction
  Contradiction -->|open items| Contradiction
  Contradiction --> Logical[Logical model]
  Logical --> BPMN[BPMN generation + DI]
  BPMN --> Outputs[Summary + Markdown]
  Outputs --> Done
```

Each phase has a separate prompt and typed output under [agents](../bpmn_analyst/agents).
Coordinator code is [orchestrator.py](../bpmn_analyst/orchestrator.py).

## Feedback and learning

```mermaid
sequenceDiagram
  participant A as Admin UI
  participant API as FastAPI admin routes
  participant FX as Feedback extractor
  participant CC as Conflict check
  participant KB as Knowledge retriever
  participant ST as Learning stores

  A->>API: submit feedback
  API->>FX: extract typed points
  FX-->>API: generalizable and session-only points
  API->>KB: retrieve similar chunks
  API->>CC: compare strongest match
  API->>ST: persist feedback + pending candidates
  A->>API: accept/reject candidate
  alt knowledge destination
    API->>ST: add or reinforce learned entry
    API->>KB: inject live learned chunk
  else behavior destination
    API->>ST: add or reinforce per-agent instruction
  end
```

Correction learning first runs correction-diff agent, then feeds its generalizable description into
same feedback extraction/review queue. Answered admin questions use same path. Reviewed sessions can
also become few-shot examples or deterministic eval cases.

## Knowledge startup and use

```mermaid
sequenceDiagram
  participant API as State.initialize
  participant IDX as knowledge-index.json
  participant DOC as knowledge/*.md
  participant LRN as learned-knowledge.json
  participant OVR as knowledge-overrides.json
  participant RET as KnowledgeRetriever

  API->>IDX: load cached chunks
  alt cache absent/corrupt
    API->>DOC: parse frontmatter and chunk paragraphs
    API->>IDX: atomic cache write
  end
  API->>LRN: load learned entries
  API->>RET: inject learned chunks
  API->>OVR: load disabled IDs
  API->>RET: reapply disables
```

Retrieval calls append JSONL telemetry. Admin knowledge dashboard aggregates citations, usefulness,
disabled state, source, and recurring low-score gaps.

## Code map

- Backend/API: [app.py](../bpmn_analyst/app.py)
- Schemas: [models.py](../bpmn_analyst/models.py)
- LLM providers: [llm.py](../bpmn_analyst/llm.py)
- Agents/prompts: [agents](../bpmn_analyst/agents)
- Orchestration: [orchestrator.py](../bpmn_analyst/orchestrator.py)
- Knowledge: [knowledge.py](../bpmn_analyst/knowledge.py)
- BPMN XML/DI/validation: [bpmn.py](../bpmn_analyst/bpmn.py)
- Outputs/evals: [output.py](../bpmn_analyst/output.py), [eval.py](../bpmn_analyst/eval.py)
- Persistence: [stores.py](../bpmn_analyst/stores.py)
- Frontend stream client: [api.ts](../packages/web/src/api.ts)
