from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass, field
from types import UnionType
from typing import Any, Literal, Union, get_args, get_origin

import httpx
from pydantic import BaseModel


@dataclass
class LLMConfig:
    provider: str = field(default_factory=lambda: os.getenv("LLM_PROVIDER", "mock"))
    base_url: str = field(default_factory=lambda: os.getenv("LLM_BASE_URL", "https://agentrouter.org/v1").rstrip("/"))
    api_key: str = field(default_factory=lambda: os.getenv("LLM_API_KEY", ""))
    model: str = field(default_factory=lambda: os.getenv("LLM_MODEL", "glm-5.2"))
    max_tokens: int = field(default_factory=lambda: int(os.getenv("LLM_MAX_TOKENS", "4096")))
    headers: dict[str, str] = field(default_factory=lambda: {
        **({"User-Agent": os.environ["LLM_USER_AGENT"]} if os.getenv("LLM_USER_AGENT") else {}),
        **({"x-app": os.environ["LLM_X_APP"]} if os.getenv("LLM_X_APP") else {}),
    })


def extract_json(raw: str) -> str:
    text = raw.strip()
    if "```" in text:
        parts = text.split("```")
        if len(parts) >= 3:
            text = parts[1].removeprefix("json").strip()
    starts = [(text.find("{"), "{", "}"), (text.find("["), "[", "]")]
    starts = [x for x in starts if x[0] >= 0]
    if not starts: return text
    start, opening, closing = min(starts)
    depth = 0; in_string = False; escaped = False
    for index in range(start, len(text)):
        char = text[index]
        if in_string:
            if escaped: escaped = False
            elif char == "\\": escaped = True
            elif char == '"': in_string = False
            continue
        if char == '"': in_string = True
        elif char == opening: depth += 1
        elif char == closing:
            depth -= 1
            if depth == 0: return text[start:index + 1]
    return text[start:]


class LLMProvider:
    name: str
    model: str
    async def complete(self, messages: list[dict[str, str]], system: str = "", max_tokens: int | None = None,
                       temperature: float = .3) -> str: raise NotImplementedError
    async def structured(self, schema: type[BaseModel], schema_name: str, messages: list[dict[str, str]],
                         system: str = "", description: str = "", max_tokens: int | None = None,
                         temperature: float = .2, retries: int = 2) -> BaseModel: raise NotImplementedError


class MockProvider(LLMProvider):
    name = "mock"; model = "mock"
    def __init__(self, fixtures: dict[str, Any] | None = None): self.fixtures = fixtures or {}
    async def complete(self, messages: list[dict[str, str]], **_: Any) -> str:
        return "MOCK: " + (messages[-1]["content"][:80] if messages else "")
    async def structured(self, schema: type[BaseModel], schema_name: str, messages: list[dict[str, str]],
                         system: str = "", description: str = "", max_tokens: int | None = None,
                         temperature: float = .2, retries: int = 2) -> BaseModel:
        if schema_name in self.fixtures: return schema.model_validate(self.fixtures[schema_name])
        return synthesize(schema)


def synthesize(schema: type[BaseModel]) -> BaseModel:
    from .models import (ActorsResult, AmbiguityResult, ConflictCheck, ContradictionResult,
                         CorrectionDiff, ElicitationResult, FeedbackExtraction, ImplicitResult,
                         ProcessModel, ReviewResult, RulesResult)
    samples: dict[type[BaseModel], Any] = {
        ElicitationResult: {"extractedRequirements": [], "questions": [], "assistantMessage": "اطلاعات دریافت شد.", "readyToModel": False},
        ActorsResult: {"roles": []}, RulesResult: {"rules": []}, ImplicitResult: {"implicitRules": []},
        AmbiguityResult: {"ambiguities": []}, ContradictionResult: {"contradictions": []},
        ReviewResult: {"ok": True, "issues": []}, ConflictCheck: {"conflict": False, "reason": ""},
        FeedbackExtraction: {"points": []}, CorrectionDiff: {"description": ""},
        ProcessModel: {"name": "sample", "startEvents": [{"id": "start_1"}], "endEvents": [{"id": "end_1"}],
                       "activities": [], "gateways": [], "sequenceFlows": [{"id": "flow_1", "sourceRef": "start_1", "targetRef": "end_1"}]},
    }
    if schema in samples: return schema.model_validate(samples[schema])

    def value_for(annotation: Any) -> Any:
        origin, args = get_origin(annotation), get_args(annotation)
        if origin is Literal: return args[0]
        if origin in {list, set, tuple}: return []
        if origin is dict: return {}
        if origin in {Union, UnionType}:
            choices = [x for x in args if x is not type(None)]
            return None if len(choices) != len(args) else value_for(choices[0])
        if isinstance(annotation, type) and issubclass(annotation, BaseModel):
            return {name: value_for(field.annotation) for name, field in annotation.model_fields.items()
                    if field.is_required()}
        return {str: "sample", int: 0, float: 0.0, bool: False}.get(annotation, None)

    return schema.model_validate({name: value_for(model_field.annotation)
        for name, model_field in schema.model_fields.items() if model_field.is_required()})


