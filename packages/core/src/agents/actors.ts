import { z } from "zod";
import type { SessionState } from "../schemas/session.js";
import { AgentContext, BA_PERSONA, behaviorBlock, ground, knowledgeBlock, sessionDigest } from "./base.js";

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
  // Anchor role naming to learned terminology: prefer glossary/domain knowledge so
  // lane names stay consistent across sessions.
  const grounding = await ground(
    ctx,
    `نقش‌های دخیل در ${session.request} در سامانه دانشگاهی`,
    3,
    (c) => c.kind === "glossary" || c.kind === "domain",
  );
  const system = [
    BA_PERSONA,
    "وظیفه: شناسایی همهٔ نقش‌های دخیل در فرآیند (شامل نقش «سیستم» برای فعالیت‌های خودکار).",
    "فقط نقش‌هایی را بیاور که از گفته‌های کاربر یا ماهیت فرآیند قابل‌استنتاج‌اند.",
    "برای نام‌گذاری نقش‌ها، در صورت وجود، از اصطلاحات واژه‌نامه و دانش دامنه استفاده کن تا نام‌ها یکدست بمانند.",
    knowledgeBlock(grounding),
    behaviorBlock(ctx, "actors"),
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
