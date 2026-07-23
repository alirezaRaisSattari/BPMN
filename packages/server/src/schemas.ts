import { z } from "zod";
import {
  knowledgeKinds,
  behaviorAgents,
  SessionStateSchema,
  AdminQuestionSchema,
  BpmnCorrectionSchema,
  CitationSchema,
  AdminFeedbackSchema,
  LearnedEntrySchema,
  ExampleEntrySchema,
  BehaviorEntrySchema,
  EvalCaseSchema,
  EvalResultSchema,
  EvalExpectationSchema,
} from "@bpmn-analyst/core";

/**
 * Request/response shapes for the HTTP API. Bodies and params are wired into
 * Fastify route `schema` for runtime validation (via fastify-type-provider-zod);
 * response schemas are for compile-time typing only (not runtime-serialized).
 */

// ---- shared building blocks ------------------------------------------------

/** Trimmed, non-empty string — the common shape for required text fields. */
const requiredText = (label: string) =>
  z.string().trim().min(1, `${label} is required`);

/** Trimmed string that defaults to "" when omitted. */
const optionalText = () => z.string().trim().default("");

const errorResponse = z.object({ error: z.string() });
export type ErrorResponse = z.infer<typeof errorResponse>;

const okResponse = z.object({ ok: z.literal(true) });
export type OkResponse = z.infer<typeof okResponse>;

// ---- shared path params ----------------------------------------------------

export const IdParams = z.object({ id: requiredText("id") });
export const SessionQidParams = z.object({
  id: requiredText("id"),
  qid: requiredText("qid"),
});
export const FeedbackCandidateParams = z.object({
  fid: requiredText("fid"),
  cid: requiredText("cid"),
});
export const SessionChunkParams = z.object({
  id: requiredText("id"),
  chunkId: requiredText("chunkId"),
});

// ---- session routes (routes.ts) -------------------------------------------

export const CreateSessionBody = z.object({ request: requiredText("request") });
export const MessageBody = z.object({ message: requiredText("message") });
export const AnswerBody = z.object({ answer: requiredText("answer") });

const TurnResponse = z.object({
  reply: z.string(),
  awaitingUser: z.boolean(),
  session: SessionStateSchema,
});
export type TurnResponse = z.infer<typeof TurnResponse>;

const SessionSummarySchema = z.object({
  id: z.string(),
  request: z.string(),
  phase: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  messageCount: z.number(),
});
export type SessionListResponse = { sessions: z.infer<typeof SessionSummarySchema>[] };
export type SessionResponse = { session: z.infer<typeof SessionStateSchema> };
export type AnswerResponse = { question: z.infer<typeof AdminQuestionSchema> };

// ---- admin routes (admin-routes.ts) ----------------------------------------

export const FeedbackBody = z.object({ text: requiredText("text") });

export const AcceptCandidateBody = z.object({
  statement: z.string().trim().optional(),
  kind: z.enum(knowledgeKinds).optional(),
  tags: z.array(z.string()).optional(),
  destination: z.enum(["knowledge", "behavior"]).optional(),
  agent: z.string().optional(),
});

export const QuestionBody = z.object({ question: requiredText("question") });

export const CorrectionBody = z.object({
  bpmnXml: requiredText("bpmnXml").refine(
    (xml) => /<\s*(bpmn:)?definitions[\s>]/i.test(xml),
    { message: "does not look like BPMN XML (<definitions> missing)" },
  ),
  note: optionalText(),
});

export const ManualLearnedBody = z.object({
  statement: requiredText("statement"),
  kind: z.enum(knowledgeKinds).default("other"),
  tags: z.array(z.string()).default([]),
});

export const LearnedPatchBody = z.object({
  text: z.string().trim().min(1, "text must not be empty").optional(),
  kind: z.enum(knowledgeKinds).optional(),
  tags: z.array(z.string()).optional(),
});

export const FlagBody = z.object({ helpful: z.boolean().nullable().optional() });

export const ExampleBody = z.object({
  sessionId: requiredText("sessionId"),
  note: optionalText(),
});

export const BehaviorBody = z.object({
  agent: z.enum(behaviorAgents),
  instruction: requiredText("instruction"),
});

