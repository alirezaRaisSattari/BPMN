from __future__ import annotations

import asyncio
import json
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator
from uuid import uuid4

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse, StreamingResponse
from pydantic import BaseModel, Field

from .core import DirectoryStore, JsonStore, Knowledge, Orchestrator, Provider, SessionStore, validate_model
from .models import AdminQuestion, Session, now

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"


class TextBody(BaseModel):
    request: str = Field(min_length=1)


class MessageBody(BaseModel):
    message: str = Field(min_length=1)


class AnswerBody(BaseModel):
    answer: str = Field(min_length=1)


class State:
    def __init__(self) -> None:
        load_dotenv(ROOT / ".env")
        self.provider = Provider()
        self.sessions = SessionStore(DATA / "sessions")
        self.knowledge = Knowledge(ROOT / "knowledge", DATA / "knowledge-index.json")
        self.orchestrator = Orchestrator(self.provider, self.knowledge)
        self.feedback = DirectoryStore(DATA / "feedback")
        self.learned = JsonStore(DATA / "learned-knowledge.json", [])
        self.behavior = JsonStore(DATA / "behavior.json", [])
        self.examples = JsonStore(DATA / "examples.json", [])
        self.evals = DirectoryStore(DATA / "eval")
        self.overrides = JsonStore(DATA / "knowledge-overrides.json", [])


state: State


@asynccontextmanager
async def lifespan(_: FastAPI):
    global state
    state = State()
    yield