class HTTPProvider(LLMProvider):
    def __init__(self, config: LLMConfig | None = None):
        self.config = config or LLMConfig(); self.name = self.config.provider; self.model = self.config.model

    async def _request(self, messages: list[dict[str, str]], system: str, max_tokens: int, temperature: float,
                       response_schema: dict[str, Any] | None = None) -> str:
        if not self.config.api_key: raise RuntimeError("LLM_API_KEY is required")
        if self.name == "gemini":
            url = f"{self.config.base_url}/models/{self.model}:generateContent"
            contents = [{"role": "model" if m["role"] == "assistant" else "user",
                "parts": [{"text": m["content"]}]} for m in messages]
            if contents and contents[-1]["role"] == "model":
                contents.append({"role": "user", "parts": [{"text": "Continue and answer the current request."}]})
            body: dict[str, Any] = {"contents": contents,
                "generationConfig": {"temperature": temperature, "maxOutputTokens": max_tokens}}
            if system: body["systemInstruction"] = {"parts": [{"text": system}]}
            if response_schema:
                body["generationConfig"].update({"responseMimeType": "application/json", "responseJsonSchema": response_schema})
            headers = {"X-goog-api-key": self.config.api_key}
        else:
            url = f"{self.config.base_url}/chat/completions"
            all_messages = ([{"role": "system", "content": system}] if system else []) + messages
            body = {"model": self.model, "messages": all_messages, "max_tokens": max_tokens, "temperature": temperature}
            headers = {"Authorization": f"Bearer {self.config.api_key}", **self.config.headers}
        last_error = ""
        async with httpx.AsyncClient(timeout=90) as client:
            for attempt in range(3):
                try:
                    response = await client.post(url, json=body, headers=headers)
                except Exception as exc:
                    detail = str(exc) or exc.__class__.__name__
                    last_error = f"network error: {detail}"
                    if attempt < 2: await asyncio.sleep(.5 * (attempt + 1))
                    continue
                if response.status_code >= 500 or response.status_code == 429:
                    last_error = f"HTTP {response.status_code}"
                    if attempt < 2: await asyncio.sleep(.5 * (attempt + 1))
                    continue
                try: data = response.json()
                except Exception:
                    raise RuntimeError(f"LLM HTTP {response.status_code}: non-JSON response: {response.text[:300]}")
                if response.status_code < 200 or response.status_code >= 300 or data.get("error"):
                    error = data.get("error", {})
                    message = error.get("message", "") if isinstance(error, dict) else str(error)
                    raise RuntimeError(f"LLM HTTP {response.status_code}: {message or response.text[:300]}")
                if self.name == "gemini":
                    if not data.get("candidates"):
                        reason = data.get("promptFeedback", {}).get("blockReason", "unknown")
                        raise RuntimeError(f"content-blocked: {reason}")
                    return "".join(x.get("text", "") for x in data["candidates"][0]["content"].get("parts", []))
                return data.get("choices", [{}])[0].get("message", {}).get("content") or ""
        raise RuntimeError(f"LLM request failed after 3 attempts: {last_error}")

    async def complete(self, messages: list[dict[str, str]], system: str = "", max_tokens: int | None = None,
                       temperature: float = .3) -> str:
        return await self._request(messages, system, max_tokens or self.config.max_tokens, temperature)

    async def structured(self, schema: type[BaseModel], schema_name: str, messages: list[dict[str, str]],
                         system: str = "", description: str = "", max_tokens: int | None = None,
                         temperature: float = .2, retries: int = 2) -> BaseModel:
        json_schema = schema.model_json_schema()
        instruction = "\n\n".join(x for x in [system, "You must respond with a SINGLE JSON value and nothing else.",
            f"Goal: {description}" if description else "", "The JSON MUST validate against this JSON Schema:\n" + json.dumps(json_schema, ensure_ascii=False),
            "Do not include markdown fences, comments, or prose outside JSON."] if x)
        last_error = ""
        for attempt in range(retries + 1):
            turns = list(messages)
            if attempt: turns.append({"role": "user", "content": f"Your previous answer was invalid: {last_error}\nReturn corrected JSON only."})
            raw = await self._request(turns, instruction, max_tokens or self.config.max_tokens, temperature,
                                      json_schema if self.name == "gemini" else None)
            try: return schema.model_validate_json(extract_json(raw))
            except Exception as exc: last_error = str(exc)
        raise RuntimeError(f"completeStructured({schema_name}) failed after {retries + 1} attempts: {last_error}")


def create_provider(fixtures: dict[str, Any] | None = None) -> LLMProvider:
    config = LLMConfig()
    if config.provider == "mock": return MockProvider(fixtures)
    if config.provider in {"openai-compatible", "gemini"}: return HTTPProvider(config)
    raise RuntimeError(f"Unknown LLM provider: {config.provider}")
