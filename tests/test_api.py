import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import bpmn_analyst.app as api


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("LLM_PROVIDER", "mock")
    monkeypatch.setenv("ADMIN_TOKEN", "secret")
    monkeypatch.setattr(api, "ROOT", tmp_path)
    monkeypatch.setattr(api, "DATA", tmp_path / "data")
    (tmp_path / "knowledge").mkdir()
    (tmp_path / "knowledge" / "domain.md").write_text("قانون ثبت نام", encoding="utf-8")
    with TestClient(api.app) as value:
        yield value


def finish_session(client: TestClient) -> dict:
    created = client.post("/api/sessions", json={"request": "فرآیند ثبت نام"})
    assert created.status_code == 200
    session_id = created.json()["session"]["id"]
    done = client.post(f"/api/sessions/{session_id}/messages", json={"message": "ثبت درخواست و تایید"})
    assert done.status_code == 200
    return done.json()["session"]


def test_health_validation_and_crud(client: TestClient):
    assert client.get("/api/health").json()["provider"] == "mock"
    assert client.post("/api/sessions", json={"request": ""}).status_code == 400
    session = finish_session(client)
    session_id = session["id"]
    assert client.get("/api/sessions").json()["sessions"][0]["id"] == session_id
    assert client.get(f"/api/sessions/{session_id}").status_code == 200
    assert client.get(f"/api/sessions/{session_id}/bpmn").headers["content-type"].startswith("application/xml")
    assert client.get(f"/api/sessions/{session_id}/document").headers["content-type"].startswith("text/markdown")
    assert client.delete(f"/api/sessions/{session_id}").json() == {"ok": True}
    assert client.get(f"/api/sessions/{session_id}").status_code == 404


def test_sse_contract(client: TestClient):
    response = client.post("/api/sessions/stream", json={"request": "مرخصی تحصیلی"})
    assert response.status_code == 200
    events = [line[7:] for line in response.text.splitlines() if line.startswith("event: ")]
    assert events[0] == "created" and "phase" in events and "delta" in events and events[-1] == "done"


def test_admin_auth_and_workflows(client: TestClient):
    assert client.get("/api/admin/ping").status_code == 401
    headers = {"x-admin-token": "secret"}
    assert client.get("/api/admin/ping", headers=headers).json() == {"ok": True}
    session = finish_session(client)
    sid = session["id"]
    feedback = client.post(f"/api/admin/sessions/{sid}/feedback", headers=headers, json={"text": "بازبینی"}).json()["feedback"]
    assert client.get("/api/admin/feedback", headers=headers).json()["feedback"]
    candidate = feedback["candidates"][0]
    accepted = client.post(f"/api/admin/feedback/{feedback['id']}/candidates/{candidate['id']}/accept", headers=headers, json={}).json()
    assert accepted["entry"]["text"] == "بازبینی"
    learned = client.post("/api/admin/learned", headers=headers, json={"statement": "قانون", "kind": "domain", "tags": []}).json()["entry"]
    assert client.patch(f"/api/admin/learned/{learned['id']}", headers=headers, json={"text": "قانون جدید"}).status_code == 200
    question = client.post(f"/api/admin/sessions/{sid}/questions", headers=headers, json={"question": "توضیح؟"}).json()["question"]
    assert client.post(f"/api/sessions/{sid}/questions/{question['id']}/answer", json={"answer": "پاسخ"}).status_code == 200
    assert client.post(f"/api/admin/sessions/{sid}/questions/{question['id']}/learn", headers=headers).status_code == 200
    correction = '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" />'
    assert client.post(f"/api/admin/sessions/{sid}/correction", headers=headers, json={"bpmnXml": correction, "note": "اصلاح"}).status_code == 200
    assert client.post(f"/api/admin/sessions/{sid}/correction/learn", headers=headers).status_code == 200
    example = client.post("/api/admin/examples", headers=headers, json={"sessionId": sid, "note": "نمونه"}).json()["example"]
    behavior = client.post("/api/admin/behavior", headers=headers, json={"agent": "actors", "instruction": "دقیق باش"}).json()["entry"]
    assert client.get("/api/admin/behavior", headers=headers).json()["agents"]
    assert client.patch(f"/api/admin/behavior/{behavior['id']}", headers=headers, json={"instruction": "خیلی دقیق باش"}).status_code == 200
    case = client.post("/api/admin/eval", headers=headers, json={"sessionId": sid, "note": "آزمون"}).json()["case"]
    assert client.post("/api/admin/eval/run", headers=headers).json()["total"] == 1
    chunks = client.get("/api/admin/knowledge", headers=headers).json()["chunks"]
    assert chunks and client.get("/api/admin/knowledge/gaps", headers=headers).status_code == 200
    chunk_id = chunks[0]["id"]
    assert client.post(f"/api/admin/knowledge/{chunk_id}/disable", headers=headers).json()["disabled"]
    assert not client.post(f"/api/admin/knowledge/{chunk_id}/enable", headers=headers).json()["disabled"]
    session_now = client.get(f"/api/sessions/{sid}").json()["session"]
    if session_now["citations"]:
        cited = session_now["citations"][0]["chunkId"]
        assert client.post(f"/api/admin/sessions/{sid}/citations/{cited}/flag", headers=headers, json={"helpful": True}).status_code == 200
    assert client.get("/api/admin/stats", headers=headers).status_code == 200
    assert client.delete(f"/api/admin/examples/{example['id']}", headers=headers).status_code == 200
    assert client.delete(f"/api/admin/behavior/{behavior['id']}", headers=headers).status_code == 200
    assert client.delete(f"/api/admin/eval/{case['id']}", headers=headers).status_code == 200
    assert client.delete(f"/api/admin/learned/{learned['id']}", headers=headers).status_code == 200
    assert client.delete(f"/api/admin/feedback/{feedback['id']}", headers=headers).status_code == 200


def test_openapi_contains_public_and_admin_routes(client: TestClient):
    paths = client.get("/openapi.json").json()["paths"]
    assert "/api/sessions/stream" in paths
    assert "/api/admin/eval/run" in paths
