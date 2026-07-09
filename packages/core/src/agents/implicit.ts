import { z } from "zod";
import type { SessionState } from "../schemas/session.js";
import { AgentContext, BA_PERSONA, ground, knowledgeBlock, sessionDigest } from "./base.js";

export const ImplicitResultSchema = z.object({
  implicitRules: z
    .array(
      z.object({
        statement: z.string(),
        rationale: z.string(),
      }),
    )
    .default([]),
});
export type ImplicitResult = z.infer<typeof ImplicitResultSchema>;

/**
 * Implicit-knowledge agent — proposes rules a user usually omits but an expert
 * analyst would add (grounded in the project knowledge base). These require
 * user confirmation before being treated as accepted.
 */
export async function runImplicit(
  ctx: AgentContext,
  session: SessionState,
): Promise<ImplicitResult> {
  const grounding = await ground(
    ctx,
    `دانش ضمنی و قوانین رایج و best practice برای ${session.request} در سامانه دانشگاهی`,
    5,
  );
  const system = [
    BA_PERSONA,
    "وظیفه: پیشنهاد «دانش ضمنی» — قوانینی که کاربران معمولاً نمی‌گویند اما تحلیل‌گر خبره لحاظ می‌کند",
    "(مثل: هر فرآیند شروع/پایان دارد، فعالیت سیستمی توسط کاربر انجام نمی‌شود، مدیریت خطا،",
    "ثبت سابقهٔ عملیات حساس، وضعیت مشخص برای هر درخواست، مسیر رد درخواست).",
    "برای هر مورد یک دلیل کوتاه بیاور. فقط موارد مرتبط با همین فرآیند را پیشنهاد بده.",
    "این موارد باید بعداً توسط کاربر تأیید شوند.",
    knowledgeBlock(grounding),
    sessionDigest(session),
  ].join("\n\n");

  return ctx.llm.completeStructured({
    schema: ImplicitResultSchema,
    schemaName: "ImplicitResult",
    schemaDescription: "قوانین ضمنی پیشنهادی",
    system,
    messages: [{ role: "user", content: "قوانین ضمنی مرتبط را پیشنهاد بده." }],
  });
}
