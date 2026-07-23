import { z } from "zod";
import { LearnedSourceSchema } from "./feedback.js";

/**
 * Behavioral instructions — the non-RAG destination for accepted feedback.
 * Some feedback is about *how an agent should behave* ("always ask about
 * exception flows"), not domain knowledge. RAG only helps when retrieval
 * happens to hit; a behavior rule is appended to its agent's system prompt so
 * it applies on every run of that agent.
 */

/** Agents that accept behavioral instructions (one per interview phase). */
export const behaviorAgents = [
  "elicitation",
  "actors",
  "business_rules",
  "implicit",
  "ambiguity",
  "contradiction",
  "logical_model",
] as const;
export type BehaviorAgent = (typeof behaviorAgents)[number];

export const BehaviorEntrySchema = z.object({
  id: z.string().min(1),
  agent: z.enum(behaviorAgents),
  instruction: z.string().min(1),
  /** Reinforcement count — how many feedbacks confirmed this same instruction. */
  weight: z.number().default(1),
  /** Provenance for each reinforcing acceptance (shared shape with learned knowledge). */
  sources: z.array(LearnedSourceSchema).default([]),
  createdAt: z.string(),
});
export type BehaviorEntry = z.infer<typeof BehaviorEntrySchema>;
