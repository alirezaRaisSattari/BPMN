from __future__ import annotations

import json
import math
import re
import warnings
from collections import Counter
from pathlib import Path
from typing import Callable, Protocol

from .models import KnowledgeChunk, RetrievalResult


def tokenize(text: str) -> list[str]:
    return [x for x in re.findall(r"[^\W_]+", text.lower(), re.UNICODE) if len(x) > 1]


class Embedder(Protocol):
    name: str
    dimension: int
    async def embed(self, texts: list[str]) -> list[list[float]]: ...


class LocalEmbedder:
    """Optional sentence-transformers adapter; BM25 remains dependency-free default."""
    dimension = 384

    def __init__(self, model: object, name: str): self.model, self.name = model, f"local:{name}"

    async def embed(self, texts: list[str]) -> list[list[float]]:
        import asyncio
        values = await asyncio.to_thread(self.model.encode, texts, normalize_embeddings=True)
        return [list(map(float, value)) for value in values]


async def create_local_embedder(model: str = "sentence-transformers/all-MiniLM-L6-v2") -> LocalEmbedder:
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError as exc:
        raise RuntimeError("Semantic embeddings requested but 'sentence-transformers' is not installed") from exc
    import asyncio
    return LocalEmbedder(await asyncio.to_thread(SentenceTransformer, model), model)


def cosine_similarity(a: list[float], b: list[float]) -> float:
    pairs = list(zip(a, b))
    denominator = math.sqrt(sum(x*x for x, _ in pairs)) * math.sqrt(sum(y*y for _, y in pairs))
    return sum(x*y for x, y in pairs) / denominator if denominator else 0


class Bm25Index:
    def __init__(self, k1: float = 1.5, b: float = .75):
        self.k1, self.b, self.docs, self.df, self.avg_len = k1, b, [], Counter(), 0.0
    def add(self, doc_id: str, text: str) -> None:
        tokens = tokenize(text); self.docs.append((doc_id, tokens)); self.df.update(set(tokens))
        self.avg_len = sum(len(x[1]) for x in self.docs) / len(self.docs)
    def search(self, query: str, k: int) -> list[tuple[str, float]]:
        n_docs = len(self.docs); scored = []
        for doc_id, tokens in self.docs:
            tf = Counter(tokens); score = 0.0
            for term in tokenize(query):
                frequency = tf[term]
                if not frequency: continue
                idf = math.log(1 + (n_docs - self.df[term] + .5) / (self.df[term] + .5))
                denominator = frequency + self.k1 * (1 - self.b + self.b * len(tokens) / (self.avg_len or 1))
                score += idf * frequency * (self.k1 + 1) / denominator
            if score > 0: scored.append((doc_id, score))
        return sorted(scored, key=lambda x: x[1], reverse=True)[:k]


class KnowledgeStore:
    def __init__(self, embedder: Embedder | None = None):
        self.embedder = embedder; self.chunks: list[KnowledgeChunk] = []; self.by_id = {}; self.disabled: set[str] = set(); self.bm25 = Bm25Index()
    @property
    def size(self) -> int: return len(self.chunks)
    async def add_chunks(self, chunks: list[KnowledgeChunk]) -> None:
        pending = [x for x in chunks if not x.embedding]
        if self.embedder and pending:
            try:
                vectors = await self.embedder.embed([x.text for x in pending])
                for chunk, vector in zip(pending, vectors): chunk.embedding = vector
            except Exception: pass
        for chunk in chunks:
            old = self.by_id.get(chunk.id)
            if old: self.remove_chunk(chunk.id)
            self.chunks.append(chunk); self.by_id[chunk.id] = chunk; self.bm25.add(chunk.id, f"{chunk.docTitle}\n{chunk.text}")
    def remove_chunk(self, chunk_id: str) -> bool:
        if chunk_id not in self.by_id: return False
        self.chunks = [x for x in self.chunks if x.id != chunk_id]; self.by_id.pop(chunk_id); self.disabled.discard(chunk_id)
        self.bm25 = Bm25Index()
        for chunk in self.chunks: self.bm25.add(chunk.id, f"{chunk.docTitle}\n{chunk.text}")
        return True
    def disable(self, chunk_id: str) -> bool:
        if chunk_id not in self.by_id: return False
        self.disabled.add(chunk_id); return True
    def enable(self, chunk_id: str) -> bool:
        existed = chunk_id in self.disabled; self.disabled.discard(chunk_id); return existed
    def is_disabled(self, chunk_id: str) -> bool: return chunk_id in self.disabled
    async def search(self, query: str, k: int = 4, predicate: Callable[[KnowledgeChunk], bool] | None = None) -> list[RetrievalResult]:
        admit = lambda c: c.id not in self.disabled and (predicate(c) if predicate else True)
        pool = [x for x in self.chunks if admit(x)]
        if self.embedder and any(x.embedding for x in pool):
            try:
                vector = (await self.embedder.embed([query]))[0]
                return [RetrievalResult(chunk=x, score=cosine_similarity(vector, x.embedding)) for x in sorted(
                    (c for c in pool if c.embedding), key=lambda c: cosine_similarity(vector, c.embedding), reverse=True)[:k]]
            except Exception: pass
        results = []
        for chunk_id, score in self.bm25.search(query, k * 3):
            chunk = self.by_id.get(chunk_id)
            if chunk and admit(chunk): results.append(RetrievalResult(chunk=chunk, score=score))
            if len(results) >= k: break
        return results
    def to_array(self) -> list[KnowledgeChunk]: return list(self.chunks)
    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True); _atomic_json(path, {"chunks": [x.model_dump() for x in self.chunks]})
    @classmethod
    async def load(cls, path: Path, embedder: Embedder | None = None) -> "KnowledgeStore":
        store = cls(embedder)
        data = json.loads(path.read_text(encoding="utf-8")); await store.add_chunks([KnowledgeChunk.model_validate(x) for x in data.get("chunks", [])]); return store


