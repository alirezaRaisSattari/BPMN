import asyncio
import json

import pytest
from pydantic import BaseModel, ValidationError

from bpmn_analyst.llm import MockProvider, create_provider, extract_json, synthesize
from bpmn_analyst.models import Activity, ProcessModel, Session


@pytest.mark.parametrize(("raw", "expected"), [
    ('{"a":1}', {"a": 1}),
    ('```json\n{"a":1}\n```', {"a": 1}),
    ('Here is the answer:\n{"a":{"b":2}} — done', {"a": {"b": 2}}),
    ('{"note":"a } bracket"}', {"note": "a } bracket"}),
    ('[1,2,3]', [1, 2, 3]),
])
def test_extract_json(raw, expected):
    assert json.loads(extract_json(raw)) == expected


class Thing(BaseModel):
    name: str
    tags: list[str]


def test_mock_returns_schema_valid_output():
    result = asyncio.run(MockProvider().structured(Thing, "Thing", [{"role": "user", "content": "x"}]))
    assert result == Thing(name="sample", tags=[])


def test_mock_honors_fixtures():
    result = asyncio.run(MockProvider({"Thing": {"name": "fixed", "tags": ["a"]}})
        .structured(Thing, "Thing", [{"role": "user", "content": "x"}]))
    assert result == Thing(name="fixed", tags=["a"])


def test_mock_rejects_invalid_nested_fixture():
    with pytest.raises(ValidationError):
        asyncio.run(MockProvider({"ProcessModel": {"name": "x", "startEvents": []}})
            .structured(ProcessModel, "ProcessModel", []))


def test_synthesize_process_model_is_valid():
    assert isinstance(synthesize(ProcessModel), ProcessModel)


def test_new_session_is_valid():
    session = Session.create("design an order process", "s1")
    assert Session.model_validate(session.model_dump()).phase == "intake"


def test_bpmn_entity_rejects_invalid_id_directly():
    with pytest.raises(ValidationError, match="string_pattern_mismatch"):
        Activity(id="bad id", name="task")


def test_unknown_provider_is_rejected(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "typo")
    with pytest.raises(RuntimeError, match="Unknown LLM provider"):
        create_provider()
