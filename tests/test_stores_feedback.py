import asyncio
import json
from pathlib import Path

from bpmn_analyst.agents import run_feedback_extraction
from bpmn_analyst.agents.base import AgentContext
from bpmn_analyst.knowledge import KnowledgeRetriever, KnowledgeStore
from bpmn_analyst.llm import MockProvider
from bpmn_analyst.models import (AdminFeedback, BehaviorEntry, ExampleEntry, KnowledgeCandidate,
                                 KnowledgeChunk, LearnedEntry, LearnedSource, Session)
from bpmn_analyst.stores import (BehaviorStore, ExampleStore, FeedbackStore,
                                 KnowledgeOverridesStore, LearnedKnowledgeStore, SessionStore)
from conftest import process_model


def feedback(item_id="fb-1", created="2026-01-01T00:00:00Z"):
    return AdminFeedback(id=item_id, sessionId="s-1", sessionRequest="فرآیند مرخصی تحصیلی",
        text="مسیر رد درخواست مدل نشده بود.", createdAt=created, candidates=[KnowledgeCandidate(id="c-1",
            statement="هر مرحلهٔ تأیید باید مسیر رد داشته باشد.", rationale="الگوی رایج",
            kind="bpmn_guideline", tags=["gateway"], createdAt=created)])


def learned(item_id="learned-c-1", text="هر مرحلهٔ تأیید باید مسیر رد داشته باشد.", weight=1):
    return LearnedEntry(id=item_id, feedbackId="fb-1", sessionId="s-1", kind="bpmn_guideline",
        text=text, tags=["gateway"], weight=weight, createdAt="2026-01-01T00:00:00Z")


def test_feedback_roundtrip_lists_newest_and_removes(tmp_path: Path):
    store = FeedbackStore(tmp_path / "feedback"); store.save(feedback()); store.save(feedback("fb-2", "2026-01-02T00:00:00Z"))
    assert store.get("fb-1").candidates[0].statement == feedback().candidates[0].statement
    assert [x.id for x in store.list()] == ["fb-2", "fb-1"]
    assert store.remove("fb-1") and store.get("fb-1") is None


def test_learned_persists_reloads_and_removes(tmp_path: Path):
    path = tmp_path / "learned.json"; store = LearnedKnowledgeStore(path); store.add(learned())
    reloaded = LearnedKnowledgeStore(path).load()
    assert len(reloaded.list()) == 1 and reloaded.get("learned-c-1").text == learned().text
    assert reloaded.remove("learned-c-1") and not reloaded.remove("learned-c-1")
    assert LearnedKnowledgeStore(path).load().list() == []


def test_learned_normalizes_duplicates_reinforces_and_sorts(tmp_path: Path):
    store = LearnedKnowledgeStore(tmp_path / "learned.json"); store.add(learned("a")); store.add(learned("b", "قاعدهٔ دیگر", 3))
    assert store.find_by_text("  هر   مرحلهٔ تأیید باید مسیر رد داشته باشد  ").id == "a"
    source = LearnedSource(feedbackId="fb-2", sessionId="s-2", at="2026-01-03T00:00:00Z")
    assert store.reinforce("a", source).weight == 2
    assert [x.id for x in store.list()] == ["b", "a"]
    assert LearnedKnowledgeStore(store.path).load().get("a").sources == [source]


def test_learned_chunk_retrievable_and_removable():
    async def scenario():
        store = KnowledgeStore(); retriever = KnowledgeRetriever(store); entry = learned()
        await retriever.add_chunks([KnowledgeChunk(id=entry.id, docId="learned-from-feedback",
            docTitle="دانش آموخته", kind=entry.kind, text=entry.text, tags=entry.tags)])
        assert (await retriever.retrieve("مسیر رد مرحله تأیید", 2))[0].chunk.id == entry.id
        assert retriever.remove_chunk(entry.id) and not await retriever.retrieve("مسیر رد مرحله تأیید", 2)
    asyncio.run(scenario())


def test_feedback_extraction_returns_typed_points():
    llm = MockProvider({"FeedbackExtraction": {"points": [
        {"statement": "هر مرحلهٔ تأیید باید مسیر رد داشته باشد.", "rationale": "بازخورد ادمین",
         "kind": "bpmn_guideline", "tags": ["approval"], "generalizable": True},
        {"statement": "در این نمودار نقش مالی جا افتاده.", "generalizable": False},
    ]}})
    result = asyncio.run(run_feedback_extraction(AgentContext(llm=llm), Session.create("فرآیند مرخصی", "s-1"), "بازخورد"))
    assert len(result.points) == 2 and [x.kind for x in result.points if x.generalizable] == ["bpmn_guideline"]


def test_behavior_store_reinforces_updates_orders_and_limits(tmp_path: Path):
    path = tmp_path / "behavior.json"; store = BehaviorStore(path)
    for i in range(10):
        store.add(BehaviorEntry(id=str(i), agent="actors", instruction=f"rule {i}", weight=i,
            createdAt=f"2026-01-{i + 1:02d}T00:00:00Z"))
    source = LearnedSource(feedbackId="f", sessionId="s", at="2026-02-01T00:00:00Z")
    assert store.reinforce("1", source).weight == 2
    assert store.find_by_text("actors", "rule 1.").id == "1"
    assert len(store.instructions_for("actors")) == 8 and store.instructions_for("actors")[0] == "rule 9"
    assert store.update("1", instruction="updated").instruction == "updated"
    assert BehaviorStore(path).load().get("1").instruction == "updated"


def test_example_bank_similarity_and_persistence(tmp_path: Path):
    path = tmp_path / "examples.json"; store = ExampleStore(path)
    store.add(ExampleEntry(id="leave", sessionId="s1", request="درخواست مرخصی تحصیلی",
        processModel=process_model(), createdAt="2026-01-01T00:00:00Z"))
    store.add(ExampleEntry(id="order", sessionId="s2", request="ثبت سفارش و پرداخت",
        processModel=process_model(), createdAt="2026-01-02T00:00:00Z"))
    assert store.find_similar("مرخصی دانشجو", 1)[0].id == "leave"
    assert ExampleStore(path).load().get("order").request == "ثبت سفارش و پرداخت"


def test_all_existing_json_data_loads_and_sessions_roundtrip(tmp_path: Path):
    store = SessionStore(tmp_path / "sessions")
    sources = list(Path("data/sessions").glob("*.json"))
    assert sources
    for source in sources:
        original = json.loads(source.read_text(encoding="utf-8"))
        session = Session.model_validate(original); store.save(session)
        loaded = store.get(session.id)
        assert loaded and loaded.id == session.id and loaded.request == session.request
        assert loaded.model_dump(exclude_none=True).keys() >= original.keys()

    index_path = Path("data/knowledge-index.json")
    raw_chunks = json.loads(index_path.read_text(encoding="utf-8"))["chunks"]
    assert asyncio.run(KnowledgeStore.load(index_path)).size == len(raw_chunks)
    assert isinstance(LearnedKnowledgeStore(Path("data/learned-knowledge.json")).load().list(), list)
    assert isinstance(BehaviorStore(Path("data/behavior.json")).load().list(), list)
    assert isinstance(KnowledgeOverridesStore(Path("data/knowledge-overrides.json")).load().list(), list)
    assert not list(tmp_path.rglob("*.tmp"))
