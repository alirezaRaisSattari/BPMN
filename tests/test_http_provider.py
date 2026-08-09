import asyncio

import pytest

from bpmn_analyst.llm import HTTPProvider, LLMConfig
from bpmn_analyst.models import ConflictCheck


class Response:
    def __init__(self, status, data=None, text=""):
        self.status_code, self._data, self.text = status, data, text
    def json(self):
        if self._data is None: raise ValueError("not json")
        return self._data


class FakeClient:
    responses = []
    calls = []
    def __init__(self, **kwargs): self.kwargs = kwargs
    async def __aenter__(self): return self
    async def __aexit__(self, *args): pass
    async def post(self, url, **kwargs):
        self.calls.append((url, kwargs)); value = self.responses.pop(0)
        if isinstance(value, Exception): raise value
        return value


def test_gemini_native_api_schema_and_headers(monkeypatch):
    FakeClient.calls = []; FakeClient.responses = [Response(200, {"candidates": [{"content": {"parts": [
        {"text": '{"conflict":false,"reason":""}'}]}}]})]
    monkeypatch.setattr("bpmn_analyst.llm.httpx.AsyncClient", FakeClient)
    provider = HTTPProvider(LLMConfig(provider="gemini", base_url="https://generativelanguage.googleapis.com/v1beta",
        api_key="secret", model="gemini-flash-latest"))
    result = asyncio.run(provider.structured(ConflictCheck, "ConflictCheck", [{"role": "user", "content": "x"}]))
    url, request = FakeClient.calls[0]
    assert not result.conflict and url.endswith("/models/gemini-flash-latest:generateContent")
    assert request["headers"] == {"X-goog-api-key": "secret"}
    assert request["json"]["generationConfig"]["responseMimeType"] == "application/json"
    assert request["json"]["generationConfig"]["responseJsonSchema"]["title"] == "ConflictCheck"


def test_gemini_appends_user_turn_when_history_ends_with_model(monkeypatch):
    FakeClient.calls = []; FakeClient.responses = [Response(200, {"candidates": [{"content": {"parts": [
        {"text": "ok"}]}}]})]
    monkeypatch.setattr("bpmn_analyst.llm.httpx.AsyncClient", FakeClient)
    provider = HTTPProvider(LLMConfig(provider="gemini", base_url="https://generativelanguage.googleapis.com/v1beta",
        api_key="secret", model="gemini-flash-latest"))
    assert asyncio.run(provider.complete([{"role": "user", "content": "x"},
        {"role": "assistant", "content": "question"}])) == "ok"
    contents = FakeClient.calls[0][1]["json"]["contents"]
    assert [turn["role"] for turn in contents] == ["user", "model", "user"]
    assert contents[-1]["parts"][0]["text"] == "Continue and answer the current request."


def test_openai_retries_transient_transport_and_5xx(monkeypatch):
    FakeClient.calls = []; FakeClient.responses = [OSError("network"), Response(503, {"error": {"message": "busy"}}),
        Response(200, {"choices": [{"message": {"content": "ok"}}]})]
    monkeypatch.setattr("bpmn_analyst.llm.httpx.AsyncClient", FakeClient)
    provider = HTTPProvider(LLMConfig(provider="openai-compatible", base_url="https://example.test/v1",
        api_key="secret", model="model"))
    assert asyncio.run(provider.complete([{"role": "user", "content": "x"}])) == "ok"
    assert len(FakeClient.calls) == 3 and FakeClient.calls[-1][1]["headers"]["Authorization"] == "Bearer secret"


def test_non_transient_400_is_not_retried(monkeypatch):
    FakeClient.calls = []; FakeClient.responses = [Response(400, {"error": {"message": "bad request"}}, "bad")]
    monkeypatch.setattr("bpmn_analyst.llm.httpx.AsyncClient", FakeClient)
    provider = HTTPProvider(LLMConfig(provider="openai-compatible", api_key="secret"))
    with pytest.raises(RuntimeError, match="bad request"):
        asyncio.run(provider.complete([{"role": "user", "content": "x"}]))
    assert len(FakeClient.calls) == 1


def test_transport_error_keeps_type_when_exception_message_is_empty(monkeypatch):
    FakeClient.calls = []; FakeClient.responses = [TimeoutError(), TimeoutError(), TimeoutError()]
    monkeypatch.setattr("bpmn_analyst.llm.httpx.AsyncClient", FakeClient)
    provider = HTTPProvider(LLMConfig(provider="openai-compatible", api_key="secret"))
    with pytest.raises(RuntimeError, match="network error: TimeoutError"):
        asyncio.run(provider.complete([{"role": "user", "content": "x"}]))
    assert len(FakeClient.calls) == 3


def test_structured_output_retries_validation_with_correction_message(monkeypatch):
    FakeClient.calls = []; FakeClient.responses = [
        Response(200, {"choices": [{"message": {"content": '{"conflict":"wrong"}'}}]}),
        Response(200, {"choices": [{"message": {"content": 'prose {"conflict":true,"reason":"ناسازگار"}'}}]}),
    ]
    monkeypatch.setattr("bpmn_analyst.llm.httpx.AsyncClient", FakeClient)
    provider = HTTPProvider(LLMConfig(provider="openai-compatible", api_key="secret"))
    result = asyncio.run(provider.structured(ConflictCheck, "ConflictCheck", [{"role": "user", "content": "x"}]))
    assert result.conflict and len(FakeClient.calls) == 2
    messages = FakeClient.calls[1][1]["json"]["messages"]
    assert "previous answer was invalid" in messages[-1]["content"]


def test_missing_key_and_content_blocked(monkeypatch):
    provider = HTTPProvider(LLMConfig(provider="openai-compatible", api_key=""))
    with pytest.raises(RuntimeError, match="LLM_API_KEY"):
        asyncio.run(provider.complete([{"role": "user", "content": "x"}]))
    FakeClient.calls = []; FakeClient.responses = [Response(200, {"promptFeedback": {"blockReason": "SAFETY"}})]
    monkeypatch.setattr("bpmn_analyst.llm.httpx.AsyncClient", FakeClient)
    provider = HTTPProvider(LLMConfig(provider="gemini", api_key="secret"))
    with pytest.raises(RuntimeError, match="content-blocked"):
        asyncio.run(provider.complete([{"role": "user", "content": "x"}]))
