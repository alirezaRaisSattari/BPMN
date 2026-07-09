import { z } from "zod";
import type { SessionState } from "../schemas/session.js";
import { AgentContext, BA_PERSONA, ground, knowledgeBlock, sessionDigest } from "./base.js";
import { recentChat } from "./chat.js";

export const ContradictionResultSchema = z.object({
  contradictions: z
    .array(
      z.object({
        description: z.string(),
        conflictingItems: z.array(z.string()).default([]),
        severity: z.enum(["low", "medium", "high"]).default("medium"),
        suggestedResolution: z.string(),
      }),
    )
    .default([]),
});
export type ContradictionResult = z.infer<typeof ContradictionResultSchema>;

/**
 * Contradiction-detection agent. Finds conflicts among requirements/rules/roles
 * (e.g. two roles owning one exclusive task, ordering that violates a rule) and
 * suggests a resolution for each.
 */
export async function runContradiction(
  ctx: AgentContext,
  session: SessionState,
): Promise<ContradictionResult> {
  const grounding = await ground(ctx, `قوانین و ترتیب صحیح فرآیند ${session.request}`, 3);
  const system = [
    BA_PERSONA,
    "وظیفه: شناسایی تناقض‌ها بین نیازمندی‌ها، قوانین و نقش‌ها. نمونه‌ها:",
    "- دو نقش مسئول یک فعالیت انحصاری، - ترتیب ناسازگار با قوانین، - حذف مرحلهٔ ضروری،",
    "- قوانین ناسازگار با یکدیگر. برای هر تناقض راهکار پیشنهاد بده.",
    "اگر تناقضی نیست، آرایهٔ خالی برگردان.",
    knowledgeBlock(grounding),
    sessionDigest(session),
  ].join("\n\n");

  return ctx.llm.completeStructured({
    schema: ContradictionResultSchema,
    schemaName: "ContradictionResult",
    schemaDescription: "تناقض‌های شناسایی‌شده و راهکار پیشنهادی",
    system,
    messages: recentChat(session),
  });
}
