import { z } from "zod";

/**
 * Golden evaluation cases promoted from reviewed sessions. The runner reruns the
 * stored process model through the deterministic output stage and checks these
 * structural expectations — guarding the generation/validation pipeline against
 * regressions without needing an LLM.
 */

export const EvalExpectationSchema = z.object({
  /** Compiled BPMN must pass structural validation. */
  bpmnValid: z.boolean().default(true),
  minRoles: z.number().int().min(0).default(0),
  minActivities: z.number().int().min(0).default(0),
  /** At least one exclusive gateway with a rejection/return branch. */
  mustHaveRejectionPath: z.boolean().default(false),
  /** Role names that must all be present (substring match, case-insensitive). */
  expectedRoles: z.array(z.string()).default([]),
});
export type EvalExpectation = z.infer<typeof EvalExpectationSchema>;

export const EvalCaseSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  request: z.string().default(""),
  note: z.string().default(""),
  expected: EvalExpectationSchema.default({}),
  createdAt: z.string(),
});
export type EvalCase = z.infer<typeof EvalCaseSchema>;

export const EvalCheckSchema = z.object({
  label: z.string(),
  passed: z.boolean(),
  detail: z.string().default(""),
});
export type EvalCheck = z.infer<typeof EvalCheckSchema>;

export const EvalResultSchema = z.object({
  caseId: z.string(),
  request: z.string(),
  passed: z.boolean(),
  checks: z.array(EvalCheckSchema).default([]),
  error: z.string().optional(),
});
export type EvalResult = z.infer<typeof EvalResultSchema>;
