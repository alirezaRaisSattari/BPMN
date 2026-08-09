from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Generic, TypeVar

from pydantic import BaseModel

from .knowledge import Bm25Index
from .models import (AdminFeedback, BehaviorAgent, BehaviorEntry, EvalCase, ExampleEntry,
                     LearnedEntry, LearnedSource, RetrievalLogEntry, Session)

T = TypeVar("T", bound=BaseModel)


def atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True); temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8"); temp.replace(path)


def summary(session: Session) -> dict[str, Any]:
    return {"id": session.id, "request": session.request, "phase": session.phase,
            "createdAt": session.createdAt, "updatedAt": session.updatedAt, "messageCount": len(session.messages)}


class DirectoryModelStore(Generic[T]):
    def __init__(self, directory: Path, model: type[T]): self.directory, self.model = directory, model
    def get(self, item_id: str) -> T | None:
        try: return self.model.model_validate_json((self.directory / f"{item_id}.json").read_text(encoding="utf-8"))
        except (OSError, ValueError): return None
    def save(self, item: T) -> None: atomic_json(self.directory / f"{getattr(item, 'id')}.json", item.model_dump(exclude_none=True))
    def list(self) -> list[T]:
        values = [x for path in self.directory.glob("*.json") if (x := self.get(path.stem))]
        return sorted(values, key=lambda x: getattr(x, "createdAt", ""), reverse=True)
    def remove(self, item_id: str) -> bool:
        try: (self.directory / f"{item_id}.json").unlink(); return True
        except FileNotFoundError: return False
    def read(self) -> list[dict[str, Any]]: return [x.model_dump(exclude_none=True) for x in self.list()]
    def write(self, values: list[dict[str, Any]]) -> None:
        wanted = {str(x["id"]) for x in values}
        for path in self.directory.glob("*.json") if self.directory.exists() else []:
            if path.stem not in wanted: path.unlink()
        for value in values: self.save(self.model.model_validate(value))


class SessionStore(DirectoryModelStore[Session]):
    def __init__(self, directory: Path): super().__init__(directory, Session)
    def list(self) -> list[dict[str, Any]]: return sorted([summary(x) for x in super().list()], key=lambda x: x["updatedAt"], reverse=True)


class MemorySessionStore:
    def __init__(self): self.sessions: dict[str, Session] = {}
    def get(self, item_id: str) -> Session | None: return self.sessions.get(item_id)
    def save(self, session: Session) -> None: self.sessions[session.id] = session
    def list(self) -> list[dict[str, Any]]: return sorted([summary(x) for x in self.sessions.values()], key=lambda x: x["updatedAt"], reverse=True)
    def remove(self, item_id: str) -> bool: return self.sessions.pop(item_id, None) is not None


class FeedbackStore(DirectoryModelStore[AdminFeedback]):
    def __init__(self, directory: Path): super().__init__(directory, AdminFeedback)


class EvalStore(DirectoryModelStore[EvalCase]):
    def __init__(self, directory: Path): super().__init__(directory, EvalCase)


def normalize_statement(text: str) -> str:
    return re.sub(r"[.。،؛!?…\s]+$", "", re.sub(r"\s+", " ", text).strip()).lower()


class JsonEntryStore(Generic[T]):
    def __init__(self, path: Path, model: type[T]): self.path, self.model, self.entries = path, model, []
    def load(self) -> "JsonEntryStore[T]":
        try: self.entries = [self.model.model_validate(x) for x in json.loads(self.path.read_text(encoding="utf-8")).get("entries", [])]
        except (OSError, ValueError): self.entries = []
        return self
    def persist(self) -> None: atomic_json(self.path, {"entries": [x.model_dump(exclude_none=True) for x in self.entries]})
    def list(self) -> list[T]: return sorted(self.entries, key=lambda x: getattr(x, "createdAt", ""), reverse=True)
    def get(self, item_id: str) -> T | None: return next((x for x in self.entries if getattr(x, "id") == item_id), None)
    def add(self, entry: T) -> None: self.entries.append(self.model.model_validate(entry)); self.persist()
    def remove(self, item_id: str) -> bool:
        before = len(self.entries); self.entries = [x for x in self.entries if getattr(x, "id") != item_id]
        if len(self.entries) == before: return False
        self.persist(); return True
    def read(self) -> dict[str, Any]: return {"entries": [x.model_dump(exclude_none=True) for x in self.entries]}
    def write(self, value: Any) -> None:
        rows = value.get("entries", []) if isinstance(value, dict) else value
        self.entries = [self.model.model_validate(x) for x in rows]; self.persist()


