import { z } from "zod";
import {
  RoleSchema,
  RequirementSchema,
  BusinessRuleSchema,
  AmbiguitySchema,
  ContradictionSchema,
  QuestionSchema,
} from "./analysis.js";
import { ProcessModelSchema } from "./process-model.js";

/** Ordered phases of the business-analysis pipeline. */
export const phases = [
  "intake",
  "elicitation",
  "actors",
  "business_rules",
  "implicit_knowledge",
  "ambiguity",
  "contradiction",
  "logical_model",
  "bpmn_generation",
  "outputs",
  "done",
] as const;
export const PhaseSchema = z.enum(phases);
export type Phase = z.infer<typeof PhaseSchema>;

export const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  at: z.string(), // ISO timestamp
  phase: PhaseSchema.optional(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const OutputsSchema = z.object({
  bpmnXml: z.string().optional(),
  diagramSvg: z.string().optional(),
  summary: z.string().optional(),
  document: z.string().optional(), // final Markdown document
});
export type Outputs = z.infer<typeof OutputsSchema>;

export const SessionStateSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  request: z.string().default(""),
  phase: PhaseSchema.default("intake"),
  messages: z.array(ChatMessageSchema).default([]),

  requirements: z.array(RequirementSchema).default([]),
  roles: z.array(RoleSchema).default([]),
  businessRules: z.array(BusinessRuleSchema).default([]),
  ambiguities: z.array(AmbiguitySchema).default([]),
  contradictions: z.array(ContradictionSchema).default([]),
  openQuestions: z.array(QuestionSchema).default([]),

  processModel: ProcessModelSchema.optional(),
  outputs: OutputsSchema.default({}),
});
export type SessionState = z.infer<typeof SessionStateSchema>;

/** Create an empty session. */
export function newSession(id: string, request = ""): SessionState {
  const now = new Date().toISOString();
  return SessionStateSchema.parse({
    id,
    createdAt: now,
    updatedAt: now,
    request,
    phase: "intake",
  });
}
