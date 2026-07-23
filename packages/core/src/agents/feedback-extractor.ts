import { z } from "zod";
import { knowledgeKinds } from "../schemas/knowledge.js";
import type { SessionState } from "../schemas/session.js";
import { AgentContext, BA_PERSONA, sessionDigest } from "./base.js";

export const FeedbackExtractionSchema = z.object({
  points: z
    .array(
      z.object({
        statement: z.string(),
        rationale: z.string().default(""),
        kind: z.enum(knowledgeKinds).default("other"),
        tags: z.array(z.string()).default([]),
        /** true = a reusable rule for future analyses; false = one-off note. */
        generalizable: z.boolean().default(false),
      }),
    )
    .default([]),
});
export type FeedbackExtraction = z.infer<typeof FeedbackExtractionSchema>;

/**
 * Feedback-extractor agent — reads an admin's feedback on a finished session
 * and extracts candidate knowledge points. Only points marked `generalizable`
 * are worth adding to the knowledge base (after human approval).
 */
export async function runFeedbackExtraction(
  ctx: AgentContext,
  session: SessionState,
  feedbackText: string,
): Promise<FeedbackExtraction> {
  const system = [
    BA_PERSONA,
    "وظیفه: یک ادمین خروجی این جلسهٔ تحلیل را بررسی کرده و بازخورد نوشته است.",
    "از متن بازخورد، «نکات دانشی» را استخراج کن. هر نکته را در یک جملهٔ خبری مستقل و کامل بنویس",
    "به‌طوری که بدون دیدن این جلسه هم قابل‌فهم باشد.",
    "برای هر نکته مشخص کن آیا «قابل تعمیم» است یا نه:",
    "- generalizable=true: قاعده‌ای که در تحلیل‌های آیندهٔ فرآیندهای دیگر هم صادق است",
    "(مثل: «هر مرحلهٔ تأیید باید مسیر رد داشته باشد»).",
    "- generalizable=false: اصلاح مختص همین جلسه/نمودار (مثل: «در این نمودار نقش X جا افتاده»).",
    "kind هر نکته را از این مقادیر انتخاب کن:",
    "- bpmn_guideline: اصول مدل‌سازی BPMN",
    "- validation: مورد چک‌لیست اعتبارسنجی مدل",
    "- domain: دانش دامنهٔ سامانه‌های دانشگاهی (نقش‌ها، قوانین، فرآیندها)",
    "- glossary: تعریف اصطلاح",
    "- other: سایر",
    "برای هر نکته دلیل کوتاه (rationale) و چند برچسب (tags) بده.",
    "اگر بازخورد هیچ نکتهٔ دانشی ندارد، آرایهٔ خالی برگردان. نکتهٔ تکراری یا بدیهی نساز.",
    sessionDigest(session),
  ].join("\n\n");

  return ctx.llm.completeStructured({
    schema: FeedbackExtractionSchema,
    schemaName: "FeedbackExtraction",
    schemaDescription: "نکات دانشی استخراج‌شده از بازخورد ادمین",
    system,
    messages: [
      { role: "user", content: `متن بازخورد ادمین:\n"""\n${feedbackText}\n"""` },
    ],
  });
}