class LearnedKnowledgeStore(JsonEntryStore[LearnedEntry]):
    def __init__(self, path: Path): super().__init__(path, LearnedEntry)
    def list(self) -> list[LearnedEntry]: return sorted(self.entries, key=lambda x: (x.weight, x.createdAt), reverse=True)
    def find_by_text(self, text: str) -> LearnedEntry | None:
        key = normalize_statement(text); return next((x for x in self.entries if normalize_statement(x.text) == key), None)
    def reinforce(self, item_id: str, source: LearnedSource) -> LearnedEntry | None:
        entry = self.get(item_id)
        if entry: entry.weight += 1; entry.sources.append(source); self.persist()
        return entry
    def save(self) -> None: self.persist()


class BehaviorStore(JsonEntryStore[BehaviorEntry]):
    def __init__(self, path: Path): super().__init__(path, BehaviorEntry)
    def list(self) -> list[BehaviorEntry]:
        values = sorted(self.entries, key=lambda x: x.createdAt, reverse=True)
        values.sort(key=lambda x: x.weight, reverse=True)
        values.sort(key=lambda x: x.agent)
        return values
    def instructions_for(self, agent: BehaviorAgent) -> list[str]:
        return [x.instruction for x in sorted((e for e in self.entries if e.agent == agent), key=lambda x: (x.weight, x.createdAt), reverse=True)[:8]]
    def find_by_text(self, agent: BehaviorAgent, instruction: str) -> BehaviorEntry | None:
        key = normalize_statement(instruction); return next((x for x in self.entries if x.agent == agent and normalize_statement(x.instruction) == key), None)
    def reinforce(self, item_id: str, source: LearnedSource) -> BehaviorEntry | None:
        entry = self.get(item_id)
        if entry: entry.weight += 1; entry.sources.append(source); self.persist()
        return entry
    def update(self, item_id: str, instruction: str | None = None, agent: BehaviorAgent | None = None) -> BehaviorEntry | None:
        entry = self.get(item_id)
        if entry:
            if instruction is not None: entry.instruction = instruction
            if agent is not None: entry.agent = agent
            self.persist()
        return entry


class ExampleStore(JsonEntryStore[ExampleEntry]):
    def __init__(self, path: Path): super().__init__(path, ExampleEntry)
    def find_similar(self, request: str, k: int = 1, exclude_session_id: str | None = None) -> list[ExampleEntry]:
        pool = [x for x in self.entries if x.sessionId != exclude_session_id]
        index = Bm25Index()
        for entry in pool: index.add(entry.id, entry.request)
        by_id = {x.id: x for x in pool}; return [by_id[x[0]] for x in index.search(request, k) if x[0] in by_id]


class KnowledgeOverridesStore:
    def __init__(self, path: Path): self.path, self.disabled = path, set()
    def load(self) -> "KnowledgeOverridesStore":
        try: self.disabled = set(json.loads(self.path.read_text(encoding="utf-8")).get("disabled", []))
        except (OSError, ValueError): pass
        return self
    def list(self) -> list[str]: return list(self.disabled)
    def has(self, item_id: str) -> bool: return item_id in self.disabled
    def disable(self, item_id: str) -> None: self.disabled.add(item_id); self.persist()
    def enable(self, item_id: str) -> None: self.disabled.discard(item_id); self.persist()
    def persist(self) -> None: atomic_json(self.path, {"disabled": list(self.disabled)})


class RetrievalLog:
    def __init__(self, path: Path): self.path = path
    def append(self, entry: RetrievalLogEntry) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a", encoding="utf-8") as stream: stream.write(entry.model_dump_json() + "\n")
    def read(self) -> list[RetrievalLogEntry]:
        try: lines = self.path.read_text(encoding="utf-8").splitlines()
        except OSError: return []
        values = []
        for line in lines:
            try: values.append(RetrievalLogEntry.model_validate_json(line))
            except ValueError: pass
        return list(reversed(values))


def compute_gaps(entries: list[RetrievalLogEntry], threshold: float = 1) -> list[dict[str, Any]]:
    gaps: dict[str, dict[str, Any]] = {}
    for entry in entries:
        if entry.chunkIds and entry.topScore >= threshold: continue
        key = re.sub(r"\s+", " ", entry.query).strip().lower()
        if not key: continue
        if key in gaps:
            gap = gaps[key]; gap["count"] += 1; gap["worstScore"] = min(gap["worstScore"], entry.topScore)
            gap["lastAt"] = max(gap["lastAt"], entry.at)
            if entry.phase not in gap["phases"]: gap["phases"].append(entry.phase)
        else: gaps[key] = {"query": entry.query, "count": 1, "worstScore": entry.topScore, "lastAt": entry.at, "phases": [entry.phase]}
    return sorted(gaps.values(), key=lambda x: (x["count"], x["lastAt"]), reverse=True)
