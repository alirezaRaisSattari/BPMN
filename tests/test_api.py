import asyncio
import json
from pathlib import Path
from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient

import bpmn_analyst.app as api
from bpmn_analyst.agents.base import AgentContext
from bpmn_analyst.llm import LLMProvider, MockProvider
from bpmn_analyst.models import Session
from bpmn_analyst.orchestrator import Orchestrator
from conftest import READY_FIXTURES


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("LLM_PROVIDER", "mock"); monkeypatch.setenv("ADMIN_TOKEN", "secret")
    monkeypatch.setattr(api, "ROOT", tmp_path); monkeypatch.setattr(api, "DATA", tmp_path / "data")
    monkeypatch.setattr(api, "create_provider", lambda: MockProvider(dict(READY_FIXTURES)))
    (tmp_path / "knowledge").mkdir(); (tmp_path / "knowledge" / "domain.md").write_text(
        "---\ntitle: قوانین دانشگاه\nkind: domain\n---\nقانون ثبت‌نام دانشجو و مسیر تأیید", encoding="utf-8")
    with TestClient(api.app) as value: yield value


def finish_session(client: TestClient) -> dict:
    response = client.post("/api/sessions", json={"request": "فرآیند ثبت‌نام"})
    assert response.status_code == 200
    assert set(response.json()) == {"reply", "awaitingUser", "session"}
    assert response.json()["session"]["phase"] == "done"
    return response.json()["session"]


def parse_sse(text: str):
    events = []
    for block in text.strip().split("\n\n"):
        lines = block.splitlines()
        events.append((lines[0].removeprefix("event: "), json.loads(lines[1].removeprefix("data: "))))
    return events


def test_health_validation_crud_downloads_and_missing_resources(client: TestClient):
    health = client.get("/api/health").json()
    assert health["provider"] == "mock" and health["knowledgeChunks"] > 0
    assert client.post("/api/sessions", json={"request": " "}).status_code == 400
    assert set(client.post("/api/sessions", json={}).json()) == {"error"}
    assert client.get("/api/sessions/missing").status_code == 404
    assert client.delete("/api/sessions/missing").status_code == 404
    pending = Session.create("pending", "pending"); api.state.sessions.save(pending)
    assert client.get("/api/sessions/pending/bpmn").status_code == 404
    assert client.get("/api/sessions/pending/document").status_code == 404
    session = finish_session(client); session_id = session["id"]
    assert client.get("/api/sessions").json()["sessions"][0]["messageCount"] >= 2
    assert client.get(f"/api/sessions/{session_id}").json()["session"]["id"] == session_id
    bpmn = client.get(f"/api/sessions/{session_id}/bpmn")
    document = client.get(f"/api/sessions/{session_id}/document")
    assert bpmn.headers["content-type"] == "application/xml; charset=utf-8" and "BPMNDiagram" in bpmn.text
    assert document.headers["content-type"] == "text/markdown; charset=utf-8" and "مستند فرآیند" in document.text
    assert client.delete(f"/api/sessions/{session_id}").json() == {"ok": True}


def test_create_continue_and_reload_history(client: TestClient):
    api.state.provider.fixtures["ElicitationResult"] = {
        "extractedRequirements": [], "questions": [{"text": "آغازکننده کیست؟", "category": "initiator"}],
        "assistantMessage": "نیاز به توضیح", "readyToModel": False}
    created = client.post("/api/sessions", json={"request": "فرآیند مرخصی"}).json()
    assert created["awaitingUser"] and created["session"]["phase"] == "elicitation"
    sid = created["session"]["id"]
    continued = client.post(f"/api/sessions/{sid}/messages", json={"message": "بله مدل را بساز"})
    assert continued.status_code == 200 and continued.json()["session"]["phase"] == "done"
    reloaded = client.get(f"/api/sessions/{sid}").json()["session"]
    assert [x["role"] for x in reloaded["messages"]] == ["user", "assistant", "user", "assistant"]


