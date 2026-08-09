from __future__ import annotations

import asyncio
import json
import math
import os
import re
from collections import Counter, defaultdict, deque
from pathlib import Path
from typing import Any, AsyncIterator, Callable
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape, quoteattr

import httpx

from .models import Analysis, BusinessRule, Citation, Message, ProcessModel, Requirement, Role, Session, Turn, now


class JsonStore:
    def __init__(self, path: Path, default: Any):
        self.path, self.default = path, default

    def read(self) -> Any:
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            return self.default.copy() if isinstance(self.default, (dict, list)) else self.default

    def write(self, value: Any) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(self.path.suffix + ".tmp")
        tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(self.path)


class DirectoryStore:
    """One JSON object per file; compatible with former TypeScript stores."""
    def __init__(self, directory: Path): self.directory = directory
    def read(self) -> list[dict[str, Any]]:
        result = []
        for path in self.directory.glob("*.json") if self.directory.exists() else []:
            try: result.append(json.loads(path.read_text(encoding="utf-8")))
            except (OSError, json.JSONDecodeError): pass
        return sorted(result, key=lambda x: x.get("createdAt", ""), reverse=True)
    def write(self, values: list[dict[str, Any]]) -> None:
        self.directory.mkdir(parents=True, exist_ok=True)
        wanted = {str(v["id"]) for v in values}
        for old in self.directory.glob("*.json"):
            if old.stem not in wanted: old.unlink()
        for value in values: JsonStore(self.directory / f"{value['id']}.json", {}).write(value)


class SessionStore:
    def __init__(self, directory: Path):
        self.directory = directory

    def save(self, session: Session) -> None:
        JsonStore(self.directory / f"{session.id}.json", {}).write(
            session.model_dump(exclude_none=True)
        )

    def get(self, session_id: str) -> Session | None:
        path = self.directory / f"{session_id}.json"
        try:
            return Session.model_validate_json(path.read_text(encoding="utf-8"))
        except (FileNotFoundError, ValueError):
            return None

    def remove(self, session_id: str) -> bool:
        try:
            (self.directory / f"{session_id}.json").unlink()
            return True
        except FileNotFoundError:
            return False

    def list(self) -> list[dict[str, Any]]:
        rows = []
        for path in self.directory.glob("*.json") if self.directory.exists() else []:
            session = self.get(path.stem)
            if session:
                rows.append({"id": session.id, "request": session.request, "phase": session.phase,
                             "createdAt": session.createdAt, "updatedAt": session.updatedAt,
                             "messageCount": len(session.messages)})
        return sorted(rows, key=lambda row: row["updatedAt"], reverse=True)


class Provider:
    def __init__(self) -> None:
        self.name = os.getenv("LLM_PROVIDER", "openai-compatible")
        self.model = os.getenv("LLM_MODEL", "gpt-5.4-mini")
        self.base_url = os.getenv("LLM_BASE_URL", "https://api.freemodel.dev/v1").rstrip("/")
        self.api_key = os.getenv("LLM_API_KEY", "")
        self.max_tokens = int(os.getenv("LLM_MAX_TOKENS", "4096"))

    async def structured(self, schema: type[Analysis] | type[ProcessModel], system: str,
                         prompt: str) -> Analysis | ProcessModel:
        if self.name == "mock":
            if schema is Analysis:
                return Analysis(
                    roles=[{"id": "role_user", "name": "کاربر", "type": "human"}],
                    requirements=[{"id": "req_1", "category": "functional", "statement": prompt[:200], "confirmed": True}],
                    businessRules=[], questions=["لطفاً نتیجه مورد انتظار و مراحل اصلی را توضیح دهید."])
            return ProcessModel.model_validate(sample_model(prompt))
        if not self.api_key:
            raise RuntimeError("LLM_API_KEY is required")
        instruction = (
            system + "\nReturn one JSON object only. It must satisfy this JSON Schema:\n" +
            json.dumps(schema.model_json_schema(), ensure_ascii=False)
        )
        error = ""
        async with httpx.AsyncClient(timeout=90) as client:
            for attempt in range(3):
                body = {"model": self.model, "messages": [
                    {"role": "system", "content": instruction},
                    {"role": "user", "content": prompt + (f"\nPrevious invalid output: {error}" if error else "")},
                ], "max_tokens": self.max_tokens, "temperature": 0.2}
                try:
                    response = await client.post(f"{self.base_url}/chat/completions", json=body,
                        headers={"Authorization": f"Bearer {self.api_key}",
                                 "User-Agent": os.getenv("LLM_USER_AGENT", "bpmn-analyst/0.2"),
                                 "X-App": os.getenv("LLM_X_APP", "bpmn-analyst")})
                    response.raise_for_status()
                    raw = response.json()["choices"][0]["message"]["content"]
                    match = re.search(r"\{.*\}", raw, re.S)
                    return schema.model_validate_json(match.group(0) if match else raw)
                except Exception as exc:
                    error = str(exc)
                    if attempt < 2:
                        await asyncio.sleep(.5 * (attempt + 1))
        raise RuntimeError(f"structured LLM output failed: {error}")


