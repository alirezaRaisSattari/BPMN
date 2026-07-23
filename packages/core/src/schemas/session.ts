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

/** A knowledge chunk that grounded the analysis (retrieval provenance). */
export const CitationSchema = z.object({
  chunkId: z.string(),
  docId: z.string(),
  docTitle: z.string(),
  kind: z.string(),
  /** Admin usefulness flag: true = helped, false = irrelevant, unset = unrated. */
  helpful: z.boolean().optional(),
});
export type Citation = z.infer<typeof CitationSchema>;

/** A question an admin asks the end user mid-review, and the user's answer. */
export const AdminQuestionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  answer: z.string().optional(),
  status: z.enum(["pending", "answered"]).default("pending"),
  createdAt: z.string(),
  answeredAt: z.string().optional(),
  /** Set once an admin has run extraction on the answer (avoids double-learning). */
  learnedFeedbackId: z.string().optional(),
});
export type AdminQuestion = z.infer<typeof AdminQuestionSchema>;

/** An admin-supplied corrected BPMN diagram for a session (before/after signal). */
export const BpmnCorrectionSchema = z.object({
  bpmnXml: z.string().min(1),
  note: z.string().default(""),
  at: z.string(),
  /** Set once an admin has mined knowledge from this correction (avoids double-learning). */
  learnedFeedbackId: z.string().optional(),
});
export type BpmnCorrection = z.infer<typeof BpmnCorrectionSchema>;

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

  /** Knowledge chunks retrieved while producing this session (deduped). */
  citations: z.array(CitationSchema).default([]),
  /** Questions the admin has posed to the user during review. */
  adminQuestions: z.array(AdminQuestionSchema).default([]),
  /** Admin's corrected BPMN, if any. */
  correction: BpmnCorrectionSchema.optional(),
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
