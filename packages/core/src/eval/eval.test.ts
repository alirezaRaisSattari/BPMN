import { describe, expect, it } from "vitest";
import { newSession, type SessionState } from "../schemas/session.js";
import type { EvalCase } from "../schemas/eval.js";
import type { ProcessModel } from "../schemas/process-model.js";
import { runEvalCase } from "./runner.js";

/** A minimal valid model: start → task → end, plus an exclusive reject branch. */
function model(): ProcessModel {
  return {
    name: "P",
    lanes: [],
    startEvents: [{ id: "s1", name: "Start", type: "none" }],
    endEvents: [
      { id: "e1", name: "End", type: "none" },
      { id: "e2", name: "Rejected", type: "none" },
    ],
    intermediateEvents: [],
    activities: [{ id: "a1", name: "بررسی", type: "userTask", inputs: [], outputs: [] }],
    gateways: [{ id: "g1", name: "تصمیم", type: "exclusive" }],
    sequenceFlows: [
      { id: "f1", sourceRef: "s1", targetRef: "a1" },
      { id: "f2", sourceRef: "a1", targetRef: "g1" },
      { id: "f3", sourceRef: "g1", targetRef: "e1", name: "تأیید", condition: "approved" },
      { id: "f4", sourceRef: "g1", targetRef: "e2", name: "رد", condition: "rejected" },
    ],
    dataObjects: [],
  };
}

function session(): SessionState {
  const s = newSession("s-1", "فرآیند نمونه");
  s.roles = [{ id: "r1", name: "دانشجو", type: "human" }];
  s.processModel = model();
  return s;
}

function evalCase(expected: Partial<EvalCase["expected"]>): EvalCase {
  return {
    id: "case-1",
    sessionId: "s-1",
    request: "فرآیند نمونه",
    note: "",
    expected: {
      bpmnValid: true,
      minRoles: 0,
      minActivities: 0,
      mustHaveRejectionPath: false,
      expectedRoles: [],
      ...expected,
    },
    createdAt: new Date().toISOString(),
  };
}

describe("runEvalCase", () => {
  it("passes a valid model with a rejection path and expected role", async () => {
    const res = await runEvalCase(
      evalCase({ minRoles: 1, minActivities: 1, mustHaveRejectionPath: true, expectedRoles: ["دانشجو"] }),
      session(),
    );
    expect(res.passed).toBe(true);
    expect(res.checks.every((c) => c.passed)).toBe(true);
  });

  it("fails when a required rejection path is absent", async () => {
    const s = session();
    // drop the reject branch
    s.processModel!.sequenceFlows = s.processModel!.sequenceFlows.filter((f) => f.id !== "f4");
    const res = await runEvalCase(evalCase({ mustHaveRejectionPath: true }), s);
    expect(res.passed).toBe(false);
    expect(res.checks.find((c) => c.label.includes("رد"))?.passed).toBe(false);
  });

  it("fails when an expected role is missing", async () => {
    const res = await runEvalCase(evalCase({ expectedRoles: ["مدیر گروه"] }), session());
    expect(res.passed).toBe(false);
  });

  it("reports missing process model gracefully", async () => {
    const s = newSession("s-1", "x");
    const res = await runEvalCase(evalCase({}), s);
    expect(res.passed).toBe(false);
    expect(res.error).toBe("no process model");
  });
});