def test_sse_order_progress_and_exact_delta_reconstruction(client: TestClient):
    response = client.post("/api/sessions/stream", json={"request": "مرخصی تحصیلی"})
    assert response.headers["content-type"] == "text/event-stream; charset=utf-8"
    assert response.headers["cache-control"] == "no-cache, no-transform"
    assert response.headers["connection"] == "keep-alive" and response.headers["x-accel-buffering"] == "no"
    events = parse_sse(response.text)
    names = [x[0] for x in events]
    assert names[0] == "created" and names[-1] == "done"
    assert names == ["created", *(["phase"] * names.count("phase")), *(["delta"] * names.count("delta")), "done"]
    done = events[-1][1]
    assert "".join(data["text"] for event, data in events if event == "delta") == done["reply"]
    phases = [data["phase"] for event, data in events if event == "phase"]
    assert phases[0] == "elicitation" and phases[-1] == "done"


def test_admin_auth_feedback_candidate_and_learned_workflow(client: TestClient):
    assert client.get("/api/admin/ping").status_code == 401
    headers = {"x-admin-token": "secret"}; assert client.get("/api/admin/ping", headers=headers).json() == {"ok": True}
    sid = finish_session(client)["id"]
    feedback = client.post(f"/api/admin/sessions/{sid}/feedback", headers=headers,
        json={"text": "مسیر رد باید وجود داشته باشد"}).json()["feedback"]
    assert len(feedback["candidates"]) == 1 and client.get("/api/admin/feedback", headers=headers).json()["feedback"]
    candidate = feedback["candidates"][0]
    accepted = client.post(f"/api/admin/feedback/{feedback['id']}/candidates/{candidate['id']}/accept",
        headers=headers, json={}).json()
    assert accepted["entry"]["text"] == candidate["statement"] and accepted["reinforced"] is False
    assert client.post(f"/api/admin/feedback/{feedback['id']}/candidates/{candidate['id']}/reject",
        headers=headers).status_code == 409
    manual = client.post("/api/admin/learned", headers=headers,
        json={"statement": "قانون جدید", "kind": "domain", "tags": ["ثبت"]}).json()
    reinforced = client.post("/api/admin/learned", headers=headers,
        json={"statement": "قانون جدید.", "kind": "domain", "tags": []}).json()
    assert reinforced["reinforced"] and reinforced["entry"]["weight"] == 2
    entry_id = manual["entry"]["id"]
    assert client.patch(f"/api/admin/learned/{entry_id}", headers=headers,
        json={"text": "قانون ویرایش‌شده"}).json()["entry"]["text"] == "قانون ویرایش‌شده"
    assert client.get("/api/admin/learned", headers=headers).json()["entries"][0]["usageCount"] >= 0
    assert client.delete(f"/api/admin/learned/{entry_id}", headers=headers).json() == {"ok": True}
    assert client.delete(f"/api/admin/learned/{entry_id}", headers=headers).status_code == 404
    assert client.delete(f"/api/admin/feedback/{feedback['id']}", headers=headers).json() == {"ok": True}


def test_admin_token_configuration_is_trimmed(client: TestClient, monkeypatch):
    monkeypatch.setenv("ADMIN_TOKEN", "  secret  ")
    assert client.get("/api/admin/ping", headers={"x-admin-token": "secret"}).status_code == 200


def test_behavior_destination_reinforcement_and_crud(client: TestClient):
    headers = {"x-admin-token": "secret"}; sid = finish_session(client)["id"]
    feedback = client.post(f"/api/admin/sessions/{sid}/feedback", headers=headers,
        json={"text": "رفتار دقیق"}).json()["feedback"]; candidate = feedback["candidates"][0]
    missing = client.post(f"/api/admin/feedback/{feedback['id']}/candidates/{candidate['id']}/accept",
        headers=headers, json={"destination": "behavior"})
    assert missing.status_code == 400 and missing.json() == {"error": "invalid or missing agent: undefined"}
    invalid = client.post(f"/api/admin/feedback/{feedback['id']}/candidates/{candidate['id']}/accept",
        headers=headers, json={"destination": "behavior", "agent": "reviewer"})
    assert invalid.status_code == 400 and invalid.json() == {"error": "invalid or missing agent: reviewer"}
    accepted = client.post(f"/api/admin/feedback/{feedback['id']}/candidates/{candidate['id']}/accept",
        headers=headers, json={"destination": "behavior", "agent": "actors"})
    assert accepted.status_code == 200 and accepted.json()["behavior"]["agent"] == "actors"
    manual = client.post("/api/admin/behavior", headers=headers,
        json={"agent": "actors", "instruction": "نام نقش را دقیق انتخاب کن"}).json()
    repeated = client.post("/api/admin/behavior", headers=headers,
        json={"agent": "actors", "instruction": "نام نقش را دقیق انتخاب کن."}).json()
    assert repeated["reinforced"] and repeated["entry"]["weight"] == 2
    entry_id = manual["entry"]["id"]
    assert client.patch(f"/api/admin/behavior/{entry_id}", headers=headers,
        json={"agent": "elicitation", "instruction": "سؤال دقیق بپرس"}).status_code == 200
    listed = client.get("/api/admin/behavior", headers=headers).json()
    assert "logical_model" in listed["agents"] and listed["entries"]
    assert client.delete(f"/api/admin/behavior/{entry_id}", headers=headers).json() == {"ok": True}
    assert client.delete(f"/api/admin/behavior/{entry_id}", headers=headers).status_code == 404


