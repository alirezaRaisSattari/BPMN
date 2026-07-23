import { z } from "zod";
import { knowledgeKinds } from "./knowledge.js";

/**
 * Admin feedback loop: admins review finished sessions and write feedback; an
 * LLM pass extracts generalizable knowledge candidates from it. Accepted
 * candidates become learned knowledge injected into the RAG index.
 */

export const candidateStatuses = ["pending", "accepted", "rejected"] as const;
export type CandidateStatus = (typeof candidateStatuses)[number];

/** Snapshot of an existing chunk similar to a candidate (duplicate/conflict warning). */
export const SimilarChunkSchema = z.object({
  chunkId: z.string().min(1),
  docTitle: z.string(),
  text: z.string(),
  score: z.number(),
  /** True when the candidate contradicts (not merely overlaps) this chunk. */
  conflict: z.boolean().default(false),
  conflictReason: z.string().default(""),
});
export type SimilarChunk = z.infer<typeof SimilarChunkSchema>;

/** A knowledge point extracted from admin feedback, awaiting review. */
export const KnowledgeCandidateSchema = z.object({
  id: z.string().min(1),
  statement: z.string().min(1),
  rationale: z.string().default(""),
  kind: z.enum(knowledgeKinds).default("other"),
  tags: z.array(z.string()).default([]),
  status: z.enum(candidateStatuses).default("pending"),
  similar: z.array(SimilarChunkSchema).default([]),
  createdAt: z.string(),
  decidedAt: z.string().optional(),
});
export type KnowledgeCandidate = z.infer<typeof KnowledgeCandidateSchema>;

/** One admin feedback on a session, with its extracted candidates. */
export const AdminFeedbackSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  /** Denormalized session request so lists render without loading sessions. */
  sessionRequest: z.string().default(""),
  text: z.string().min(1),
  createdAt: z.string(),
  /** Set when the LLM extraction failed — the feedback itself is still saved. */
  extractionError: z.string().optional(),
  candidates: z.array(KnowledgeCandidateSchema).default([]),
});
export type AdminFeedback = z.infer<typeof AdminFeedbackSchema>;

/** Where a learned entry came from (one per reinforcing acceptance). */
export const LearnedSourceSchema = z.object({
  feedbackId: z.string(),
  sessionId: z.string(),
  at: z.string(),
});
export type LearnedSource = z.infer<typeof LearnedSourceSchema>;

/** An accepted candidate persisted as learned knowledge (id doubles as chunk id). */
export const LearnedEntrySchema = z.object({
  id: z.string().min(1),
  feedbackId: z.string().min(1),
  sessionId: z.string().min(1),
  kind: z.enum(knowledgeKinds).default("other"),
  text: z.string().min(1),
  tags: z.array(z.string()).default([]),
  /** Reinforcement count — how many feedbacks confirmed this same rule. */
  weight: z.number().default(1),
  /** Provenance for each reinforcing acceptance. */
  sources: z.array(LearnedSourceSchema).default([]),
  createdAt: z.string(),
});
export type LearnedEntry = z.infer<typeof LearnedEntrySchema>;