def sample_model(request: str) -> dict[str, Any]:
    return {"name": request[:80] or "فرآیند", "lanes": [{"id": "lane_user", "name": "کاربر"}],
        "startEvents": [{"id": "start", "name": "شروع", "type": "none", "lane": "lane_user"}],
        "endEvents": [{"id": "end", "name": "پایان", "type": "none", "lane": "lane_user"}],
        "intermediateEvents": [],
        "activities": [{"id": "task_1", "name": "انجام درخواست", "type": "userTask", "lane": "lane_user", "inputs": [], "outputs": []}],
        "gateways": [], "dataObjects": [],
        "sequenceFlows": [{"id": "flow_1", "sourceRef": "start", "targetRef": "task_1"},
                          {"id": "flow_2", "sourceRef": "task_1", "targetRef": "end"}]}


def validate_model(model: dict[str, Any]) -> dict[str, Any]:
    nodes = [*model.get("startEvents", []), *model.get("endEvents", []),
             *model.get("intermediateEvents", []), *model.get("activities", []), *model.get("gateways", [])]
    ids, duplicates, errors, warnings = set(), set(), [], []
    for node in nodes:
        (duplicates if node["id"] in ids else ids).add(node["id"])
    if duplicates: errors.append("شناسه‌های تکراری: " + ", ".join(sorted(duplicates)))
    if not model.get("startEvents"): errors.append("هیچ رویداد شروعی وجود ندارد.")
    if not model.get("endEvents"): errors.append("هیچ رویداد پایانی وجود ندارد.")
    incoming, outgoing = set(), set()
    for flow in model.get("sequenceFlows", []):
        if flow["sourceRef"] not in ids: errors.append(f"جریان {flow['id']}: مبدأ نامعتبر.")
        if flow["targetRef"] not in ids: errors.append(f"جریان {flow['id']}: مقصد نامعتبر.")
        outgoing.add(flow["sourceRef"]); incoming.add(flow["targetRef"])
    for event in model.get("startEvents", []):
        if event["id"] not in outgoing: errors.append(f"رویداد شروع «{event['id']}» جریان خروجی ندارد.")
    for event in model.get("endEvents", []):
        if event["id"] not in incoming: errors.append(f"رویداد پایان «{event['id']}» جریان ورودی ندارد.")
    return {"valid": not errors, "errors": errors, "warnings": warnings}


TAGS = {"task": "task", "userTask": "userTask", "serviceTask": "serviceTask",
        "manualTask": "manualTask", "scriptTask": "scriptTask", "businessRuleTask": "businessRuleTask"}
GATEWAYS = {"exclusive": "exclusiveGateway", "parallel": "parallelGateway",
            "inclusive": "inclusiveGateway", "eventBased": "eventBasedGateway"}


def bpmn_xml(model: dict[str, Any]) -> str:
    incoming, outgoing = defaultdict(list), defaultdict(list)
    for f in model.get("sequenceFlows", []):
        outgoing[f["sourceRef"]].append(f["id"]); incoming[f["targetRef"]].append(f["id"])
    def refs(node_id: str) -> str:
        return "".join(f"<bpmn:incoming>{escape(x)}</bpmn:incoming>" for x in incoming[node_id]) + \
               "".join(f"<bpmn:outgoing>{escape(x)}</bpmn:outgoing>" for x in outgoing[node_id])
    parts = []
    for e in model.get("startEvents", []): parts.append(f'<bpmn:startEvent id={quoteattr(e["id"])} name={quoteattr(e.get("name", "Start"))}>{refs(e["id"])}</bpmn:startEvent>')
    for a in model.get("activities", []):
        tag = TAGS.get(a.get("type"), "task"); parts.append(f'<bpmn:{tag} id={quoteattr(a["id"])} name={quoteattr(a["name"])}>{refs(a["id"])}</bpmn:{tag}>')
    for g in model.get("gateways", []):
        tag = GATEWAYS.get(g.get("type"), "exclusiveGateway"); parts.append(f'<bpmn:{tag} id={quoteattr(g["id"])} name={quoteattr(g.get("name", ""))}>{refs(g["id"])}</bpmn:{tag}>')
    for e in model.get("intermediateEvents", []):
        tag = "intermediateThrowEvent" if e.get("throwing") else "intermediateCatchEvent"; parts.append(f'<bpmn:{tag} id={quoteattr(e["id"])} name={quoteattr(e["name"])}>{refs(e["id"])}</bpmn:{tag}>')
    for e in model.get("endEvents", []): parts.append(f'<bpmn:endEvent id={quoteattr(e["id"])} name={quoteattr(e.get("name", "End"))}>{refs(e["id"])}</bpmn:endEvent>')
    for f in model.get("sequenceFlows", []): parts.append(f'<bpmn:sequenceFlow id={quoteattr(f["id"])} sourceRef={quoteattr(f["sourceRef"])} targetRef={quoteattr(f["targetRef"])} name={quoteattr(f.get("name", ""))}/>')
    semantic = f'''<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn"><bpmn:process id="Process_1" name={quoteattr(model["name"])} isExecutable="false">{"".join(parts)}</bpmn:process></bpmn:definitions>'''
    try: return add_di(semantic, model)
    except Exception: return semantic