class KnowledgeRetriever:
    def __init__(self, store: KnowledgeStore): self.store = store
    @property
    def size(self) -> int: return self.store.size
    async def add_chunks(self, chunks: list[KnowledgeChunk]) -> None: await self.store.add_chunks(chunks)
    def remove_chunk(self, chunk_id: str) -> bool: return self.store.remove_chunk(chunk_id)
    def all_chunks(self) -> list[KnowledgeChunk]: return self.store.to_array()
    def disable(self, chunk_id: str) -> bool: return self.store.disable(chunk_id)
    def enable(self, chunk_id: str) -> bool: return self.store.enable(chunk_id)
    def is_disabled(self, chunk_id: str) -> bool: return self.store.is_disabled(chunk_id)
    async def retrieve(self, query: str, k: int = 4, predicate: Callable[[KnowledgeChunk], bool] | None = None) -> list[RetrievalResult]:
        return await self.store.search(query, k, predicate) if self.store.size else []
    async def retrieve_context(self, query: str, k: int = 4, predicate: Callable[[KnowledgeChunk], bool] | None = None) -> str:
        return format_context(await self.retrieve(query, k, predicate))


def format_context(results: list[RetrievalResult]) -> str:
    return "\n\n---\n\n".join(f"[{i}] ({r.chunk.kind}) {r.chunk.docTitle}\n{r.chunk.text}" for i, r in enumerate(results, 1))


def parse_doc(raw: str, fallback_title: str) -> tuple[str, str, list[str], str]:
    title, kind, tags, body = fallback_title, "other", [], raw
    match = re.match(r"^---\s*\n([\s\S]*?)\n---\s*\n?", raw)
    if match:
        body = raw[len(match.group(0)):]
        for line in match.group(1).splitlines():
            item = re.match(r"^\s*([A-Za-z_]+)\s*:\s*(.+?)\s*$", line)
            if not item: continue
            key, value = item.group(1).lower(), item.group(2).strip()
            if key == "title": title = value
            elif key == "kind" and value in {"bpmn_guideline", "validation", "domain", "glossary", "other"}: kind = value
            elif key == "tags": tags = [x.strip() for x in value.split(",") if x.strip()]
    return title, kind, tags, body


def chunk_text(body: str, chunk_size: int = 1000, overlap: int = 1) -> list[str]:
    paragraphs = [x.strip() for x in re.split(r"\n\s*\n", body) if x.strip()]
    chunks, current, size = [], [], 0
    for paragraph in paragraphs:
        if size and size + len(paragraph) > chunk_size:
            chunks.append("\n\n".join(current)); current = current[-overlap:] if overlap else []; size = sum(map(len, current))
        current.append(paragraph); size += len(paragraph)
    if current: chunks.append("\n\n".join(current))
    return chunks


async def build_knowledge(directory: Path, index_path: Path, rebuild: bool = False,
                          use_embeddings: bool = False) -> KnowledgeRetriever:
    embedder = None
    if use_embeddings:
        try: embedder = await create_local_embedder()
        except Exception as exc: warnings.warn(f"knowledge embeddings disabled: {exc}", stacklevel=2)
    if index_path.exists() and not rebuild:
        try: return KnowledgeRetriever(await KnowledgeStore.load(index_path, embedder))
        except Exception: pass
    store = KnowledgeStore(embedder)
    for path in sorted(directory.iterdir()) if directory.exists() else []:
        if path.suffix.lower() not in {".md", ".txt", ".markdown"}: continue
        title, kind, tags, body = parse_doc(path.read_text(encoding="utf-8"), path.stem)
        await store.add_chunks([KnowledgeChunk(id=f"{path.stem}#{i}", docId=path.stem, docTitle=title,
            kind=kind, text=text, tags=tags) for i, text in enumerate(chunk_text(body))])
    if store.size: store.save(index_path)
    return KnowledgeRetriever(store)


def _atomic_json(path: Path, data: object) -> None:
    temp = path.with_suffix(path.suffix + ".tmp"); temp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"); temp.replace(path)