def test_rejected_candidate_response_matches_legacy_contract(client: TestClient):
    headers = {"x-admin-token": "secret"}; sid = finish_session(client)["id"]
    feedback = client.post(f"/api/admin/sessions/{sid}/feedback", headers=headers,
        json={"text": "این پیشنهاد را رد کن"}).json()["feedback"]
    candidate = feedback["candidates"][0]
    response = client.post(f"/api/admin/feedback/{feedback['id']}/candidates/{candidate['id']}/reject",
        headers=headers)
    assert response.status_code == 200
    assert set(response.json()) == {"feedback"}


def test_questions_corrections_examples_evals_and_stats(client: TestClient):
    headers = {"x-admin-token": "secret"}; sid = finish_session(client)["id"]
    question = client.post(f"/api/admin/sessions/{sid}/questions", headers=headers,
        json={"question": "تأییدکننده کیست؟"}).json()["question"]
    assert client.get(f"/api/sessions/{sid}").json()["session"]["updatedAt"] == question["createdAt"]
    assert client.post(f"/api/admin/sessions/{sid}/questions/{question['id']}/learn", headers=headers).status_code == 409
    assert client.post(f"/api/sessions/{sid}/questions/{question['id']}/answer", json={"answer": "مدیر گروه"}).status_code == 200
    assert client.post(f"/api/admin/sessions/{sid}/questions/{question['id']}/learn", headers=headers).status_code == 200
    assert client.post(f"/api/admin/sessions/{sid}/questions/{question['id']}/learn", headers=headers).status_code == 409
    assert client.post(f"/api/admin/sessions/{sid}/correction", headers=headers,
        json={"bpmnXml": "<xml/>", "note": "اصلاح"}).status_code == 400
    correction = '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" />'
    assert client.post(f"/api/admin/sessions/{sid}/correction", headers=headers,
        json={"bpmnXml": correction, "note": "مسیر رد"}).status_code == 200
    learned = client.post(f"/api/admin/sessions/{sid}/correction/learn", headers=headers)
    assert learned.status_code == 200 and learned.json()["description"]
    assert client.post(f"/api/admin/sessions/{sid}/correction/learn", headers=headers).status_code == 409
    example = client.post("/api/admin/examples", headers=headers, json={"sessionId": sid, "note": "نمونه"}).json()["example"]
    assert client.get("/api/admin/examples", headers=headers).json()["examples"][0]["id"] == example["id"]
    case = client.post("/api/admin/eval", headers=headers,
        json={"sessionId": sid, "note": "آزمون", "expected": {"minRoles": 1}}).json()["case"]
    run = client.post("/api/admin/eval/run", headers=headers).json()
    assert run["total"] == 1 and run["passed"] == 1
    stats = client.get("/api/admin/stats", headers=headers).json()
    assert stats["sessions"]["withCorrection"] == 1 and stats["examples"] == 1
    assert client.delete(f"/api/admin/examples/{example['id']}", headers=headers).status_code == 200
    assert client.delete(f"/api/admin/eval/{case['id']}", headers=headers).status_code == 200