def add_di(xml: str, model: dict[str, Any]) -> str:
    nodes = [*model.get("startEvents", []), *model.get("activities", []), *model.get("gateways", []), *model.get("intermediateEvents", []), *model.get("endEvents", [])]
    by_id = {n["id"]: n for n in nodes}; graph = defaultdict(list); degree = {n["id"]: 0 for n in nodes}
    for f in model.get("sequenceFlows", []):
        if f["sourceRef"] in by_id and f["targetRef"] in by_id:
            graph[f["sourceRef"]].append(f["targetRef"]); degree[f["targetRef"]] += 1
    levels, q = {}, deque(sorted(k for k, v in degree.items() if v == 0))
    while q:
        node = q.popleft(); levels.setdefault(node, 0)
        for target in graph[node]:
            levels[target] = max(levels.get(target, 0), levels[node] + 1); degree[target] -= 1
            if degree[target] == 0: q.append(target)
    for node in by_id: levels.setdefault(node, max(levels.values(), default=-1) + 1)
    grouped = defaultdict(list)
    for node, level in levels.items(): grouped[level].append(node)
    pos = {}
    for level, ids in grouped.items():
        for row, node in enumerate(sorted(ids)): pos[node] = (100 + level * 180, 80 + row * 140)
    dims = {}
    event_ids = {n["id"] for n in [*model.get("startEvents", []), *model.get("endEvents", []), *model.get("intermediateEvents", [])]}
    gateway_ids = {n["id"] for n in model.get("gateways", [])}
    shapes = []
    for node in nodes:
        w, h = ((36, 36) if node["id"] in event_ids else (50, 50) if node["id"] in gateway_ids else (110, 80))
        x, y = pos[node["id"]]; dims[node["id"]] = (x, y, w, h)
        shapes.append(f'<bpmndi:BPMNShape id="{node["id"]}_di" bpmnElement="{node["id"]}"><dc:Bounds x="{x}" y="{y}" width="{w}" height="{h}"/></bpmndi:BPMNShape>')
    edges = []
    for f in model.get("sequenceFlows", []):
        if f["sourceRef"] not in dims or f["targetRef"] not in dims: continue
        sx, sy, sw, sh = dims[f["sourceRef"]]; tx, ty, tw, th = dims[f["targetRef"]]; mx = (sx + sw + tx) / 2
        edges.append(f'<bpmndi:BPMNEdge id="{f["id"]}_di" bpmnElement="{f["id"]}"><di:waypoint x="{sx+sw}" y="{sy+sh/2}"/><di:waypoint x="{mx}" y="{sy+sh/2}"/><di:waypoint x="{mx}" y="{ty+th/2}"/><di:waypoint x="{tx}" y="{ty+th/2}"/></bpmndi:BPMNEdge>')
    diagram = '<bpmndi:BPMNDiagram id="BPMNDiagram_1"><bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">' + ''.join(shapes + edges) + '</bpmndi:BPMNPlane></bpmndi:BPMNDiagram>'
    return xml.replace('</bpmn:definitions>', diagram + '</bpmn:definitions>')


def document(session: Session) -> tuple[str, str]:
    model = session.processModel or {}; roles = "، ".join(r.name for r in session.roles) or "ثبت نشده"
    summary = f"{model.get('name', session.request)} — {len(model.get('activities', []))} فعالیت، {len(model.get('gateways', []))} دروازه"
    body = f"# {model.get('name', session.request)}\n\n## خلاصه\n{summary}\n\n## نقش‌ها\n{roles}\n\n## الزامات\n" + "\n".join(f"- {r.statement}" for r in session.requirements)
    return summary, body