export const BehaviorPatchBody = z.object({
  agent: z.enum(behaviorAgents).optional(),
  instruction: z.string().trim().min(1, "instruction must not be empty").optional(),
});

export const EvalBody = z.object({
  sessionId: requiredText("sessionId"),
  note: z.string().trim().optional(),
  expected: EvalExpectationSchema.partial().optional(),
});

// ---- admin response types (typing only) ------------------------------------

export type FeedbackListResponse = { feedback: z.infer<typeof AdminFeedbackSchema>[] };
export type FeedbackResponse = { feedback: z.infer<typeof AdminFeedbackSchema> };
export type AcceptCandidateResponse = {
  feedback: z.infer<typeof AdminFeedbackSchema>;
  entry?: z.infer<typeof LearnedEntrySchema>;
  behavior?: z.infer<typeof BehaviorEntrySchema>;
  reinforced: boolean;
};

const LearnedEntryWithUsage = LearnedEntrySchema.extend({ usageCount: z.number() });
export type LearnedListResponse = { entries: z.infer<typeof LearnedEntryWithUsage>[] };
export type LearnedEntryResponse = {
  entry: z.infer<typeof LearnedEntrySchema>;
  reinforced: boolean;
};
export type LearnedPatchResponse = { entry: z.infer<typeof LearnedEntrySchema> };

const KnowledgeChunkInfoSchema = z.object({
  id: z.string(),
  docId: z.string(),
  docTitle: z.string(),
  kind: z.string(),
  text: z.string(),
  tags: z.array(z.string()),
  source: z.enum(["markdown", "learned"]),
  disabled: z.boolean(),
  usageCount: z.number(),
  helpfulCount: z.number(),
  irrelevantCount: z.number(),
  sessions: z.array(z.string()),
});
export type KnowledgeListResponse = { chunks: z.infer<typeof KnowledgeChunkInfoSchema>[] };

const KnowledgeGapSchema = z.object({
  query: z.string(),
  count: z.number(),
  worstScore: z.number(),
  lastAt: z.string(),
  phases: z.array(z.string()),
});
export type KnowledgeGapsResponse = { gaps: z.infer<typeof KnowledgeGapSchema>[] };

export type ChunkToggleResponse = { ok: true; disabled: boolean };
export type CitationFlagResponse = { citation: z.infer<typeof CitationSchema> };
export type QuestionResponse = { question: z.infer<typeof AdminQuestionSchema> };
export type CorrectionResponse = { correction: z.infer<typeof BpmnCorrectionSchema> };
export type CorrectionLearnResponse = {
  feedback: z.infer<typeof AdminFeedbackSchema>;
  description: string;
};

const AdminStatsSchema = z.object({
  candidates: z.object({
    pending: z.number(),
    accepted: z.number(),
    rejected: z.number(),
    byKind: z.record(z.string(), z.number()),
  }),
  sessions: z.object({
    total: z.number(),
    withFeedback: z.number(),
    withCorrection: z.number(),
  }),
  learned: z.object({
    total: z.number(),
    byKind: z.record(z.string(), z.number()),
    reinforcements: z.number(),
  }),
  behavior: z.number(),
  examples: z.number(),
  topTags: z.array(z.object({ tag: z.string(), count: z.number() })),
});
export type AdminStatsResponse = z.infer<typeof AdminStatsSchema>;

export type ExampleListResponse = { examples: z.infer<typeof ExampleEntrySchema>[] };
export type ExampleResponse = { example: z.infer<typeof ExampleEntrySchema> };

export type BehaviorListResponse = {
  entries: z.infer<typeof BehaviorEntrySchema>[];
  agents: readonly string[];
};
export type BehaviorResponse = {
  entry: z.infer<typeof BehaviorEntrySchema>;
  reinforced: boolean;
};
export type BehaviorPatchResponse = { entry: z.infer<typeof BehaviorEntrySchema> };

export type EvalListResponse = { cases: z.infer<typeof EvalCaseSchema>[] };
export type EvalResponse = { case: z.infer<typeof EvalCaseSchema> };
export type EvalRunResponse = {
  results: z.infer<typeof EvalResultSchema>[];
  passed: number;
  total: number;
};

export { errorResponse, okResponse };
