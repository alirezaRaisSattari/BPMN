from __future__ import annotations

import asyncio
import json
import os
import re
from contextlib import suppress
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator, Literal
from uuid import uuid4

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from .agents import run_conflict_check, run_correction_diff, run_feedback_extraction
from .agents.base import AgentContext
from .bpmn import validate_model
from .eval import run_eval_case
from .knowledge import build_knowledge
from .llm import create_provider
from .models import (AdminFeedback, AdminQuestion, BehaviorEntry, BpmnCorrection, EvalCase,
                     EvalExpectation, ExampleEntry, KnowledgeCandidate, KnowledgeChunk, LearnedEntry, LearnedSource,
                     Session, SimilarChunk, now)
from .orchestrator import Orchestrator
from .stores import (BehaviorStore, EvalStore, ExampleStore, FeedbackStore,
                     KnowledgeOverridesStore, LearnedKnowledgeStore, RetrievalLog,
                     SessionStore, compute_gaps)

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"


class ApiModel(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)


class TextBody(ApiModel):
    request: str = Field(min_length=1)


class MessageBody(ApiModel):
    message: str = Field(min_length=1)


class AnswerBody(ApiModel):
    answer: str = Field(min_length=1)


class FeedbackBody(ApiModel):
    text: str = Field(min_length=1)


class AcceptCandidateBody(ApiModel):
    statement: str | None = None
    kind: Literal["bpmn_guideline", "validation", "domain", "glossary", "other"] | None = None
    tags: list[str] | None = None
    destination: Literal["knowledge", "behavior"] | None = None
    agent: str | None = None


class ManualLearnedBody(ApiModel):
    statement: str = Field(min_length=1)
    kind: Literal["bpmn_guideline", "validation", "domain", "glossary", "other"] = "other"
    tags: list[str] = Field(default_factory=list)


class LearnedPatchBody(ApiModel):
    text: str | None = Field(default=None, min_length=1)
    kind: Literal["bpmn_guideline", "validation", "domain", "glossary", "other"] | None = None
    tags: list[str] | None = None


class QuestionBody(ApiModel):
    question: str = Field(min_length=1)


class CorrectionBody(ApiModel):
    bpmnXml: str = Field(min_length=1)
    note: str = ""


class FlagBody(ApiModel):
    helpful: bool | None = None


class ExampleBody(ApiModel):
    sessionId: str = Field(min_length=1)
    note: str = ""


class BehaviorBody(ApiModel):
    agent: Literal["elicitation", "actors", "business_rules", "implicit", "ambiguity", "contradiction", "logical_model"]
    instruction: str = Field(min_length=1)


class BehaviorPatchBody(ApiModel):
    agent: Literal["elicitation", "actors", "business_rules", "implicit", "ambiguity", "contradiction", "logical_model"] | None = None
    instruction: str | None = Field(default=None, min_length=1)


class EvalBody(ApiModel):
    sessionId: str = Field(min_length=1)
    note: str = ""
    expected: EvalExpectation | None = None


class State:
    async def initialize(self) -> "State":
        load_dotenv(ROOT / ".env")
        self.provider = create_provider()
        self.sessions = SessionStore(DATA / "sessions")
        self.retriever = await build_knowledge(ROOT / "knowledge", DATA / "knowledge-index.json",
            use_embeddings=os.getenv("KNOWLEDGE_EMBEDDINGS", "").lower() in {"1", "on", "true"})
        self.feedback = FeedbackStore(DATA / "feedback")
        self.learned = LearnedKnowledgeStore(DATA / "learned-knowledge.json").load()
        self.behavior = BehaviorStore(DATA / "behavior.json").load()
        self.examples = ExampleStore(DATA / "examples.json").load()
        self.evals = EvalStore(DATA / "eval")
        self.overrides = KnowledgeOverridesStore(DATA / "knowledge-overrides.json").load()
        self.retrieval_log = RetrievalLog(DATA / "retrieval-log.jsonl")
        await self.retriever.add_chunks([KnowledgeChunk(id=x.id, docId="learned-from-feedback", docTitle="دانش آموخته از بازخورد ادمین",
            kind=x.kind, text=x.text, tags=x.tags) for x in self.learned.list()])
        for chunk_id in self.overrides.list(): self.retriever.disable(chunk_id)
        self.orchestrator = Orchestrator(AgentContext(llm=self.provider, retriever=self.retriever,
            example_bank=self.examples, behavior=self.behavior, log_retrieval=self.retrieval_log.append))
        return self


