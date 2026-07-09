import { z } from "zod";

/**
 * Knowledge base (RAG) types. Reference documents (BPMN guidelines, domain
 * templates, validation checklists) are chunked, embedded and retrieved to
 * ground the analysis agents.
 */

export const knowledgeKinds = [
  "bpmn_guideline", // BPMN 2.0 modeling best practices
  "validation", // soft validation / review checklists
  "domain", // domain-specific process knowledge / templates
  "glossary", // terminology
  "other",
] as const;
export type KnowledgeKind = (typeof knowledgeKinds)[number];

export const KnowledgeChunkSchema = z.object({
  id: z.string().min(1),
  docId: z.string().min(1),
  docTitle: z.string().min(1),
  kind: z.enum(knowledgeKinds).default("other"),
  text: z.string().min(1),
  /** Embedding vector; empty when using keyword-only retrieval. */
  embedding: z.array(z.number()).default([]),
  /** Optional tags for filtered retrieval (e.g. domain name). */
  tags: z.array(z.string()).default([]),
});
export type KnowledgeChunk = z.infer<typeof KnowledgeChunkSchema>;

export const RetrievalResultSchema = z.object({
  chunk: KnowledgeChunkSchema,
  score: z.number(),
});
export type RetrievalResult = z.infer<typeof RetrievalResultSchema>;
