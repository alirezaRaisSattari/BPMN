import { z } from "zod";
import { ProcessModelSchema } from "./process-model.js";

/**
 * Golden example bank — reviewed sessions promoted to worked examples. Unlike
 * abstract learned *statements*, an example carries a full ProcessModel so the
 * logical-model agent can imitate a domain-matched, admin-approved solution
 * (case-based few-shot). Selected by request-text similarity at modeling time.
 */
export const ExampleEntrySchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  request: z.string().default(""),
  processModel: ProcessModelSchema,
  note: z.string().default(""),
  createdAt: z.string(),
});
export type ExampleEntry = z.infer<typeof ExampleEntrySchema>;