state: State


@asynccontextmanager
async def lifespan(_: FastAPI):
    global state
    state = await State().initialize()
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


def turn_json(turn: Any) -> dict[str, Any]:
    return {
        "reply": turn.reply,
        "awaitingUser": turn.awaitingUser,
        "session": turn.session.model_dump(exclude_none=True),
    }


def llm_error(exc: Exception) -> str:
    message = str(exc)
    if "Insufficient balance" in message: return "اعتبار حساب LLM کافی نیست (Insufficient balance)."
    if "content-blocked" in message: return "درخواست توسط فیلتر محتوای provider بلاک شد."
    if "network" in message.lower(): return "خطای شبکه در ارتباط با provider مدل زبانی."
    return f"خطای مدل زبانی: {message}"


@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {"ok": True, "provider": state.provider.name, "model": state.provider.model,
            "knowledgeChunks": state.retriever.size}


@app.post("/api/sessions")
async def create(body: TextBody) -> Any:
    session = Session.create(body.request)
    try: turn = await state.orchestrator.begin(session, body.request)
    except Exception as exc:
        state.sessions.save(session)
        return JSONResponse({"error": llm_error(exc), "sessionId": session.id}, status_code=502)
    state.sessions.save(turn.session); return turn_json(turn)


@app.post("/api/sessions/{session_id}/messages")
async def message(session_id: str, body: MessageBody) -> Any:
    session = require_session(session_id)
    try: turn = await state.orchestrator.respond(session, body.message)
    except Exception as exc:
        state.sessions.save(session); return JSONResponse({"error": llm_error(exc)}, status_code=502)
    state.sessions.save(turn.session); return turn_json(turn)


