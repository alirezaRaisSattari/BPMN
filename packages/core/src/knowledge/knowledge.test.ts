import { describe, it, expect } from "vitest";
import { tokenize, Bm25Index } from "./bm25.js";
import { parseDoc, chunkText } from "./ingest.js";
import { KnowledgeStore } from "./store.js";
import { KnowledgeRetriever } from "./retriever.js";
import type { KnowledgeChunk } from "../schemas/knowledge.js";

describe("bm25", () => {
  it("tokenizes english and persian", () => {
    expect(tokenize("Hello, دنیا!")).toEqual(["hello", "دنیا"]);
  });
  it("ranks the relevant doc first", () => {
    const idx = new Bm25Index();
    idx.add("a", "leave request approval by manager");
    idx.add("b", "order registration and payment");
    const [top] = idx.search("who approves the leave request", 2);
    expect(top?.id).toBe("a");
  });
});

describe("ingest", () => {
  it("parses frontmatter", () => {
    const doc = parseDoc("---\ntitle: T\nkind: validation\ntags: a, b\n---\nbody here", "fallback");
    expect(doc.title).toBe("T");
    expect(doc.kind).toBe("validation");
    expect(doc.tags).toEqual(["a", "b"]);
    expect(doc.body.trim()).toBe("body here");
  });
  it("chunks by paragraph within size", () => {
    const body = ["p".repeat(600), "q".repeat(600), "r".repeat(600)].join("\n\n");
    const chunks = chunkText(body, 1000, 1);
    expect(chunks.length).toBeGreaterThan(1);
  });
});

describe("KnowledgeStore + Retriever", () => {
  const chunks: KnowledgeChunk[] = [
    {
      id: "g#0",
      docId: "g",
      docTitle: "BPMN Guidelines",
      kind: "bpmn_guideline",
      text: "Every process must have exactly one start event and reach an end event.",
      embedding: [],
      tags: [],
    },
    {
      id: "v#0",
      docId: "v",
      docTitle: "Validation",
      kind: "validation",
      text: "Check that exclusive gateways cover the rejection path.",
      embedding: [],
      tags: [],
    },
  ];

  it("retrieves by keyword and formats context", async () => {
    const store = new KnowledgeStore();
    await store.addChunks(chunks);
    const retriever = new KnowledgeRetriever(store);
    const results = await retriever.retrieve("what about the start and end event", 1);
    expect(results[0]?.chunk.docId).toBe("g");
    const ctx = await retriever.retrieveContext("rejection gateway", 1);
    expect(ctx).toContain("Validation");
  });

  it("supports kind filter", async () => {
    const store = new KnowledgeStore();
    await store.addChunks(chunks);
    const results = await store.search("gateway", 5, (c) => c.kind === "validation");
    expect(results.every((r) => r.chunk.kind === "validation")).toBe(true);
  });
});