app = FastAPI(title="BPMN Analyst API", version="0.2.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    detail = "; ".join(f"{'.'.join(map(str, e['loc']))} {e['msg']}" for e in exc.errors())
    return JSONResponse({"error": detail or "invalid request"}, status_code=400)


@app.exception_handler(HTTPException)
async def http_error(_: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse({"error": str(exc.detail)}, status_code=exc.status_code)


@app.exception_handler(Exception)
async def internal_error(_: Request, exc: Exception) -> JSONResponse:
    return JSONResponse({"error": str(exc) or "internal error"}, status_code=500)


def require_session(session_id: str) -> Session:
    session = state.sessions.get(session_id)
    if not session: raise HTTPException(404, "session not found")
    return session


def turn_json(turn: Any) -> dict[str, Any]: return turn.model_dump(exclude_none=True)


@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {"ok": True, "provider": state.provider.name, "model": state.provider.model,
            "knowledgeChunks": len(state.knowledge.chunks)}


@app.post("/api/sessions")
async def create(body: TextBody) -> dict[str, Any]:
    session = Session.create(body.request)
    try: turn = await state.orchestrator.begin(session, body.request)
    except Exception as exc:
        state.sessions.save(session); raise HTTPException(502, f"خطای مدل زبانی: {exc}")
    state.sessions.save(turn.session); return turn_json(turn)


@app.post("/api/sessions/{session_id}/messages")
async def message(session_id: str, body: MessageBody) -> dict[str, Any]:
    session = require_session(session_id)
    try: turn = await state.orchestrator.respond(session, body.message)
    except Exception as exc:
        state.sessions.save(session); raise HTTPException(502, f"خطای مدل زبانی: {exc}")
    state.sessions.save(turn.session); return turn_json(turn)


def frame(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


async def stream_turn(session: Session, first: str | None = None, message_text: str | None = None) -> AsyncIterator[str]:
    state.sessions.save(session)
    yield frame("created", {"session": session.model_dump(exclude_none=True)})
    phases: list[str] = []
    try:
        turn = await (state.orchestrator.begin(session, first or "", phases.append) if first is not None
                      else state.orchestrator.respond(session, message_text or "", phases.append))
        state.sessions.save(turn.session)
        for phase in phases: yield frame("phase", {"phase": phase})
        for chunk in turn.reply.split(" "):
            yield frame("delta", {"text": chunk + " "}); await asyncio.sleep(.001)
        yield frame("done", {"session": turn.session.model_dump(exclude_none=True),
                             "reply": turn.reply, "awaitingUser": turn.awaitingUser})
    except Exception as exc:
        state.sessions.save(session); yield frame("error", {"error": f"خطای مدل زبانی: {exc}", "session": session.model_dump(exclude_none=True)})


@app.post("/api/sessions/stream")
async def create_stream(body: TextBody) -> StreamingResponse:
    return StreamingResponse(stream_turn(Session.create(body.request), first=body.request), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"})


@app.post("/api/sessions/{session_id}/messages/stream")
async def message_stream(session_id: str, body: MessageBody) -> StreamingResponse:
    return StreamingResponse(stream_turn(require_session(session_id), message_text=body.message), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"})


@app.get("/api/sessions")
async def list_sessions() -> dict[str, Any]: return {"sessions": state.sessions.list()}


@app.get("/api/sessions/{session_id}")
async def get_session(session_id: str) -> dict[str, Any]: return {"session": require_session(session_id).model_dump(exclude_none=True)}


@app.delete("/api/sessions/{session_id}")
async def delete_session(session_id: str) -> dict[str, bool]:
    if not state.sessions.remove(session_id): raise HTTPException(404, "session not found")
    return {"ok": True}


@app.get("/api/sessions/{session_id}/bpmn")
async def download_bpmn(session_id: str) -> PlainTextResponse:
    xml = require_session(session_id).outputs.bpmnXml
    if not xml: raise HTTPException(404, "no BPMN yet")
    return PlainTextResponse(xml, media_type="application/xml", headers={"Content-Disposition": 'attachment; filename="process.bpmn"'})


@app.get("/api/sessions/{session_id}/document")
async def download_document(session_id: str) -> PlainTextResponse:
    doc = require_session(session_id).outputs.document
    if not doc: raise HTTPException(404, "no document yet")
    return PlainTextResponse(doc, media_type="text/markdown", headers={"Content-Disposition": 'attachment; filename="process.md"'})


@app.post("/api/sessions/{session_id}/questions/{question_id}/answer")
async def answer_question(session_id: str, question_id: str, body: AnswerBody) -> dict[str, Any]:
    session = require_session(session_id)
    question = next((q for q in session.adminQuestions if q.id == question_id), None)
    if not question: raise HTTPException(404, "question not found")
    question.answer, question.status, question.answeredAt = body.answer, "answered", now()
    session.updatedAt = question.answeredAt; state.sessions.save(session)
    return {"question": question.model_dump(exclude_none=True)}


admin = APIRouter(prefix="/api/admin")


def admin_auth(x_admin_token: str = Header(default="")) -> None:
    expected = os.getenv("ADMIN_TOKEN", "")
    if expected and x_admin_token != expected: raise HTTPException(401, "invalid admin token")


def items(store: Any, key: str | None = None) -> list[dict[str, Any]]:
    value = store.read()
    if isinstance(value, list): return value
    return value.get(key, []) if key else next((v for v in value.values() if isinstance(v, list)), [])


def save_items(store: Any, values: list[dict[str, Any]], key: str | None = None) -> None:
    current = store.read()
    if key and isinstance(current, dict): current[key] = values; store.write(current)
    else: store.write(values)


@admin.get("/ping", dependencies=[Depends(admin_auth)])
async def ping() -> dict[str, bool]: return {"ok": True}


@admin.get("/feedback", dependencies=[Depends(admin_auth)])
async def feedback_list() -> dict[str, Any]: return {"feedback": items(state.feedback, "feedback")}


@admin.post("/sessions/{session_id}/feedback", dependencies=[Depends(admin_auth)])
async def feedback_add(session_id: str, body: dict[str, Any]) -> dict[str, Any]:
    session = require_session(session_id); values = items(state.feedback, "feedback")
    text = str(body.get("text", "")).strip()
    entry_id = str(uuid4())
    candidate = {"id": str(uuid4()), "statement": text, "rationale": "بازخورد مستقیم مدیر",
                 "kind": "domain", "tags": [], "status": "pending", "similar": [], "createdAt": now()}
    entry = {"id": entry_id, "sessionId": session_id, "sessionRequest": session.request,
             "text": text, "createdAt": now(), "candidates": [candidate] if text else []}
    values.append(entry); save_items(state.feedback, values, "feedback"); return {"feedback": entry}


@admin.delete("/feedback/{feedback_id}", dependencies=[Depends(admin_auth)])
async def feedback_delete(feedback_id: str) -> dict[str, bool]:
    values = [x for x in items(state.feedback, "feedback") if x.get("id") != feedback_id]
    save_items(state.feedback, values, "feedback"); return {"ok": True}


@admin.post("/feedback/{feedback_id}/candidates/{candidate_id}/{decision}", dependencies=[Depends(admin_auth)])
async def candidate_decide(feedback_id: str, candidate_id: str, decision: str, body: dict[str, Any]) -> dict[str, Any]:
    values = items(state.feedback, "feedback"); feedback = next((x for x in values if x.get("id") == feedback_id), None)
    if not feedback: raise HTTPException(404, "feedback not found")
    candidate = next((x for x in feedback.get("candidates", []) if x.get("id") == candidate_id), None)
    if not candidate: raise HTTPException(404, "candidate not found")
    candidate["status"] = "accepted" if decision == "accept" else "rejected"; candidate["decidedAt"] = now()
    save_items(state.feedback, values, "feedback")
    response: dict[str, Any] = {"feedback": feedback}
    if decision == "accept":
        learned = items(state.learned, "entries"); entry = {"id": str(uuid4()), "feedbackId": feedback_id, "sessionId": feedback.get("sessionId", ""), "kind": body.get("kind", candidate.get("kind", "domain")), "text": body.get("statement", candidate.get("statement", "")), "tags": body.get("tags", candidate.get("tags", [])), "weight": 1, "createdAt": now()}
        learned.append(entry); save_items(state.learned, learned, "entries"); response["entry"] = entry
    return response


@admin.get("/learned", dependencies=[Depends(admin_auth)])
async def learned_list() -> dict[str, Any]: return {"entries": items(state.learned, "entries")}


@admin.post("/learned", dependencies=[Depends(admin_auth)])
async def learned_add(body: dict[str, Any]) -> dict[str, Any]:
    values = items(state.learned, "entries"); statement = str(body.get("statement", ""))
    old = next((x for x in values if x.get("text") == statement), None)
    if old: old["weight"] = old.get("weight", 1) + 1; save_items(state.learned, values, "entries"); return {"entry": old, "reinforced": True}
    entry = {"id": str(uuid4()), "feedbackId": "manual", "sessionId": "manual", "kind": body.get("kind", "domain"), "text": statement, "tags": body.get("tags", []), "weight": 1, "createdAt": now()}
    values.append(entry); save_items(state.learned, values, "entries"); return {"entry": entry, "reinforced": False}


@admin.patch("/learned/{entry_id}", dependencies=[Depends(admin_auth)])
async def learned_edit(entry_id: str, body: dict[str, Any]) -> dict[str, Any]:
    values = items(state.learned, "entries"); entry = next((x for x in values if x.get("id") == entry_id), None)
    if not entry: raise HTTPException(404, "entry not found")
    for src, dst in (("text", "text"), ("kind", "kind"), ("tags", "tags")):
        if src in body: entry[dst] = body[src]
    save_items(state.learned, values, "entries"); return {"entry": entry}


@admin.delete("/learned/{entry_id}", dependencies=[Depends(admin_auth)])
async def learned_delete(entry_id: str) -> dict[str, bool]:
    save_items(state.learned, [x for x in items(state.learned, "entries") if x.get("id") != entry_id], "entries"); return {"ok": True}


@admin.get("/knowledge", dependencies=[Depends(admin_auth)])
async def knowledge_list() -> dict[str, Any]: return {"chunks": [{**x, "usageCount": 0, "helpfulCount": 0, "irrelevantCount": 0, "sessions": []} for x in state.knowledge.chunks]}


@admin.get("/knowledge/gaps", dependencies=[Depends(admin_auth)])
async def knowledge_gaps() -> dict[str, Any]: return {"gaps": []}


@admin.post("/knowledge/{chunk_id}/{action}", dependencies=[Depends(admin_auth)])
async def knowledge_toggle(chunk_id: str, action: str) -> dict[str, Any]:
    disabled = items(state.overrides, "disabled")
    if action == "disable" and chunk_id not in disabled: disabled.append(chunk_id)
    if action == "enable": disabled = [x for x in disabled if x != chunk_id]
    save_items(state.overrides, disabled, "disabled"); return {"ok": True, "disabled": action == "disable"}


@admin.post("/sessions/{session_id}/citations/{chunk_id}/flag", dependencies=[Depends(admin_auth)])
async def citation_flag(session_id: str, chunk_id: str, body: dict[str, Any]) -> dict[str, Any]:
    session = require_session(session_id); citation = next((x for x in session.citations if x.chunkId == chunk_id), None)
    if not citation: raise HTTPException(404, "citation not found")
    citation.helpful = body.get("helpful"); state.sessions.save(session); return {"citation": citation.model_dump(exclude_none=True)}


@admin.get("/stats", dependencies=[Depends(admin_auth)])
async def stats() -> dict[str, Any]:
    feedback = items(state.feedback, "feedback"); candidates = [c for f in feedback for c in f.get("candidates", [])]
    return {"candidates": {"pending": sum(c.get("status") == "pending" for c in candidates), "accepted": sum(c.get("status") == "accepted" for c in candidates), "rejected": sum(c.get("status") == "rejected" for c in candidates), "byKind": {}}, "sessions": {"total": len(state.sessions.list()), "withFeedback": len({f.get('sessionId') for f in feedback}), "withCorrection": 0}, "learned": {"total": len(items(state.learned, 'entries')), "byKind": {}, "reinforcements": 0}, "behavior": len(items(state.behavior, 'entries')), "examples": len(items(state.examples, 'examples')), "topTags": []}


@admin.post("/sessions/{session_id}/questions", dependencies=[Depends(admin_auth)])
async def ask_user(session_id: str, body: dict[str, Any]) -> dict[str, Any]:
    session = require_session(session_id); question = AdminQuestion(id=str(uuid4()), question=str(body.get("question", "")))
    session.adminQuestions.append(question); state.sessions.save(session); return {"question": question.model_dump(exclude_none=True)}


@admin.post("/sessions/{session_id}/questions/{question_id}/learn", dependencies=[Depends(admin_auth)])
async def learn_answer(session_id: str, question_id: str) -> dict[str, Any]:
    session = require_session(session_id); q = next((x for x in session.adminQuestions if x.id == question_id), None)
    if not q or not q.answer: raise HTTPException(400, "question has no answer")
    result = await feedback_add(session_id, {"text": f"{q.question}\n{q.answer}"}); q.learnedFeedbackId = result["feedback"]["id"]; state.sessions.save(session); return result


@admin.post("/sessions/{session_id}/correction", dependencies=[Depends(admin_auth)])
async def correction_save(session_id: str, body: dict[str, Any]) -> dict[str, Any]:
    session = require_session(session_id); ET = __import__("xml.etree.ElementTree", fromlist=["ElementTree"])
    try: ET.fromstring(str(body.get("bpmnXml", "")))
    except Exception: raise HTTPException(400, "invalid BPMN XML")
    session.correction = {"bpmnXml": body.get("bpmnXml"), "note": body.get("note", ""), "at": now()}; state.sessions.save(session); return {"correction": session.correction}


@admin.post("/sessions/{session_id}/correction/learn", dependencies=[Depends(admin_auth)])
async def correction_learn(session_id: str) -> dict[str, Any]:
    session = require_session(session_id)
    if not session.correction: raise HTTPException(400, "no correction")
    result = await feedback_add(session_id, {"text": session.correction.get("note", "BPMN correction")}); session.correction["learnedFeedbackId"] = result["feedback"]["id"]; state.sessions.save(session)
    return {**result, "description": "Correction captured"}


def crud_routes(prefix: str, store_name: str, list_key: str, response_key: str):
    @admin.get(prefix, dependencies=[Depends(admin_auth)], name=f"list_{store_name}")
    async def list_all():
        result = {response_key: items(getattr(state, store_name), list_key)}
        if store_name == "behavior":
            result["agents"] = ["elicitation", "actors", "business_rules", "implicit", "ambiguity", "contradiction", "logical_model"]
        return result
    @admin.delete(prefix + "/{entry_id}", dependencies=[Depends(admin_auth)], name=f"delete_{store_name}")
    async def delete(entry_id: str):
        store = getattr(state, store_name); save_items(store, [x for x in items(store, list_key) if x.get("id") != entry_id], list_key); return {"ok": True}


crud_routes("/examples", "examples", "examples", "examples")
crud_routes("/behavior", "behavior", "entries", "entries")
crud_routes("/eval", "evals", "cases", "cases")


@admin.post("/examples", dependencies=[Depends(admin_auth)])
async def example_add(body: dict[str, Any]) -> dict[str, Any]:
    session = require_session(str(body.get("sessionId"))); values = items(state.examples, "examples")
    if not session.processModel: raise HTTPException(400, "session has no process model")
    entry = {"id": str(uuid4()), "sessionId": session.id, "request": session.request, "note": body.get("note", ""), "createdAt": now(), "processModel": session.processModel}; values.append(entry); save_items(state.examples, values, "examples"); return {"example": entry}


@admin.post("/behavior", dependencies=[Depends(admin_auth)])
async def behavior_add(body: dict[str, Any]) -> dict[str, Any]:
    values = items(state.behavior, "entries"); entry = {"id": str(uuid4()), "agent": body.get("agent"), "instruction": body.get("instruction", ""), "weight": 1, "createdAt": now()}; values.append(entry); save_items(state.behavior, values, "entries"); return {"entry": entry, "reinforced": False}


@admin.patch("/behavior/{entry_id}", dependencies=[Depends(admin_auth)])
async def behavior_edit(entry_id: str, body: dict[str, Any]) -> dict[str, Any]:
    values = items(state.behavior, "entries"); entry = next((x for x in values if x.get("id") == entry_id), None)
    if not entry: raise HTTPException(404, "entry not found")
    entry.update({k: v for k, v in body.items() if k in {"agent", "instruction"}}); save_items(state.behavior, values, "entries"); return {"entry": entry}


@admin.get("/behavior/agents", dependencies=[Depends(admin_auth)])
async def behavior_agents() -> dict[str, Any]: return {"agents": ["elicitation", "actors", "business_rules", "implicit", "ambiguity", "contradiction", "logical_model"]}


@admin.post("/eval", dependencies=[Depends(admin_auth)])
async def eval_add(body: dict[str, Any]) -> dict[str, Any]:
    session = require_session(str(body.get("sessionId"))); values = items(state.evals, "cases")
    expected = {"bpmnValid": True, "minRoles": 1, "minActivities": 1, "mustHaveRejectionPath": False, "expectedRoles": [], **body.get("expected", {})}
    entry = {"id": str(uuid4()), "sessionId": session.id, "request": session.request, "note": body.get("note", ""), "expected": expected, "createdAt": now()}; values.append(entry); save_items(state.evals, values, "cases"); return {"case": entry}


@admin.post("/eval/run", dependencies=[Depends(admin_auth)])
async def eval_run() -> dict[str, Any]:
    results = []
    for case in items(state.evals, "cases"):
        session = state.sessions.get(case["sessionId"]); checks = []
        if session and session.processModel:
            expected = case["expected"]; valid = validate_model(session.processModel)["valid"]
            checks = [{"label": "BPMN valid", "passed": valid == expected.get("bpmnValid", True), "detail": str(valid)}, {"label": "Minimum roles", "passed": len(session.roles) >= expected.get("minRoles", 0), "detail": str(len(session.roles))}, {"label": "Minimum activities", "passed": len(session.processModel.get("activities", [])) >= expected.get("minActivities", 0), "detail": str(len(session.processModel.get("activities", [])))}]
        passed = bool(checks) and all(x["passed"] for x in checks); results.append({"caseId": case["id"], "request": case["request"], "passed": passed, "checks": checks, **({"error": "session not found"} if not session else {})})
    return {"results": results, "passed": sum(x["passed"] for x in results), "total": len(results)}


app.include_router(admin)
