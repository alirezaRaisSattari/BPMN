import { z } from "zod";

/**
 * The *logical* process model — an abstract, tool-independent representation of a
 * business process. It is later compiled into standard BPMN 2.0 XML.
 */

export const idRegex = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const Id = z.string().regex(idRegex, "id must be a valid BPMN identifier");

export const LaneSchema = z.object({
  id: Id,
  name: z.string().min(1),
  roleId: z.string().optional(),
});
export type Lane = z.infer<typeof LaneSchema>;

export const StartEventSchema = z.object({
  id: Id,
  name: z.string().default("Start"),
  type: z.enum(["none", "message", "timer", "conditional"]).default("none"),
  lane: z.string().optional(),
});
export type StartEvent = z.infer<typeof StartEventSchema>;

export const EndEventSchema = z.object({
  id: Id,
  name: z.string().default("End"),
  type: z.enum(["none", "message", "error", "terminate"]).default("none"),
  lane: z.string().optional(),
});
export type EndEvent = z.infer<typeof EndEventSchema>;

export const IntermediateEventSchema = z.object({
  id: Id,
  name: z.string().min(1),
  type: z.enum(["message", "timer", "error", "signal"]).default("message"),
  throwing: z.boolean().default(false),
  lane: z.string().optional(),
});
export type IntermediateEvent = z.infer<typeof IntermediateEventSchema>;

export const ActivitySchema = z.object({
  id: Id,
  name: z.string().min(1),
  /** userTask = done by a human; serviceTask = done by the system. */
  type: z
    .enum(["task", "userTask", "serviceTask", "manualTask", "scriptTask", "businessRuleTask"])
    .default("task"),
  lane: z.string().optional(),
  inputs: z.array(z.string()).default([]),
  outputs: z.array(z.string()).default([]),
});
export type Activity = z.infer<typeof ActivitySchema>;

export const GatewaySchema = z.object({
  id: Id,
  name: z.string().optional(),
  type: z.enum(["exclusive", "parallel", "inclusive", "eventBased"]).default("exclusive"),
  lane: z.string().optional(),
});
export type Gateway = z.infer<typeof GatewaySchema>;

export const SequenceFlowSchema = z.object({
  id: Id,
  sourceRef: z.string(),
  targetRef: z.string(),
  name: z.string().optional(),
  /** Human-readable guard condition, e.g. "amount > limit". */
  condition: z.string().optional(),
});
export type SequenceFlow = z.infer<typeof SequenceFlowSchema>;

export const DataObjectSchema = z.object({
  id: Id,
  name: z.string().min(1),
});
export type DataObject = z.infer<typeof DataObjectSchema>;

export const ProcessModelSchema = z.object({
  name: z.string().min(1),
  lanes: z.array(LaneSchema).default([]),
  startEvents: z.array(StartEventSchema).min(1),
  endEvents: z.array(EndEventSchema).min(1),
  intermediateEvents: z.array(IntermediateEventSchema).default([]),
  activities: z.array(ActivitySchema).default([]),
  gateways: z.array(GatewaySchema).default([]),
  sequenceFlows: z.array(SequenceFlowSchema).default([]),
  dataObjects: z.array(DataObjectSchema).default([]),
});
export type ProcessModel = z.infer<typeof ProcessModelSchema>;
