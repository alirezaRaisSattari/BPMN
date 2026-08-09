import asyncio

from bpmn_analyst.agents.base import AgentContext
from bpmn_analyst.knowledge import KnowledgeRetriever, KnowledgeStore
from bpmn_analyst.llm import MockProvider
from bpmn_analyst.models import KnowledgeChunk, Session
from bpmn_analyst.orchestrator import Orchestrator
from conftest import READY_FIXTURES


def test_full_pipeline_to_logical_model():
    session = Session.create(session_id="s1")
    result = asyncio.run(Orchestrator(AgentContext(llm=MockProvider(READY_FIXTURES)))
        .begin(session, "طراحی فرآیند ثبت‌نام دانشجو"))
    assert result.phase == "done" and result.processModel
    assert "bpmn:definitions" in session.outputs.bpmnXml
    assert "مستند فرآیند" in session.outputs.document
    assert not result.awaitingUser and "سیستم" in [x.name for x in session.roles]
    assert any(x.kind == "explicit" for x in session.businessRules)
    assert len(session.processModel.activities) == 1


def test_records_deduplicated_retrieval_provenance_and_progress():
    async def scenario():
        store = KnowledgeStore(); await store.add_chunks([KnowledgeChunk(id="g#0", docId="bpmn-guidelines",
            docTitle="BPMN Guidelines", kind="bpmn_guideline",
            text="هر فرآیند باید یک رویداد شروع و پایان داشته باشد و نقش‌ها و مراحل مشخص باشند.")])
        session = Session.create(session_id="s-cite"); phases = []
        await Orchestrator(AgentContext(llm=MockProvider(READY_FIXTURES), retriever=KnowledgeRetriever(store)))\
            .begin(session, "طراحی فرآیند ثبت‌نام دانشجو", phases.append)
        assert session.citations and session.citations[0].docId == "bpmn-guidelines"
        assert len({x.chunkId for x in session.citations}) == len(session.citations)
        assert phases == ["elicitation", "actors", "business_rules", "implicit_knowledge", "ambiguity",
                          "contradiction", "logical_model", "bpmn_generation", "done"]
    asyncio.run(scenario())


def test_asks_clarifying_questions_and_waits():
    fixtures = {"ElicitationResult": {"extractedRequirements": [],
        "questions": [{"text": "آغازکنندهٔ فرآیند کیست؟", "category": "initiator"}],
        "assistantMessage": "برای شروع چند سؤال دارم:", "readyToModel": False}}
    session = Session.create(session_id="s2")
    result = asyncio.run(Orchestrator(AgentContext(llm=MockProvider(fixtures))).begin(session, "طراحی فرآیند مرخصی"))
    assert result.awaitingUser and result.phase == "elicitation"
    assert len(session.openQuestions) == 1 and "آغازکننده" in result.reply


def test_proposes_and_confirms_implicit_rules():
    fixtures = {**READY_FIXTURES, "ImplicitResult": {"implicitRules": [
        {"statement": "هر فرآیند شروع و پایان دارد", "rationale": "اصل BPMN"}]}}
    orchestrator = Orchestrator(AgentContext(llm=MockProvider(fixtures))); session = Session.create(session_id="s3")
    first = asyncio.run(orchestrator.begin(session, "طراحی فرآیند خرید"))
    assert first.awaitingUser and first.phase == "implicit_knowledge"
    assert any(x.kind == "implicit" and not x.confirmed for x in session.businessRules)
    second = asyncio.run(orchestrator.respond(session, "بله تایید می‌کنم"))
    assert all(x.confirmed for x in session.businessRules if x.kind == "implicit")
    assert second.phase == "done" and second.processModel


def test_ambiguity_and_contradiction_scenario_resolves_on_followup():
    fixtures = {**READY_FIXTURES,
        "AmbiguityResult": {"ambiguities": [{"description": "نقش تأییدکننده روشن نیست", "question": "چه کسی تأیید می‌کند؟"}]}}
    orchestrator = Orchestrator(AgentContext(llm=MockProvider(fixtures))); session = Session.create(session_id="s4")
    first = asyncio.run(orchestrator.begin(session, "فرآیند درخواست"))
    assert first.phase == "ambiguity" and first.awaitingUser
    orchestrator.context.llm.fixtures["AmbiguityResult"] = {"ambiguities": []}
    orchestrator.context.llm.fixtures["ContradictionResult"] = {"contradictions": [{
        "description": "دو قانون ناسازگارند", "conflictingItems": ["الف", "ب"],
        "severity": "high", "suggestedResolution": "قانون الف مقدم باشد"}]}
    second = asyncio.run(orchestrator.respond(session, "مدیر گروه تأیید می‌کند"))
    assert second.phase == "contradiction" and second.awaitingUser and session.ambiguities[0].status == "resolved"
    orchestrator.context.llm.fixtures["ContradictionResult"] = {"contradictions": []}
    third = asyncio.run(orchestrator.respond(session, "قانون الف مقدم است"))
    assert third.phase == "done" and session.contradictions[0].status == "resolved"
