import type { ProcessModel } from "../schemas/process-model.js";

const NS = [
  'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"',
  'xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"',
  'xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"',
  'xmlns:di="http://www.omg.org/spec/DD/20100524/DI"',
].join(" ");

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const ACTIVITY_TAG: Record<string, string> = {
  task: "task",
  userTask: "userTask",
  serviceTask: "serviceTask",
  manualTask: "manualTask",
  scriptTask: "scriptTask",
  businessRuleTask: "businessRuleTask",
};

const GATEWAY_TAG: Record<string, string> = {
  exclusive: "exclusiveGateway",
  parallel: "parallelGateway",
  inclusive: "inclusiveGateway",
  eventBased: "eventBasedGateway",
};

function eventDefinition(type: string): string {
  switch (type) {
    case "message":
      return "<bpmn:messageEventDefinition/>";
    case "timer":
      return "<bpmn:timerEventDefinition/>";
    case "error":
      return "<bpmn:errorEventDefinition/>";
    case "terminate":
      return "<bpmn:terminateEventDefinition/>";
    case "conditional":
      return "<bpmn:conditionalEventDefinition/>";
    case "signal":
      return "<bpmn:signalEventDefinition/>";
    default:
      return "";
  }
}

/**
 * Compile a logical ProcessModel into standard BPMN 2.0 semantic XML (no DI).
 * Roles are recorded as flow-node documentation (lane swimlane rendering is a
 * future enhancement; auto-layout does not position lanes reliably).
 */
export function toBpmnXml(model: ProcessModel): string {
  const roleByNode = new Map<string, string>();
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, key: string, val: string): void => {
    const arr = m.get(key);
    if (arr) arr.push(val);
    else m.set(key, [val]);
  };
  for (const f of model.sequenceFlows) {
    push(outgoing, f.sourceRef, f.id);
    push(incoming, f.targetRef, f.id);
  }

  const refs = (id: string): string =>
    [
      ...(incoming.get(id) ?? []).map((f) => `<bpmn:incoming>${f}</bpmn:incoming>`),
      ...(outgoing.get(id) ?? []).map((f) => `<bpmn:outgoing>${f}</bpmn:outgoing>`),
    ].join("");

  const doc = (id: string): string => {
    const role = roleByNode.get(id);
    return role ? `<bpmn:documentation>نقش: ${esc(role)}</bpmn:documentation>` : "";
  };

  for (const a of model.activities) if (a.lane) roleByNode.set(a.id, laneName(model, a.lane));

  const parts: string[] = [];

  for (const e of model.startEvents) {
    parts.push(
      `<bpmn:startEvent id="${e.id}" name="${esc(e.name)}">${refs(e.id)}${eventDefinition(e.type)}</bpmn:startEvent>`,
    );
  }
  for (const a of model.activities) {
    const tag = ACTIVITY_TAG[a.type] ?? "task";
    parts.push(
      `<bpmn:${tag} id="${a.id}" name="${esc(a.name)}">${doc(a.id)}${refs(a.id)}</bpmn:${tag}>`,
    );
  }
  for (const g of model.gateways) {
    const tag = GATEWAY_TAG[g.type] ?? "exclusiveGateway";
    const name = g.name ? ` name="${esc(g.name)}"` : "";
    parts.push(`<bpmn:${tag} id="${g.id}"${name}>${refs(g.id)}</bpmn:${tag}>`);
  }
  for (const e of model.intermediateEvents) {
    const tag = e.throwing ? "intermediateThrowEvent" : "intermediateCatchEvent";
    parts.push(
      `<bpmn:${tag} id="${e.id}" name="${esc(e.name)}">${refs(e.id)}${eventDefinition(e.type)}</bpmn:${tag}>`,
    );
  }
  for (const e of model.endEvents) {
    parts.push(
      `<bpmn:endEvent id="${e.id}" name="${esc(e.name)}">${refs(e.id)}${eventDefinition(e.type)}</bpmn:endEvent>`,
    );
  }
  for (const f of model.sequenceFlows) {
    const name = f.name ? ` name="${esc(f.name)}"` : "";
    const cond = f.condition
      ? `<bpmn:conditionExpression xsi:type="bpmn:tFormalExpression" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${esc(
          f.condition,
        )}</bpmn:conditionExpression>`
      : "";
    parts.push(
      `<bpmn:sequenceFlow id="${f.id}" sourceRef="${f.sourceRef}" targetRef="${f.targetRef}"${name}>${cond}</bpmn:sequenceFlow>`,
    );
  }
  for (const d of model.dataObjects) {
    parts.push(`<bpmn:dataObject id="${d.id}" name="${esc(d.name)}"/>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${NS} id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" name="${esc(model.name)}" isExecutable="false">
    ${parts.join("\n    ")}
  </bpmn:process>
</bpmn:definitions>`;
}

function laneName(model: ProcessModel, laneId: string): string {
  return model.lanes.find((l) => l.id === laneId)?.name ?? laneId;
}
