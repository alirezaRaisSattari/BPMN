import { z } from "zod";
import type { SessionState } from "../schemas/session.js";
import { AgentContext, BA_PERSONA, ground, knowledgeBlock, sessionDigest } from "./base.js";

export const RulesResultSchema = z.object({
  rules: z
    .array(
      z.object({
        statement: z.string(),
        category: z.string().optional(),
        rationale: z.string().optional(),
      }),
    )
    .default([]),
});
export type RulesResult = z.infer<typeof RulesResultSchema>;

/** Explicit business-rule extraction agent (rules stated/implied by the user). */
export async function runBusinessRules(
  ctx: AgentContext,
  session: SessionState,
): Promise<RulesResult> {
  const grounding = await ground(ctx, `قوانین کسب‌وکار برای ${session.request}`, 3);
  const system = [
    BA_PERSONA,
    "وظیفه: استخراج قوانین کسب‌وکار صریح که کاربر بیان کرده یا مستقیماً از گفته‌های او برمی‌آید.",
    "قوانین ضمنی/پیشنهادی را اینجا نیاور (آن‌ها مرحلهٔ جداگانه دارند). هر قانون یک جملهٔ روشن باشد.",
    knowledgeBlock(grounding),
    sessionDigest(session),
  ].join("\n\n");

  return ctx.llm.completeStructured({
    schema: RulesResultSchema,
    schemaName: "RulesResult",
    schemaDescription: "قوانین کسب‌وکار صریح فرآیند",
    system,
    messages: [{ role: "user", content: "قوانین کسب‌وکار صریح را استخراج کن." }],
  });
}
