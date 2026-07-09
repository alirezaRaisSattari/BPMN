import { z } from "zod";
import { requirementCategories } from "../schemas/analysis.js";
import type { SessionState } from "../schemas/session.js";
import { AgentContext, BA_PERSONA, ground, knowledgeBlock, sessionDigest } from "./base.js";
import { recentChat } from "./chat.js";

export const ElicitationResultSchema = z.object({
  extractedRequirements: z
    .array(
      z.object({
        category: z.enum(requirementCategories),
        statement: z.string(),
      }),
    )
    .default([]),
  questions: z
    .array(
      z.object({
        text: z.string(),
        category: z.enum(requirementCategories).default("other"),
        rationale: z.string().optional(),
      }),
    )
    .default([]),
  assistantMessage: z.string(),
  readyToModel: z.boolean().default(false),
});
export type ElicitationResult = z.infer<typeof ElicitationResultSchema>;

/**
 * Elicitation agent — the interviewer. Given the conversation so far, it pulls
 * out any new requirements, and either asks the next most important questions or
 * signals that enough is known to start modeling.
 */
export async function runElicitation(
  ctx: AgentContext,
  session: SessionState,
): Promise<ElicitationResult> {
  const grounding = await ground(ctx, `${session.request}\nنقش‌ها و مراحل و قوانین فرآیند`, 3);

  const system = [
    BA_PERSONA,
    "",
    "وظیفهٔ این مرحله: استخراج نیازمندی‌ها از گفتگو و پرسیدن سؤالات تکمیلی هدفمند.",
    "دسته‌های نیازمندی که باید پوشش داده شوند: آغازکننده، نقش‌ها، فعالیت‌های اصلی، ترتیب،",
    "شرایط تصمیم، شرایط تأیید/رد، استثناها، مدیریت خطا، محدودیت زمانی، فعالیت موازی،",
    "پایان‌های مختلف، ورودی/خروجی هر مرحله.",
    "قواعد: هر بار حداکثر ۳ سؤال مهم بپرس. اگر همهٔ دسته‌های حیاتی (آغازکننده، نقش‌ها،",
    "فعالیت‌ها و ترتیب، شرایط تصمیم و تأیید/رد، پایان‌ها) به‌اندازهٔ کافی روشن‌اند،",
    "readyToModel=true بگذار و در assistantMessage خلاصه‌ای برای تأیید کاربر بیاور.",
    "فرآیند را حدس نزن؛ فقط چیزهایی را استخراج کن که کاربر گفته یا تأیید کرده است.",
    "",
    knowledgeBlock(grounding),
    "وضعیت فعلی تحلیل:",
    sessionDigest(session),
  ].join("\n");

  return ctx.llm.completeStructured({
    schema: ElicitationResultSchema,
    schemaName: "ElicitationResult",
    schemaDescription: "استخراج نیازمندی‌ها و سؤالات تکمیلی برای فرآیند دانشگاهی",
    system,
    messages: recentChat(session),
  });
}
