import { z } from "zod";

/**
 * Structured artefacts produced by the analysis agents: roles, requirements,
 * business rules, ambiguities, contradictions and follow-up questions.
 */

// ---- Roles / Actors ---------------------------------------------------------
export const RoleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(["human", "system", "organization"]).default("human"),
  description: z.string().optional(),
});
export type Role = z.infer<typeof RoleSchema>;

// ---- Requirements -----------------------------------------------------------
export const requirementCategories = [
  "initiator",
  "role",
  "activity",
  "ordering",
  "decision",
  "approval",
  "rejection",
  "exception",
  "error_handling",
  "time_constraint",
  "parallel",
  "end_state",
  "input_output",
  "other",
] as const;

export const RequirementSchema = z.object({
  id: z.string().min(1),
  category: z.enum(requirementCategories),
  statement: z.string().min(1),
  source: z.enum(["user", "inferred", "implicit"]).default("user"),
  confirmed: z.boolean().default(false),
});
export type Requirement = z.infer<typeof RequirementSchema>;

// ---- Business rules (explicit + implicit) -----------------------------------
export const BusinessRuleSchema = z.object({
  id: z.string().min(1),
  statement: z.string().min(1),
  kind: z.enum(["explicit", "implicit"]).default("explicit"),
  category: z.string().optional(),
  rationale: z.string().optional(),
  source: z.enum(["user", "suggested"]).default("user"),
  confirmed: z.boolean().default(false),
});
export type BusinessRule = z.infer<typeof BusinessRuleSchema>;

// ---- Ambiguities ------------------------------------------------------------
export const AmbiguitySchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  question: z.string().min(1),
  status: z.enum(["open", "resolved"]).default("open"),
  resolution: z.string().optional(),
});
export type Ambiguity = z.infer<typeof AmbiguitySchema>;

// ---- Contradictions ---------------------------------------------------------
export const ContradictionSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  conflictingItems: z.array(z.string()).default([]),
  severity: z.enum(["low", "medium", "high"]).default("medium"),
  suggestedResolution: z.string().min(1),
  status: z.enum(["open", "resolved"]).default("open"),
  resolution: z.string().optional(),
});
export type Contradiction = z.infer<typeof ContradictionSchema>;

// ---- Follow-up questions (the "interview") ----------------------------------
export const QuestionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  category: z.enum(requirementCategories).default("other"),
  rationale: z.string().optional(),
  answered: z.boolean().default(false),
  answer: z.string().optional(),
});
export type Question = z.infer<typeof QuestionSchema>;
