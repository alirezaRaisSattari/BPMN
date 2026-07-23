import { describe, it, expect } from "vitest";
import { MockProvider } from "../llm/mock.js";
import { newSession } from "../schemas/session.js";
import { KnowledgeStore } from "../knowledge/store.js";
import { KnowledgeRetriever } from "../knowledge/retriever.js";
import { Orchestrator } from "./orchestrator.js";

const readyFixtures = {
  ElicitationResult: {
    extractedRequirements: [{ category: "initiator", statement: "دانشجو آغازکننده است" }],
    questions: [],
    assistantMessage: "خلاصه فرآیند آماده است.",
    readyToModel: true,
  },
  ActorsResult: {
    roles: [
      { name: "دانشجو", type: "human" },
      { name: "سیستم", type: "system" },
    ],
  },
  RulesResult: { rules: [{ statement: "دانشجو نباید بدهی داشته باشد" }] },
  ImplicitResult: { implicitRules: [] },
  AmbiguityResult: { ambiguities: [] },
  ContradictionResult: { contradictions: [] },
  ProcessModel: {
    name: "ثبت‌نام دانشجو",
    lanes: [{ id: "lane_student", name: "دانشجو" }],
    startEvents: [{ id: "start_1", name: "شروع" }],
    endEvents: [{ id: "end_1", name: "پایان" }],
    activities: [{ id: "act_register", name: "ثبت درخواست", type: "userTask", lane: "lane_student" }],
    gateways: [],
    sequenceFlows: [
      { id: "f1", sourceRef: "start_1", targetRef: "act_register" },
      { id: "f2", sourceRef: "act_register", targetRef: "end_1" },
    ],
    dataObjects: [],
  },
};

describe("Orchestrator", () => {
  it("runs the full pipeline to a logical model when info is sufficient", async () => {
    const llm = new MockProvider(readyFixtures);
    const orch = new Orchestrator({ llm });
    const session = newSession("s1");

    const res = await orch.begin(session, "طراحی فرآیند ثبت‌نام دانشجو");

    expect(res.phase).toBe("done");
    expect(res.processModel).toBeDefined();
    expect(session.outputs.bpmnXml).toContain("bpmn:definitions");
    expect(session.outputs.document).toContain("مستند فرآیند");
    expect(res.awaitingUser).toBe(false);
    expect(session.roles.map((r) => r.name)).toContain("سیستم");
    expect(session.businessRules.some((r) => r.kind === "explicit")).toBe(true);
    expect(session.processModel?.activities.length).toBe(1);
  });

  it("records retrieval provenance (citations) from grounded phases", async () => {
    const llm = new MockProvider(readyFixtures);
    const store = new KnowledgeStore();
    await store.addChunks([
      {
        id: "g#0",
        docId: "bpmn-guidelines",
        docTitle: "BPMN Guidelines",
        kind: "bpmn_guideline",
        text: "هر فرآیند باید یک رویداد شروع و پایان داشته باشد و نقش‌ها و مراحل مشخص باشند.",
        embedding: [],
        tags: [],
      },
    ]);
    const retriever = new KnowledgeRetriever(store);
    const orch = new Orchestrator({ llm, retriever });
    const session = newSession("s-cite");

    await orch.begin(session, "طراحی فرآیند ثبت‌نام دانشجو");

    expect(session.citations.length).toBeGreaterThan(0);
    expect(session.citations[0]?.docId).toBe("bpmn-guidelines");
    // deduped by chunkId even though many phases retrieve
    const ids = session.citations.map((c) => c.chunkId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("asks clarifying questions when not ready and waits for the user", async () => {
    const llm = new MockProvider({
      ElicitationResult: {
        extractedRequirements: [],
        questions: [{ text: "آغازکنندهٔ فرآیند کیست؟", category: "initiator" }],
        assistantMessage: "برای شروع چند سؤال دارم:",
        readyToModel: false,
      },
    });
    const orch = new Orchestrator({ llm });
    const session = newSession("s2");

    const res = await orch.begin(session, "طراحی فرآیند مرخصی");

    expect(res.awaitingUser).toBe(true);
    expect(res.phase).toBe("elicitation");
    expect(session.openQuestions.length).toBe(1);
    expect(res.reply).toContain("آغازکننده");
  });

  it("proposes implicit rules and confirms them on user agreement", async () => {
    const llm = new MockProvider({
      ...readyFixtures,
      ImplicitResult: {
        implicitRules: [{ statement: "هر فرآیند شروع و پایان دارد", rationale: "اصل BPMN" }],
      },
    });
    const orch = new Orchestrator({ llm });
    const session = newSession("s3");

    const first = await orch.begin(session, "طراحی فرآیند خرید");
    expect(first.awaitingUser).toBe(true);
    expect(first.phase).toBe("implicit_knowledge");
    expect(session.businessRules.some((r) => r.kind === "implicit" && !r.confirmed)).toBe(true);

    const second = await orch.respond(session, "بله تایید می‌کنم");
    expect(session.businessRules.filter((r) => r.kind === "implicit").every((r) => r.confirmed)).toBe(true);
    expect(second.phase).toBe("done");
    expect(second.processModel).toBeDefined();
  });
});