def frame(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


async def stream_turn(session: Session, first: str | None = None, message_text: str | None = None) -> AsyncIterator[str]:
    state.sessions.save(session)
    yield frame("created", {"session": session.model_dump(exclude_none=True)})
    phases: asyncio.Queue[str] = asyncio.Queue()
    async def run():
        return await (state.orchestrator.begin(session, first or "", phases.put_nowait) if first is not None
                      else state.orchestrator.respond(session, message_text or "", phases.put_nowait))
    task = asyncio.create_task(run())
    try:
        while not task.done() or not phases.empty():
            try: phase = await asyncio.wait_for(phases.get(), .05)
            except TimeoutError: continue
            yield frame("phase", {"phase": phase})
        turn = await task
        state.sessions.save(turn.session)
        for chunk in re.findall(r"\s*\S+|\s+", turn.reply) or ([turn.reply] if turn.reply else []):
            yield frame("delta", {"text": chunk}); await asyncio.sleep(.001)
        yield frame("done", {"session": turn.session.model_dump(exclude_none=True),
                             "reply": turn.reply, "awaitingUser": turn.awaitingUser})
    except asyncio.CancelledError:
        task.cancel()
        with suppress(asyncio.CancelledError): await task
        state.sessions.save(session)
        raise
    except Exception as exc:
        state.sessions.save(session); yield frame("error", {"error": llm_error(exc), "session": session.model_dump(exclude_none=True)})
    finally:
        if not task.done():
            task.cancel()
            with suppress(asyncio.CancelledError): await task


@app.post("/api/sessions/stream")
async def create_stream(body: TextBody) -> StreamingResponse:
    return StreamingResponse(stream_turn(Session.create(body.request), first=body.request), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no"})


@app.post("/api/sessions/{session_id}/messages/stream")
async def message_stream(session_id: str, body: MessageBody) -> StreamingResponse:
    return StreamingResponse(stream_turn(require_session(session_id), message_text=body.message), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no"})


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
    return PlainTextResponse(xml, media_type="application/xml; charset=utf-8")


@app.get("/api/sessions/{session_id}/document")
async def download_document(session_id: str) -> PlainTextResponse:
    doc = require_session(session_id).outputs.document
    if not doc: raise HTTPException(404, "no document yet")
    return PlainTextResponse(doc, media_type="text/markdown")


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
    expected = os.getenv("ADMIN_TOKEN", "").strip()
    if expected and x_admin_token != expected: raise HTTPException(401, "invalid admin token")


BEHAVIOR_AGENTS = ["elicitation", "actors", "business_rules", "implicit", "ambiguity",
                   "contradiction", "logical_model"]
LEARNED_DOC_ID = "learned-from-feedback"
LEARNED_DOC_TITLE = "دانش آموخته از بازخورد ادمین"


def learned_chunk(entry: LearnedEntry) -> KnowledgeChunk:
    return KnowledgeChunk(id=entry.id, docId=LEARNED_DOC_ID, docTitle=LEARNED_DOC_TITLE,
                          kind=entry.kind, text=entry.text, tags=entry.tags)


async def citation_usage() -> dict[str, dict[str, Any]]:
    usage: dict[str, dict[str, Any]] = {}
    for summary in state.sessions.list():
        session = state.sessions.get(summary["id"])
        if not session: continue
        for citation in session.citations:
            value = usage.setdefault(citation.chunkId, {"usageCount": 0, "helpfulCount": 0,
                "irrelevantCount": 0, "sessions": []})
            value["usageCount"] += 1
            if citation.helpful is True: value["helpfulCount"] += 1
            if citation.helpful is False: value["irrelevantCount"] += 1
            if session.id not in value["sessions"]: value["sessions"].append(session.id)
    return usage


async def extract_candidates(session: Session, text: str, created_at: str) -> tuple[list[KnowledgeCandidate], str | None]:
    try:
        extracted = await run_feedback_extraction(AgentContext(llm=state.provider, retriever=state.retriever), session, text)
    except Exception as exc:
        return [], str(exc)
    candidates: list[KnowledgeCandidate] = []
    for point in extracted.points:
        if not point.generalizable: continue
        similar: list[SimilarChunk] = []
        try:
            results = await state.retriever.retrieve(point.statement, 3)
            similar = [SimilarChunk(chunkId=result.chunk.id, docTitle=result.chunk.docTitle,
                text=result.chunk.text, score=result.score) for result in results]
            if similar:
                try:
                    conflict = await run_conflict_check(AgentContext(llm=state.provider), point.statement, similar[0].text)
                    similar[0].conflict, similar[0].conflictReason = conflict.conflict, conflict.reason
                except Exception:
                    pass
        except Exception:
            pass
        candidates.append(KnowledgeCandidate(id=str(uuid4()), statement=point.statement,
            rationale=point.rationale, kind=point.kind, tags=point.tags,
            similar=similar, createdAt=created_at))
    return candidates, None


async def create_feedback(session: Session, text: str) -> AdminFeedback:
    created_at = now(); candidates, error = await extract_candidates(session, text, created_at)
    feedback = AdminFeedback(id=str(uuid4()), sessionId=session.id, sessionRequest=session.request,
        text=text, createdAt=created_at, candidates=candidates, extractionError=error)
    state.feedback.save(feedback)
    return feedback


@admin.get("/ping", dependencies=[Depends(admin_auth)])
async def ping() -> dict[str, bool]: return {"ok": True}


@admin.get("/feedback", dependencies=[Depends(admin_auth)])
async def feedback_list() -> dict[str, Any]:
    return {"feedback": [x.model_dump(exclude_none=True) for x in state.feedback.list()]}


@admin.post("/sessions/{session_id}/feedback", dependencies=[Depends(admin_auth)])
async def feedback_add(session_id: str, body: FeedbackBody) -> dict[str, Any]:
    session = require_session(session_id)
    feedback = await create_feedback(session, body.text.strip())
    return {"feedback": feedback.model_dump(exclude_none=True)}


@admin.delete("/feedback/{feedback_id}", dependencies=[Depends(admin_auth)])
async def feedback_delete(feedback_id: str) -> dict[str, bool]:
    if not state.feedback.remove(feedback_id): raise HTTPException(404, "feedback not found")
    return {"ok": True}


async def _candidate_decide(feedback_id: str, candidate_id: str, decision: Literal["accept", "reject"],
                            body: AcceptCandidateBody | None = None) -> dict[str, Any]:
    body = body or AcceptCandidateBody()
    feedback = state.feedback.get(feedback_id)
    if not feedback: raise HTTPException(404, "feedback not found")
    candidate = next((x for x in feedback.candidates if x.id == candidate_id), None)
    if not candidate: raise HTTPException(404, "candidate not found")
    if candidate.status != "pending": raise HTTPException(409, f"candidate is already {candidate.status}")
    candidate.status = "accepted" if decision == "accept" else "rejected"; candidate.decidedAt = now()
    response: dict[str, Any] = {}
    if decision == "accept":
        statement = (body.statement if body.statement is not None else candidate.statement).strip()
        if not statement: raise HTTPException(400, "statement must not be empty")
        candidate.statement, candidate.kind = statement, body.kind or candidate.kind
        candidate.tags = body.tags if body.tags is not None else candidate.tags
        source = LearnedSource(feedbackId=feedback.id, sessionId=feedback.sessionId, at=now())
        if body.destination == "behavior":
            if not body.agent or body.agent not in BEHAVIOR_AGENTS:
                raise HTTPException(400, f"invalid or missing agent: {body.agent or 'undefined'}")
            agent = body.agent; existing = state.behavior.find_by_text(agent, statement)
            entry = state.behavior.reinforce(existing.id, source) if existing else BehaviorEntry(id=f"behavior-{candidate.id}", agent=agent, instruction=statement, sources=[source], createdAt=now())
            if not existing: state.behavior.add(entry)
            response["behavior"] = entry.model_dump(exclude_none=True)
            response["reinforced"] = bool(existing)
        else:
            existing = state.learned.find_by_text(statement)
            entry = state.learned.reinforce(existing.id, source) if existing else LearnedEntry(id=f"learned-{candidate.id}", feedbackId=feedback.id,
                sessionId=feedback.sessionId, kind=body.kind or candidate.kind, text=statement,
                tags=body.tags if body.tags is not None else candidate.tags, sources=[source], createdAt=now())
            if not existing: state.learned.add(entry)
            if not existing: await state.retriever.add_chunks([learned_chunk(entry)])
            response["entry"] = entry.model_dump(exclude_none=True)
            response["reinforced"] = bool(existing)
    state.feedback.save(feedback); response["feedback"] = feedback.model_dump(exclude_none=True)
    return response


@admin.post("/feedback/{feedback_id}/candidates/{candidate_id}/accept", dependencies=[Depends(admin_auth)])
async def candidate_accept(feedback_id: str, candidate_id: str,
                           body: AcceptCandidateBody | None = None) -> dict[str, Any]:
    return await _candidate_decide(feedback_id, candidate_id, "accept", body)


@admin.post("/feedback/{feedback_id}/candidates/{candidate_id}/reject", dependencies=[Depends(admin_auth)])
async def candidate_reject(feedback_id: str, candidate_id: str) -> dict[str, Any]:
    return await _candidate_decide(feedback_id, candidate_id, "reject")


@admin.get("/learned", dependencies=[Depends(admin_auth)])
async def learned_list() -> dict[str, Any]:
    usage = await citation_usage()
    return {"entries": [{**entry.model_dump(exclude_none=True),
        "usageCount": usage.get(entry.id, {}).get("usageCount", 0)} for entry in state.learned.list()]}


@admin.post("/learned", dependencies=[Depends(admin_auth)])
async def learned_add(body: ManualLearnedBody) -> dict[str, Any]:
    statement = body.statement.strip()
    source = LearnedSource(feedbackId="manual", sessionId="manual", at=now()); old = state.learned.find_by_text(statement)
    if old: entry = state.learned.reinforce(old.id, source); reinforced = True
    else:
        entry = LearnedEntry(id=f"learned-manual-{uuid4()}", feedbackId="manual", sessionId="manual",
            kind=body.kind, text=statement, tags=body.tags, sources=[source], createdAt=now())
        state.learned.add(entry); reinforced = False
        await state.retriever.add_chunks([learned_chunk(entry)])
    return {"entry": entry.model_dump(exclude_none=True), "reinforced": reinforced}


@admin.patch("/learned/{entry_id}", dependencies=[Depends(admin_auth)])
async def learned_edit(entry_id: str, body: LearnedPatchBody) -> dict[str, Any]:
    entry = state.learned.get(entry_id)
    if not entry: raise HTTPException(404, "learned entry not found")
    if body.text is not None: entry.text = body.text.strip()
    if body.kind is not None: entry.kind = body.kind
    if body.tags is not None: entry.tags = body.tags
    state.learned.save(); state.retriever.remove_chunk(entry.id)
    await state.retriever.add_chunks([learned_chunk(entry)])
    return {"entry": entry.model_dump(exclude_none=True)}


@admin.delete("/learned/{entry_id}", dependencies=[Depends(admin_auth)])
async def learned_delete(entry_id: str) -> dict[str, bool]:
    if not state.learned.remove(entry_id): raise HTTPException(404, "learned entry not found")
    state.retriever.remove_chunk(entry_id); return {"ok": True}


@admin.get("/knowledge", dependencies=[Depends(admin_auth)])
async def knowledge_list() -> dict[str, Any]:
    usage = await citation_usage(); chunks = []
    for chunk in state.retriever.all_chunks():
        value = usage.get(chunk.id, {"usageCount": 0, "helpfulCount": 0,
            "irrelevantCount": 0, "sessions": []})
        chunks.append({**chunk.model_dump(exclude={"embedding"}),
            "source": "learned" if chunk.docId == LEARNED_DOC_ID else "markdown",
            "disabled": state.retriever.is_disabled(chunk.id), **value})
    chunks.sort(key=lambda value: value["usageCount"], reverse=True)
    return {"chunks": chunks}


@admin.get("/knowledge/gaps", dependencies=[Depends(admin_auth)])
async def knowledge_gaps() -> dict[str, Any]:
    return {"gaps": compute_gaps(state.retrieval_log.read())}


async def _knowledge_toggle(chunk_id: str, action: Literal["disable", "enable"]) -> dict[str, Any]:
    if action == "disable":
        if not state.retriever.disable(chunk_id): raise HTTPException(404, "chunk not found")
        state.overrides.disable(chunk_id); return {"ok": True, "disabled": True}
    state.retriever.enable(chunk_id); state.overrides.enable(chunk_id); return {"ok": True, "disabled": False}


@admin.post("/knowledge/{chunk_id}/disable", dependencies=[Depends(admin_auth)])
async def knowledge_disable(chunk_id: str) -> dict[str, Any]:
    return await _knowledge_toggle(chunk_id, "disable")


@admin.post("/knowledge/{chunk_id}/enable", dependencies=[Depends(admin_auth)])
async def knowledge_enable(chunk_id: str) -> dict[str, Any]:
    return await _knowledge_toggle(chunk_id, "enable")


@admin.post("/sessions/{session_id}/citations/{chunk_id}/flag", dependencies=[Depends(admin_auth)])
async def citation_flag(session_id: str, chunk_id: str, body: FlagBody) -> dict[str, Any]:
    session = require_session(session_id); citation = next((x for x in session.citations if x.chunkId == chunk_id), None)
    if not citation: raise HTTPException(404, "citation not found")
    citation.helpful = body.helpful; session.updatedAt = now(); state.sessions.save(session)
    return {"citation": citation.model_dump(exclude_none=True)}


@admin.get("/stats", dependencies=[Depends(admin_auth)])
async def stats() -> dict[str, Any]:
    feedback = state.feedback.list(); summaries = state.sessions.list()
    sessions = [state.sessions.get(value["id"]) for value in summaries]
    by_status = {"pending": 0, "accepted": 0, "rejected": 0}; by_kind: dict[str, int] = {}; tags: dict[str, int] = {}
    for item in feedback:
        for candidate in item.candidates:
            by_status[candidate.status] += 1; by_kind[candidate.kind] = by_kind.get(candidate.kind, 0) + 1
            for tag in candidate.tags: tags[tag] = tags.get(tag, 0) + 1
    learned = state.learned.list(); learned_by_kind: dict[str, int] = {}
    for entry in learned: learned_by_kind[entry.kind] = learned_by_kind.get(entry.kind, 0) + 1
    top_tags = [{"tag": tag, "count": count} for tag, count in sorted(tags.items(), key=lambda x: x[1], reverse=True)[:10]]
    return {"candidates": {**by_status, "byKind": by_kind},
        "sessions": {"total": len(summaries), "withFeedback": len({x.sessionId for x in feedback}),
                     "withCorrection": sum(bool(x and x.correction) for x in sessions)},
        "learned": {"total": len(learned), "byKind": learned_by_kind,
                    "reinforcements": sum(max(0, x.weight - 1) for x in learned)},
        "behavior": len(state.behavior.list()), "examples": len(state.examples.list()), "topTags": top_tags}


@admin.post("/sessions/{session_id}/questions", dependencies=[Depends(admin_auth)])
async def ask_user(session_id: str, body: QuestionBody) -> dict[str, Any]:
    session = require_session(session_id); question = AdminQuestion(id=str(uuid4()), question=body.question.strip())
    session.adminQuestions.append(question); session.updatedAt = question.createdAt; state.sessions.save(session)
    return {"question": question.model_dump(exclude_none=True)}


@admin.post("/sessions/{session_id}/questions/{question_id}/learn", dependencies=[Depends(admin_auth)])
async def learn_answer(session_id: str, question_id: str) -> dict[str, Any]:
    session = require_session(session_id); q = next((x for x in session.adminQuestions if x.id == question_id), None)
    if not q: raise HTTPException(404, "question not found")
    if q.status != "answered" or not q.answer: raise HTTPException(409, "question is not answered yet")
    if q.learnedFeedbackId: raise HTTPException(409, "already learned from this answer")
    feedback = await create_feedback(session, f"پرسش ادمین: {q.question}\nپاسخ کاربر: {q.answer}")
    q.learnedFeedbackId = feedback.id; state.sessions.save(session)
    return {"feedback": feedback.model_dump(exclude_none=True)}


@admin.post("/sessions/{session_id}/correction", dependencies=[Depends(admin_auth)])
async def correction_save(session_id: str, body: CorrectionBody) -> dict[str, Any]:
    session = require_session(session_id)
    if not __import__("re").search(r"<\s*(bpmn:)?definitions[\s>]", body.bpmnXml, __import__("re").I):
        raise HTTPException(400, "does not look like BPMN XML (<definitions> missing)")
    session.correction = BpmnCorrection(bpmnXml=body.bpmnXml, note=body.note.strip(), at=now())
    session.updatedAt = session.correction.at; state.sessions.save(session)
    return {"correction": session.correction.model_dump(exclude_none=True)}


@admin.post("/sessions/{session_id}/correction/learn", dependencies=[Depends(admin_auth)])
async def correction_learn(session_id: str) -> dict[str, Any]:
    session = require_session(session_id)
    if not session.correction: raise HTTPException(409, "no correction to learn from")
    if session.correction.learnedFeedbackId: raise HTTPException(409, "already learned from this correction")
    description = ""
    try:
        description = (await run_correction_diff(AgentContext(llm=state.provider), session,
            session.correction.bpmnXml, session.correction.note)).description.strip()
    except Exception:
        pass
    text = description or session.correction.note
    if not text: raise HTTPException(422, "could not derive a lesson from the correction")
    feedback = await create_feedback(session, text)
    session.correction.learnedFeedbackId = feedback.id; state.sessions.save(session)
    return {"feedback": feedback.model_dump(exclude_none=True), "description": description}


@admin.get("/examples", dependencies=[Depends(admin_auth)])
async def example_list() -> dict[str, Any]:
    return {"examples": [x.model_dump(exclude_none=True) for x in state.examples.list()]}


@admin.delete("/examples/{entry_id}", dependencies=[Depends(admin_auth)])
async def example_delete(entry_id: str) -> dict[str, bool]:
    if not state.examples.remove(entry_id): raise HTTPException(404, "example not found")
    return {"ok": True}


@admin.get("/behavior", dependencies=[Depends(admin_auth)])
async def behavior_list() -> dict[str, Any]:
    return {"entries": [x.model_dump(exclude_none=True) for x in state.behavior.list()], "agents": BEHAVIOR_AGENTS}


@admin.delete("/behavior/{entry_id}", dependencies=[Depends(admin_auth)])
async def behavior_delete(entry_id: str) -> dict[str, bool]:
    if not state.behavior.remove(entry_id): raise HTTPException(404, "behavior entry not found")
    return {"ok": True}


@admin.get("/eval", dependencies=[Depends(admin_auth)])
async def eval_list() -> dict[str, Any]:
    return {"cases": [x.model_dump(exclude_none=True) for x in state.evals.list()]}


@admin.delete("/eval/{entry_id}", dependencies=[Depends(admin_auth)])
async def eval_delete(entry_id: str) -> dict[str, bool]:
    if not state.evals.remove(entry_id): raise HTTPException(404, "eval case not found")
    return {"ok": True}


@admin.post("/examples", dependencies=[Depends(admin_auth)])
async def example_add(body: ExampleBody) -> dict[str, Any]:
    session = require_session(body.sessionId)
    if not session.processModel: raise HTTPException(409, "session has no process model to use as an example")
    entry = ExampleEntry(id=str(uuid4()), sessionId=session.id, request=session.request,
        note=body.note.strip(), createdAt=now(), processModel=session.processModel)
    state.examples.add(entry); return {"example": entry.model_dump(exclude_none=True)}


@admin.post("/behavior", dependencies=[Depends(admin_auth)])
async def behavior_add(body: BehaviorBody) -> dict[str, Any]:
    instruction = body.instruction.strip(); source = LearnedSource(feedbackId="manual", sessionId="manual", at=now())
    old = state.behavior.find_by_text(body.agent, instruction)
    if old: entry = state.behavior.reinforce(old.id, source); reinforced = True
    else:
        entry = BehaviorEntry(id=f"behavior-manual-{uuid4()}", agent=body.agent, instruction=instruction,
            sources=[source], createdAt=now()); state.behavior.add(entry); reinforced = False
    return {"entry": entry.model_dump(exclude_none=True), "reinforced": reinforced}


@admin.patch("/behavior/{entry_id}", dependencies=[Depends(admin_auth)])
async def behavior_edit(entry_id: str, body: BehaviorPatchBody) -> dict[str, Any]:
    entry = state.behavior.update(entry_id,
        instruction=body.instruction.strip() if body.instruction is not None else None, agent=body.agent)
    if not entry: raise HTTPException(404, "behavior entry not found")
    return {"entry": entry.model_dump(exclude_none=True)}


@admin.post("/eval", dependencies=[Depends(admin_auth)])
async def eval_add(body: EvalBody) -> dict[str, Any]:
    session = require_session(body.sessionId); model = session.processModel
    defaults = EvalExpectation(bpmnValid=validate_model(model)["valid"] if model else True,
        minRoles=max(1, len(session.roles)), minActivities=max(1, len(model.activities)) if model else 1)
    expected = defaults.model_copy(update=body.expected.model_dump(exclude_unset=True)) if body.expected else defaults
    entry = EvalCase(id=str(uuid4()), sessionId=session.id, request=session.request,
        note=body.note.strip(), expected=expected, createdAt=now())
    state.evals.save(entry); return {"case": entry.model_dump(exclude_none=True)}


@admin.post("/eval/run", dependencies=[Depends(admin_auth)])
async def eval_run() -> dict[str, Any]:
    results = []
    for case in state.evals.list():
        session = state.sessions.get(case.sessionId)
        if not session:
            results.append({"caseId": case.id, "request": case.request, "passed": False,
                            "checks": [], "error": "session not found"})
        else: results.append(run_eval_case(case, session).model_dump(exclude_none=True))
    return {"results": results, "passed": sum(x["passed"] for x in results), "total": len(results)}


app.include_router(admin)
