import { z } from "zod";
import type { ProcessModel } from "../schemas/process-model.js";
import { AgentContext, BA_PERSONA, ground, knowledgeBlock } from "./base.js";

export const ReviewResultSchema = z.object({
  ok: z.boolean().default(true),
  issues: z
    .array(
      z.object({
        severity: z.enum(["info", "warning", "error"]).default("warning"),
        message: z.string(),
        suggestion: z.string().optional(),
      }),
    )
    .default([]),
});
export type ReviewResult = z.infer<typeof ReviewResultSchema>;

/**
 * Reviewer agent — a soft critic that checks the logical model against the
 * BPMN validation checklist in the knowledge base (complements the deterministic
 * structural validator). Returns issues but does not block.
 */
export async function runReviewer(
  ctx: AgentContext,
  model: ProcessModel,
): Promise<ReviewResult> {
  const grounding = await ground(ctx, "چک‌لیست اعتبارسنجی و اصول مدل‌سازی BPMN", 4);
  const system = [
    BA_PERSONA,
    "وظیفه: بازبینی کیفی مدل فرآیند در برابر چک‌لیست اعتبارسنجی BPMN.",
    "مسائل را با شدت (info/warning/error) و پیشنهاد اصلاح گزارش کن. اگر مدل سالم است ok=true.",
    knowledgeBlock(grounding),
    `مدل فرآیند (JSON):\n${JSON.stringify(model)}`,
  ].join("\n\n");

  return ctx.llm.completeStructured({
    schema: ReviewResultSchema,
    schemaName: "ReviewResult",
    schemaDescription: "نتیجهٔ بازبینی کیفی مدل",
    system,
    messages: [{ role: "user", content: "این مدل را بازبینی کن." }],
  });
}
