from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field


def now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class Model(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)


class Message(Model):
    role: Literal["user", "assistant", "system"]
    content: str
    at: str = Field(default_factory=now)
    phase: str | None = None


class Role(Model):
    id: str
    name: str
    type: str = "human"
    description: str | None = None


class Requirement(Model):
    id: str
    category: str = "functional"
    statement: str
    confirmed: bool = False


class BusinessRule(Model):
    id: str
    statement: str
    kind: Literal["explicit", "implicit"] = "explicit"
    rationale: str | None = None
    confirmed: bool = False


class Ambiguity(Model):
    id: str
    description: str
    question: str
    status: str = "open"


class Contradiction(Model):
    id: str
    description: str
    conflictingItems: list[str] = Field(default_factory=list)
    severity: str = "medium"
    suggestedResolution: str = ""
    status: str = "open"


class Citation(Model):
    chunkId: str
    docId: str
    docTitle: str
    kind: str
    helpful: bool | None = None


class AdminQuestion(Model):
    id: str
    question: str
    answer: str | None = None
    status: Literal["pending", "answered"] = "pending"
    createdAt: str = Field(default_factory=now)
    answeredAt: str | None = None
    learnedFeedbackId: str | None = None


class Outputs(Model):
    bpmnXml: str | None = None
    diagramSvg: str | None = None
    summary: str | None = None
    document: str | None = None


class Session(Model):
    id: str
    createdAt: str = Field(default_factory=now)
    updatedAt: str = Field(default_factory=now)
    request: str = ""
    phase: str = "intake"
    messages: list[Message] = Field(default_factory=list)
    requirements: list[Requirement] = Field(default_factory=list)
    roles: list[Role] = Field(default_factory=list)
    businessRules: list[BusinessRule] = Field(default_factory=list)
    ambiguities: list[Ambiguity] = Field(default_factory=list)
    contradictions: list[Contradiction] = Field(default_factory=list)
    openQuestions: list[Any] = Field(default_factory=list)
    processModel: dict[str, Any] | None = None
    outputs: Outputs = Field(default_factory=Outputs)
    citations: list[Citation] = Field(default_factory=list)
    adminQuestions: list[AdminQuestion] = Field(default_factory=list)
    correction: dict[str, Any] | None = None

    @classmethod
    def create(cls, request: str = "") -> "Session":
        return cls(id=str(uuid4()), request=request)


class Turn(Model):
    reply: str
    awaitingUser: bool
    session: Session


class Analysis(Model):
    roles: list[dict[str, Any]] = Field(default_factory=list)
    requirements: list[dict[str, Any]] = Field(default_factory=list)
    businessRules: list[dict[str, Any]] = Field(default_factory=list)
    questions: list[str] = Field(default_factory=list)


class ProcessModel(Model):
    name: str
    lanes: list[dict[str, Any]] = Field(default_factory=list)
    startEvents: list[dict[str, Any]] = Field(min_length=1)
    endEvents: list[dict[str, Any]] = Field(min_length=1)
    intermediateEvents: list[dict[str, Any]] = Field(default_factory=list)
    activities: list[dict[str, Any]] = Field(default_factory=list)
    gateways: list[dict[str, Any]] = Field(default_factory=list)
    sequenceFlows: list[dict[str, Any]] = Field(default_factory=list)
    dataObjects: list[dict[str, Any]] = Field(default_factory=list)