def test_knowledge_usage_flags_gaps_and_toggles(client: TestClient):
    headers = {"x-admin-token": "secret"}; sid = finish_session(client)["id"]
    chunks = client.get("/api/admin/knowledge", headers=headers).json()["chunks"]
    assert chunks and {"source", "disabled", "usageCount", "helpfulCount", "irrelevantCount", "sessions"} <= chunks[0].keys()
    session = client.get(f"/api/sessions/{sid}").json()["session"]
    cited = session["citations"][0]["chunkId"]
    cited_path = quote(cited, safe="")
    assert client.post(f"/api/admin/sessions/{sid}/citations/{cited_path}/flag", headers=headers,
        json={"helpful": True}).json()["citation"]["helpful"] is True
    used = next(x for x in client.get("/api/admin/knowledge", headers=headers).json()["chunks"] if x["id"] == cited)
    assert used["usageCount"] == 1 and used["helpfulCount"] == 1 and sid in used["sessions"]
    assert client.post("/api/admin/knowledge/missing/disable", headers=headers).status_code == 404
    assert client.post(f"/api/admin/knowledge/{cited_path}/disable", headers=headers).json()["disabled"]
    assert not client.post(f"/api/admin/knowledge/{cited_path}/enable", headers=headers).json()["disabled"]
    gaps = client.get("/api/admin/knowledge/gaps", headers=headers).json()["gaps"]
    assert isinstance(gaps, list)


def test_openapi_has_every_route_and_persistence_reloads(client: TestClient):
    paths = client.get("/openapi.json").json()["paths"]
    expected = {
        "/api/health", "/api/sessions", "/api/sessions/stream", "/api/sessions/{session_id}",
        "/api/sessions/{session_id}/messages", "/api/sessions/{session_id}/messages/stream",
        "/api/sessions/{session_id}/bpmn", "/api/sessions/{session_id}/document",
        "/api/sessions/{session_id}/questions/{question_id}/answer", "/api/admin/ping",
        "/api/admin/feedback", "/api/admin/sessions/{session_id}/feedback", "/api/admin/feedback/{feedback_id}",
        "/api/admin/feedback/{feedback_id}/candidates/{candidate_id}/accept",
        "/api/admin/feedback/{feedback_id}/candidates/{candidate_id}/reject",
        "/api/admin/learned", "/api/admin/learned/{entry_id}", "/api/admin/knowledge",
        "/api/admin/knowledge/gaps", "/api/admin/knowledge/{chunk_id}/disable",
        "/api/admin/knowledge/{chunk_id}/enable",
        "/api/admin/sessions/{session_id}/citations/{chunk_id}/flag", "/api/admin/stats",
        "/api/admin/sessions/{session_id}/questions",
        "/api/admin/sessions/{session_id}/questions/{question_id}/learn",
        "/api/admin/sessions/{session_id}/correction", "/api/admin/sessions/{session_id}/correction/learn",
        "/api/admin/examples", "/api/admin/examples/{entry_id}", "/api/admin/behavior",
        "/api/admin/behavior/{entry_id}", "/api/admin/eval", "/api/admin/eval/{entry_id}",
        "/api/admin/eval/run",
    }
    assert set(paths) == expected
    session = finish_session(client)
    assert (api.DATA / "sessions" / f"{session['id']}.json").exists()


class FailingProvider(LLMProvider):
    name = "failing"; model = "failing"
    async def complete(self, *args, **kwargs): raise RuntimeError("network unavailable")
    async def structured(self, *args, **kwargs): raise RuntimeError("network unavailable")


def test_provider_failures_use_error_contract_for_json_and_sse(client: TestClient):
    failing = FailingProvider(); api.state.provider = failing
    api.state.orchestrator = Orchestrator(AgentContext(llm=failing))
    regular = client.post("/api/sessions", json={"request": "خرابی"})
    assert regular.status_code == 502 and set(regular.json()) == {"error", "sessionId"}
    events = parse_sse(client.post("/api/sessions/stream", json={"request": "خرابی"}).text)
    assert [x[0] for x in events] == ["created", "phase", "error"]
    assert "شبکه" in events[-1][1]["error"]


def test_sse_disconnect_cancels_inflight_provider(client: TestClient):
    class SlowProvider(LLMProvider):
        name = "slow"; model = "slow"; cancelled = False
        async def complete(self, *args, **kwargs): return ""
        async def structured(self, *args, **kwargs):
            try: await asyncio.Future()
            except asyncio.CancelledError:
                self.cancelled = True
                raise

    async def scenario():
        slow = SlowProvider(); api.state.orchestrator = Orchestrator(AgentContext(llm=slow))
        stream = api.stream_turn(Session.create("x"), first="x")
        assert "event: created" in await anext(stream)
        assert "event: phase" in await asyncio.wait_for(anext(stream), 1)
        await stream.aclose()
        assert slow.cancelled
    asyncio.run(scenario())
