import { z } from "zod";
import type { SessionState } from "../schemas/session.js";
import { AgentContext, BA_PERSONA, behaviorBlock, sessionDigest } from "./base.js";
import { recentChat } from "./chat.js";

export const AmbiguityResultSchema = z.object({
  ambiguities: z
    .array(
      z.object({
        description: z.string(),
        question: z.string(),
      }),
    )
    .default([]),
});
export type AmbiguityResult = z.infer<typeof AmbiguityResultSchema>;

/**
 * Ambiguity-detection agent. If information is insufficient, it must NOT guess —
 * it reports each ambiguity together with a clarifying question.
 */
export async function runAmbiguity(
  ctx: AgentContext,
  session: SessionState,
): Promise<AmbiguityResult> {
  const system = [
    BA_PERSONA,
    "وظیفه: شناسایی ابهام‌هایی که مانع نهایی‌سازی مدل می‌شوند. برای هر ابهام یک سؤال روشن‌کننده بده.",
    "اگر اطلاعات کافی و بدون ابهام است، آرایهٔ خالی برگردان. فرآیند را حدس نزن.",
    behaviorBlock(ctx, "ambiguity"),
    sessionDigest(session),
  ].join("\n\n");

  return ctx.llm.completeStructured({
    schema: AmbiguityResultSchema,
    schemaName: "AmbiguityResult",
    schemaDescription: "ابهام‌های باقی‌مانده و سؤالات روشن‌کننده",
    system,
    messages: recentChat(session),
  });
}
