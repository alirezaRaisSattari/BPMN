import { describe, it, expect } from "vitest";
import { toBpmnXml } from "./generator.js";
import { generateBpmn } from "./layout.js";
import { validateModel } from "./validator.js";
import { ProcessModelSchema, type ProcessModel } from "../schemas/process-model.js";

const model: ProcessModel = ProcessModelSchema.parse({
  name: "درخواست مرخصی",
  lanes: [
    { id: "lane_emp", name: "کارمند" },
    { id: "lane_mgr", name: "مدیر" },
  ],
  startEvents: [{ id: "start_1", name: "شروع" }],
  endEvents: [
    { id: "end_ok", name: "تأیید شد" },
    { id: "end_no", name: "رد شد" },
  ],
  activities: [
    { id: "act_submit", name: "ثبت درخواست", type: "userTask", lane: "lane_emp" },
    { id: "act_review", name: "بررسی درخواست", type: "userTask", lane: "lane_mgr" },
  ],
  gateways: [{ id: "gw_decide", name: "تأیید؟", type: "exclusive" }],
  sequenceFlows: [
    { id: "f1", sourceRef: "start_1", targetRef: "act_submit" },
    { id: "f2", sourceRef: "act_submit", targetRef: "act_review" },
    { id: "f3", sourceRef: "act_review", targetRef: "gw_decide" },
    { id: "f4", sourceRef: "gw_decide", targetRef: "end_ok", condition: "approved" },
    { id: "f5", sourceRef: "gw_decide", targetRef: "end_no", condition: "rejected" },
  ],
  dataObjects: [{ id: "data_req", name: "فرم مرخصی" }],
});

describe("toBpmnXml", () => {
  it("emits valid BPMN 2.0 semantic elements", () => {
    const xml = toBpmnXml(model);
    expect(xml).toContain("<bpmn:process");
    expect(xml).toContain('<bpmn:userTask id="act_submit"');
    expect(xml).toContain('<bpmn:exclusiveGateway id="gw_decide"');
    expect(xml).toContain('sourceRef="gw_decide" targetRef="end_ok"');
    expect(xml).toContain("conditionExpression");
    expect(xml).toContain("نقش: مدیر");
  });
});

describe("generateBpmn (auto-layout)", () => {
  it("produces DI coordinates", async () => {
    const xml = await generateBpmn(model);
    expect(xml).toContain("BPMNDiagram");
    expect(xml).toContain("BPMNShape");
    expect(xml).toContain('bpmnElement="act_submit"');
  });
});

describe("validateModel", () => {
  it("passes a well-formed model", () => {
    const res = validateModel(model);
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });
  it("flags dangling flows and missing end", () => {
    const broken = ProcessModelSchema.parse({
      name: "خراب",
      startEvents: [{ id: "s1" }],
      endEvents: [{ id: "e1" }],
      activities: [{ id: "a1", name: "کار" }],
      sequenceFlows: [{ id: "f1", sourceRef: "s1", targetRef: "ghost" }],
    });
    const res = validateModel(broken);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("ghost") || e.includes("مقصد"))).toBe(true);
  });
});
