from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Any, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field


def now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class Model(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)


Phase = Literal["intake", "elicitation", "actors", "business_rules", "implicit_knowledge",
                "ambiguity", "contradiction", "logical_model", "bpmn_generation", "outputs", "done"]
RequirementCategory = Literal["initiator", "role", "activity", "ordering", "decision", "approval",
                              "rejection", "exception", "error_handling", "time_constraint", "parallel",
                              "end_state", "input_output", "other"]
KnowledgeKind = Literal["bpmn_guideline", "validation", "domain", "glossary", "other"]
BehaviorAgent = Literal["elicitation", "actors", "business_rules", "implicit", "ambiguity",
                        "contradiction", "logical_model"]
BpmnId = Annotated[str, Field(pattern=r"^[A-Za-z_][A-Za-z0-9_-]*$")]
NonEmpty = Annotated[str, Field(min_length=1)]


class Message(Model):
    role: Literal["user", "assistant", "system"]
    content: str
    at: str = Field(default_factory=now)
    phase: Phase | None = None


class Role(Model):
    id: NonEmpty
    name: str = Field(min_length=1)
    type: Literal["human", "system", "organization"] = "human"
    description: str | None = None


class Requirement(Model):
    id: NonEmpty
    category: RequirementCategory
    statement: str = Field(min_length=1)
    source: Literal["user", "inferred", "implicit"] = "user"
    confirmed: bool = False


class BusinessRule(Model):
    id: NonEmpty
    statement: str = Field(min_length=1)
    kind: Literal["explicit", "implicit"] = "explicit"
    category: str | None = None
    rationale: str | None = None
    source: Literal["user", "suggested"] = "user"
    confirmed: bool = False


class Ambiguity(Model):
    id: NonEmpty
    description: str = Field(min_length=1)
    question: str = Field(min_length=1)
    status: Literal["open", "resolved"] = "open"
    resolution: str | None = None


class Contradiction(Model):
    id: NonEmpty
    description: str = Field(min_length=1)
    conflictingItems: list[str] = Field(default_factory=list)
    severity: Literal["low", "medium", "high"] = "medium"
    suggestedResolution: str = Field(min_length=1)
    status: Literal["open", "resolved"] = "open"
    resolution: str | None = None


class Question(Model):
    id: NonEmpty
    text: str = Field(min_length=1)
    category: RequirementCategory = "other"
    rationale: str | None = None
    answered: bool = False
    answer: str | None = None


class Citation(Model):
    chunkId: str
    docId: str
    docTitle: str
    kind: str
    helpful: bool | None = None


class AdminQuestion(Model):
    id: NonEmpty
    question: str = Field(min_length=1)
    answer: str | None = None
    status: Literal["pending", "answered"] = "pending"
    createdAt: str = Field(default_factory=now)
    answeredAt: str | None = None
    learnedFeedbackId: str | None = None


class BpmnCorrection(Model):
    bpmnXml: str = Field(min_length=1)
    note: str = ""
    at: str = Field(default_factory=now)
    learnedFeedbackId: str | None = None


class Lane(Model):
    id: BpmnId
    name: str = Field(min_length=1)
    roleId: str | None = None


class StartEvent(Model):
    id: BpmnId
    name: str = "Start"
    type: Literal["none", "message", "timer", "conditional"] = "none"
    lane: str | None = None


class EndEvent(Model):
    id: BpmnId
    name: str = "End"
    type: Literal["none", "message", "error", "terminate"] = "none"
    lane: str | None = None


class IntermediateEvent(Model):
    id: BpmnId
    name: str = Field(min_length=1)
    type: Literal["message", "timer", "error", "signal"] = "message"
    throwing: bool = False
    lane: str | None = None


class Activity(Model):
    id: BpmnId
    name: str = Field(min_length=1)
    type: Literal["task", "userTask", "serviceTask", "manualTask", "scriptTask", "businessRuleTask"] = "task"
    lane: str | None = None
    inputs: list[str] = Field(default_factory=list)
    outputs: list[str] = Field(default_factory=list)


