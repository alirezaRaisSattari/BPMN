import { z } from "zod";
import type { SessionState } from "../schemas/session.js";
import { AgentContext, BA_PERSONA, ground, knowledgeBlock, sessionDigest } from "./base.js";

export const ActorsResultSchema = z.object({
  roles: z
    .array(
      z.object({
        name: z.string(),
        type: z.enum(["human", "system", "organization"]).default("human"),
        description: z.string().optional(),
      }),
    )
    .default([]),
});
export type ActorsResult = z.infer<typeof ActorsResultSchema>;

/** Actor/role identification agent. */
export async function runActors(ctx: AgentContext, session: SessionState): Promise<ActorsResult> {
  const grounding = await ground(ctx, `نقش‌های دخیل در ${session.request} در سامانه دانشگاهی`, 3);
  const system = [
    BA_PERSONA,
    "وظیفه: شناسایی همهٔ نقش‌های دخیل در فرآیند (شامل نقش «سیستم» برای فعالیت‌های خودکار).",
    "فقط نقش‌هایی را بیاور که از گفته‌های کاربر یا ماهیت فرآیند قابل‌استنتاج‌اند.",
    knowledgeBlock(grounding),
    sessionDigest(session),
  ].join("\n\n");

  return ctx.llm.completeStructured({
    schema: ActorsResultSchema,
    schemaName: "ActorsResult",
    schemaDescription: "فهرست نقش‌های فرآیند",
    system,
    messages: [{ role: "user", content: "نقش‌های این فرآیند را استخراج کن." }],
  });
}
