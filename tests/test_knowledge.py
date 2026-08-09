import asyncio
import sys
import types
from pathlib import Path

from bpmn_analyst.knowledge import (Bm25Index, KnowledgeRetriever, KnowledgeStore, build_knowledge,
                                    create_local_embedder,
                                    chunk_text, cosine_similarity, parse_doc, tokenize)
from bpmn_analyst.models import KnowledgeChunk


CHUNKS = [
    KnowledgeChunk(id="g#0", docId="g", docTitle="BPMN Guidelines", kind="bpmn_guideline",
        text="Every process must have exactly one start event and reach an end event."),
    KnowledgeChunk(id="v#0", docId="v", docTitle="Validation", kind="validation",
        text="Check that exclusive gateways cover the rejection path."),
]


def test_tokenizes_english_and_persian():
    assert tokenize("Hello, دنیا!") == ["hello", "دنیا"]


def test_bm25_ranks_relevant_doc_first():
    index = Bm25Index(); index.add("a", "leave request approval by manager"); index.add("b", "order registration and payment")
    assert index.search("who approves the leave request", 2)[0][0] == "a"


def test_parse_frontmatter():
    title, kind, tags, body = parse_doc("---\ntitle: T\nkind: validation\ntags: a, b\n---\nbody here", "fallback")
    assert (title, kind, tags, body.strip()) == ("T", "validation", ["a", "b"], "body here")


def test_chunk_by_paragraph_with_overlap():
    chunks = chunk_text("\n\n".join(["p" * 600, "q" * 600, "r" * 600]), 1000, 1)
    assert len(chunks) > 1 and chunks[1].startswith("p" * 20)


def test_retrieves_keyword_and_formats_context():
    async def scenario():
        store = KnowledgeStore(); await store.add_chunks(CHUNKS); retriever = KnowledgeRetriever(store)
        assert (await retriever.retrieve("what about the start and end event", 1))[0].chunk.docId == "g"
        assert "Validation" in await retriever.retrieve_context("rejection gateway", 1)
    asyncio.run(scenario())


def test_kind_filter_disable_enable_and_remove():
    async def scenario():
        store = KnowledgeStore(); await store.add_chunks(CHUNKS)
        filtered = await store.search("rejection", 5, lambda c: c.kind == "validation")
        assert filtered and all(x.chunk.kind == "validation" for x in filtered)
        assert store.disable("v#0") and not await store.search("rejection", 5)
        assert store.enable("v#0") and await store.search("rejection", 5)
        assert store.remove_chunk("v#0") and not await store.search("rejection", 5)
    asyncio.run(scenario())


def test_cosine_supports_shorter_shared_dimension():
    assert cosine_similarity([1, 0, 4], [1, 0]) == 1


def test_build_index_loads_existing_json_and_rebuilds_corrupt_cache(tmp_path: Path):
    knowledge = tmp_path / "knowledge"; knowledge.mkdir()
    (knowledge / "rules.md").write_text("---\ntitle: Rules\nkind: domain\n---\nقانون ثبت نام", encoding="utf-8")
    index = tmp_path / "index.json"
    first = asyncio.run(build_knowledge(knowledge, index))
    assert first.size == 1 and index.exists() and not index.with_suffix(".json.tmp").exists()
    assert asyncio.run(build_knowledge(knowledge, index)).size == 1
    index.write_text("{broken", encoding="utf-8")
    assert asyncio.run(build_knowledge(knowledge, index)).size == 1


def test_optional_local_embedder_adapter(monkeypatch):
    class Model:
        def __init__(self, name): self.name = name
        def encode(self, texts, normalize_embeddings):
            assert normalize_embeddings
            return [[1, 0] for _ in texts]
    monkeypatch.setitem(sys.modules, "sentence_transformers", types.SimpleNamespace(SentenceTransformer=Model))
    embedder = asyncio.run(create_local_embedder("mini"))
    assert embedder.name == "local:mini" and asyncio.run(embedder.embed(["x"])) == [[1.0, 0.0]]