class Orchestrator:
    def __init__(self, provider: Provider, knowledge: "Knowledge | None" = None):
        self.provider, self.knowledge = provider, knowledge

    async def begin(self, session: Session, request: str, progress: Callable[[str], None] | None = None) -> Turn:
        session.request = request; session.messages.append(Message(role="user", content=request)); self._phase(session, "elicitation", progress)
        grounding = self.knowledge.search(request) if self.knowledge else []
        for chunk in grounding:
            if not any(c.chunkId == chunk["id"] for c in session.citations):
                session.citations.append(Citation(chunkId=chunk["id"], docId=chunk["docId"], docTitle=chunk["docTitle"], kind=chunk["kind"]))
        context = "\n\nKnowledge:\n" + "\n".join(x["text"] for x in grounding) if grounding else ""
        result = await self.provider.structured(Analysis, "You are an expert Persian business analyst. Extract facts and ask only essential questions.", request + context)
        session.roles = [Role.model_validate(x) for x in result.roles]
        session.requirements = [Requirement.model_validate(x) for x in result.requirements]
        session.businessRules = [BusinessRule.model_validate(x) for x in result.businessRules]
        questions = [q.strip() for q in result.questions if q.strip()]
        reply = "برای تکمیل تحلیل، لطفاً پاسخ دهید:\n\n" + "\n".join(f"- {q}" for q in questions) if questions else "اطلاعات اولیه دریافت شد. برای تولید مدل، جزئیات مراحل و استثناها را ارسال کنید."
        session.messages.append(Message(role="assistant", content=reply, phase=session.phase)); session.updatedAt = now()
        return Turn(reply=reply, awaitingUser=True, session=session)

    async def respond(self, session: Session, text: str, progress: Callable[[str], None] | None = None) -> Turn:
        session.messages.append(Message(role="user", content=text, phase=session.phase))
        transcript = "\n".join(f"{m.role}: {m.content}" for m in session.messages)
        for phase in ["actors", "business_rules", "implicit_knowledge", "ambiguity", "contradiction", "logical_model"]:
            self._phase(session, phase, progress)
        model = await self.provider.structured(ProcessModel, "You are a BPMN 2.0 modeler. Build complete, connected process JSON. IDs must match ^[A-Za-z_][A-Za-z0-9_-]*$.", transcript)
        session.processModel = model.model_dump(); self._phase(session, "bpmn_generation", progress)
        session.outputs.bpmnXml = bpmn_xml(session.processModel); self._phase(session, "outputs", progress)
        session.outputs.summary, session.outputs.document = document(session); self._phase(session, "done", progress)
        validation = validate_model(session.processModel)
        reply = f"مدل BPMN تولید شد ✅\nفعالیت‌ها: {len(model.activities)} | دروازه‌ها: {len(model.gateways)}\n" + ("مدل معتبر است." if validation["valid"] else f"{len(validation['errors'])} خطای ساختاری یافت شد.")
        session.messages.append(Message(role="assistant", content=reply, phase="done")); session.updatedAt = now()
        return Turn(reply=reply, awaitingUser=False, session=session)

    @staticmethod
    def _phase(session: Session, phase: str, progress: Callable[[str], None] | None) -> None:
        session.phase = phase; session.updatedAt = now()
        if progress: progress(phase)


def tokenize(text: str) -> list[str]: return re.findall(r"[\w\u0600-\u06ff]+", text.lower())


class Knowledge:
    def __init__(self, root: Path, index_path: Path):
        self.chunks: list[dict[str, Any]] = []
        for path in sorted(root.glob("*")):
            if path.suffix.lower() not in {".md", ".txt"}: continue
            text = path.read_text(encoding="utf-8")
            for i, part in enumerate(re.split(r"\n\s*\n", text)):
                if part.strip(): self.chunks.append({"id": f"{path.stem}-{i}", "docId": path.stem, "docTitle": path.stem, "kind": "document", "text": part.strip(), "tags": [], "source": "markdown", "disabled": False})
        if not index_path.exists():
            JsonStore(index_path, {}).write({"version": 1, "chunks": self.chunks})

    def search(self, query: str, limit: int = 5) -> list[dict[str, Any]]:
        terms = Counter(tokenize(query)); scored = []
        for chunk in self.chunks:
            words = Counter(tokenize(chunk["text"])); score = sum(terms[t] * words[t] / (words[t] + 1.2) for t in terms)
            if score: scored.append((score, chunk))
        return [dict(c, score=s) for s, c in sorted(scored, key=lambda x: x[0], reverse=True)[:limit]]