class Gateway(Model):
    id: BpmnId
    name: str | None = None
    type: Literal["exclusive", "parallel", "inclusive", "eventBased"] = "exclusive"
    lane: str | None = None


class SequenceFlow(Model):
    id: BpmnId
    sourceRef: str
    targetRef: str
    name: str | None = None
    condition: str | None = None


class DataObject(Model):
    id: BpmnId
    name: str = Field(min_length=1)


class ProcessModel(Model):
    name: str = Field(min_length=1)
    lanes: list[Lane] = Field(default_factory=list)
    startEvents: list[StartEvent] = Field(min_length=1)
    endEvents: list[EndEvent] = Field(min_length=1)
    intermediateEvents: list[IntermediateEvent] = Field(default_factory=list)
    activities: list[Activity] = Field(default_factory=list)
    gateways: list[Gateway] = Field(default_factory=list)
    sequenceFlows: list[SequenceFlow] = Field(default_factory=list)
    dataObjects: list[DataObject] = Field(default_factory=list)

class Outputs(Model):
    bpmnXml: str | None = None
    diagramSvg: str | None = None
    summary: str | None = None
    document: str | None = None


class Session(Model):
    id: NonEmpty
    createdAt: str = Field(default_factory=now)
    updatedAt: str = Field(default_factory=now)
    request: str = ""
    phase: Phase = "intake"
    messages: list[Message] = Field(default_factory=list)
    requirements: list[Requirement] = Field(default_factory=list)
    roles: list[Role] = Field(default_factory=list)
    businessRules: list[BusinessRule] = Field(default_factory=list)
    ambiguities: list[Ambiguity] = Field(default_factory=list)
    contradictions: list[Contradiction] = Field(default_factory=list)
    openQuestions: list[Question] = Field(default_factory=list)
    processModel: ProcessModel | None = None
    outputs: Outputs = Field(default_factory=Outputs)
    citations: list[Citation] = Field(default_factory=list)
    adminQuestions: list[AdminQuestion] = Field(default_factory=list)
    correction: BpmnCorrection | None = None

    @classmethod
    def create(cls, request: str = "", session_id: str | None = None) -> "Session":
        return cls(id=session_id or str(uuid4()), request=request)


class Turn(Model):
    reply: str
    phase: Phase
    awaitingUser: bool
    session: Session
    processModel: ProcessModel | None = None


class KnowledgeChunk(Model):
    id: NonEmpty
    docId: NonEmpty
    docTitle: NonEmpty
    kind: KnowledgeKind = "other"
    text: NonEmpty
    embedding: list[float] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)


class RetrievalResult(Model):
    chunk: KnowledgeChunk
    score: float


class RetrievalLogEntry(Model):
    at: str
    sessionId: str
    phase: str
    query: str
    topScore: float
    chunkIds: list[str] = Field(default_factory=list)


class SimilarChunk(Model):
    chunkId: NonEmpty
    docTitle: str
    text: str
    score: float
    conflict: bool = False
    conflictReason: str = ""


class KnowledgeCandidate(Model):
    id: NonEmpty
    statement: NonEmpty
    rationale: str = ""
    kind: KnowledgeKind = "other"
    tags: list[str] = Field(default_factory=list)
    status: Literal["pending", "accepted", "rejected"] = "pending"
    similar: list[SimilarChunk] = Field(default_factory=list)
    createdAt: str = Field(default_factory=now)
    decidedAt: str | None = None


class AdminFeedback(Model):
    id: NonEmpty
    sessionId: NonEmpty
    sessionRequest: str = ""
    text: NonEmpty
    createdAt: str = Field(default_factory=now)
    extractionError: str | None = None
    candidates: list[KnowledgeCandidate] = Field(default_factory=list)


class LearnedSource(Model):
    feedbackId: str
    sessionId: str
    at: str


