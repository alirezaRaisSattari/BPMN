import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MockProvider } from "../llm/mock.js";
import { KnowledgeStore } from "../knowledge/store.js";
import { KnowledgeRetriever } from "../knowledge/retriever.js";
import { LearnedKnowledgeStore, learnedToChunk } from "../knowledge/learned.js";
import { runFeedbackExtraction } from "../agents/feedback-extractor.js";
import { newSession } from "../schemas/session.js";
import type { AdminFeedback, LearnedEntry } from "../schemas/feedback.js";
import { FileFeedbackStore } from "./feedback-store.js";

const tmpDirs: string[] = [];
async function tmp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bpmn-feedback-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

function sampleFeedback(): AdminFeedback {
  return {
    id: "fb-1",
    sessionId: "s-1",
    sessionRequest: "فرآیند مرخصی تحصیلی",
    text: "مسیر رد درخواست مدل نشده بود.",
    createdAt: new Date().toISOString(),
    candidates: [
      {
        id: "c-1",
        statement: "هر مرحلهٔ تأیید باید مسیر رد داشته باشد.",
        rationale: "الگوی رایج",
        kind: "bpmn_guideline",
        tags: ["gateway"],
        status: "pending",
        similar: [],
        createdAt: new Date().toISOString(),
      },
    ],
  };
}

describe("FileFeedbackStore", () => {
  it("round-trips feedback with candidates and lists newest first", async () => {
    const store = new FileFeedbackStore(await tmp());
    const a = sampleFeedback();
    const b = { ...sampleFeedback(), id: "fb-2", createdAt: new Date(Date.now() + 1000).toISOString() };
    await store.save(a);
    await store.save(b);

    const got = await store.get("fb-1");
    expect(got?.candidates[0]?.statement).toBe(a.candidates[0]!.statement);

    const list = await store.list();
    expect(list.map((f) => f.id)).toEqual(["fb-2", "fb-1"]);

    expect(await store.remove("fb-1")).toBe(true);
    expect(await store.get("fb-1")).toBeUndefined();
  });
});

describe("LearnedKnowledgeStore", () => {
  const entry: LearnedEntry = {
    id: "learned-c-1",
    feedbackId: "fb-1",
    sessionId: "s-1",
    kind: "bpmn_guideline",
    text: "هر مرحلهٔ تأیید باید مسیر رد داشته باشد.",
    tags: ["gateway"],
    createdAt: new Date().toISOString(),
  };

  it("persists entries and reloads them", async () => {
    const path = join(await tmp(), "learned.json");
    const store = new LearnedKnowledgeStore(path);
    await store.add(entry);

    const reloaded = await LearnedKnowledgeStore.load(path);
    expect(reloaded.list()).toHaveLength(1);
    expect(reloaded.get("learned-c-1")?.text).toBe(entry.text);

    expect(await reloaded.remove("learned-c-1")).toBe(true);
    expect(await reloaded.remove("learned-c-1")).toBe(false);
    expect((await LearnedKnowledgeStore.load(path)).list()).toHaveLength(0);
  });

  it("finds duplicates by normalized text and reinforces weight", async () => {
    const path = join(await tmp(), "learned.json");
    const store = new LearnedKnowledgeStore(path);
    await store.add(entry);

    // normalized match ignores trailing punctuation, case and extra spaces
    const dup = store.findByText("هر مرحلهٔ تأیید باید مسیر رد داشته باشد");
    expect(dup?.id).toBe("learned-c-1");

    const updated = await store.reinforce("learned-c-1", {
      feedbackId: "fb-2",
      sessionId: "s-2",
      at: new Date().toISOString(),
    });
    expect(updated?.weight).toBe(2);
    expect(updated?.sources).toHaveLength(1);

    // persisted
    const reloaded = await LearnedKnowledgeStore.load(path);
    expect(reloaded.get("learned-c-1")?.weight).toBe(2);
  });

  it("sorts entries by weight (most-reinforced first)", async () => {
    const store = new LearnedKnowledgeStore(join(await tmp(), "learned.json"));
    await store.add({ ...entry, id: "a", weight: 1 });
    await store.add({ ...entry, id: "b", text: "قاعدهٔ دیگر", weight: 3 });
    expect(store.list().map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("learned chunks are retrievable and removable in the live index", async () => {
    const knowledge = new KnowledgeStore();
    const retriever = new KnowledgeRetriever(knowledge);
    await retriever.addChunks([learnedToChunk(entry)]);

    let results = await retriever.retrieve("مسیر رد مرحله تأیید", 2);
    expect(results[0]?.chunk.id).toBe("learned-c-1");

    expect(retriever.removeChunk("learned-c-1")).toBe(true);
    results = await retriever.retrieve("مسیر رد مرحله تأیید", 2);
    expect(results).toHaveLength(0);
  });
});

describe("runFeedbackExtraction", () => {
  it("returns schema-valid points from the LLM", async () => {
    const llm = new MockProvider({
      FeedbackExtraction: {
        points: [
          {
            statement: "هر مرحلهٔ تأیید باید مسیر رد داشته باشد.",
            rationale: "بازخورد ادمین",
            kind: "bpmn_guideline",
            tags: ["approval"],
            generalizable: true,
          },
          { statement: "در این نمودار نقش مالی جا افتاده.", generalizable: false },
        ],
      },
    });
    const session = newSession("s-1", "فرآیند مرخصی تحصیلی");
    const result = await runFeedbackExtraction({ llm }, session, "بازخورد");
    expect(result.points).toHaveLength(2);
    const general = result.points.filter((p) => p.generalizable);
    expect(general).toHaveLength(1);
    expect(general[0]!.kind).toBe("bpmn_guideline");
  });
});