class LearnedEntry(Model):
    id: NonEmpty
    feedbackId: NonEmpty
    sessionId: NonEmpty
    kind: KnowledgeKind = "other"
    text: NonEmpty
    tags: list[str] = Field(default_factory=list)
    weight: float = 1
    sources: list[LearnedSource] = Field(default_factory=list)
    createdAt: str


class BehaviorEntry(Model):
    id: NonEmpty
    agent: BehaviorAgent
    instruction: NonEmpty
    weight: float = 1
    sources: list[LearnedSource] = Field(default_factory=list)
    createdAt: str


class ExampleEntry(Model):
    id: NonEmpty
    sessionId: NonEmpty
    request: str = ""
    processModel: ProcessModel
    note: str = ""
    createdAt: str


class EvalExpectation(Model):
    bpmnValid: bool = True
    minRoles: int = Field(default=0, ge=0)
    minActivities: int = Field(default=0, ge=0)
    mustHaveRejectionPath: bool = False
    expectedRoles: list[str] = Field(default_factory=list)


class EvalCase(Model):
    id: NonEmpty
    sessionId: NonEmpty
    request: str = ""
    note: str = ""
    expected: EvalExpectation = Field(default_factory=EvalExpectation)
    createdAt: str


class EvalCheck(Model):
    label: str
    passed: bool
    detail: str = ""


class EvalResult(Model):
    caseId: str
    request: str
    passed: bool
    checks: list[EvalCheck] = Field(default_factory=list)
    error: str | None = None


# Structured agent outputs
class ExtractedRequirement(Model):
    category: RequirementCategory
    statement: str


class ProposedQuestion(Model):
    text: str
    category: RequirementCategory = "other"
    rationale: str | None = None


class ElicitationResult(Model):
    extractedRequirements: list[ExtractedRequirement] = Field(default_factory=list)
    questions: list[ProposedQuestion] = Field(default_factory=list)
    assistantMessage: str
    readyToModel: bool = False


class ActorProposal(Model):
    name: str
    type: Literal["human", "system", "organization"] = "human"
    description: str | None = None


class ActorsResult(Model):
    roles: list[ActorProposal] = Field(default_factory=list)


class Analysis(Model):
    roles: list[dict[str, Any]] = Field(default_factory=list)
    requirements: list[dict[str, Any]] = Field(default_factory=list)
    businessRules: list[dict[str, Any]] = Field(default_factory=list)
    questions: list[str] = Field(default_factory=list)


class RuleProposal(Model):
    statement: str
    category: str | None = None
    rationale: str | None = None


class RulesResult(Model):
    rules: list[RuleProposal] = Field(default_factory=list)


class ImplicitRuleProposal(Model):
    statement: str
    rationale: str


class ImplicitResult(Model):
    implicitRules: list[ImplicitRuleProposal] = Field(default_factory=list)


class AmbiguityProposal(Model):
    description: str
    question: str


class AmbiguityResult(Model):
    ambiguities: list[AmbiguityProposal] = Field(default_factory=list)


class ContradictionProposal(Model):
    description: str
    conflictingItems: list[str] = Field(default_factory=list)
    severity: Literal["low", "medium", "high"] = "medium"
    suggestedResolution: str


class ContradictionResult(Model):
    contradictions: list[ContradictionProposal] = Field(default_factory=list)


class ReviewIssue(Model):
    severity: Literal["info", "warning", "error"] = "warning"
    message: str
    suggestion: str | None = None


class ReviewResult(Model):
    ok: bool = True
    issues: list[ReviewIssue] = Field(default_factory=list)


class ConflictCheck(Model):
    conflict: bool = False
    reason: str = ""


class FeedbackPoint(Model):
    statement: str
    rationale: str = ""
    kind: KnowledgeKind = "other"
    tags: list[str] = Field(default_factory=list)
    generalizable: bool = False


class FeedbackExtraction(Model):
    points: list[FeedbackPoint] = Field(default_factory=list)


class CorrectionDiff(Model):
    description: str = ""
