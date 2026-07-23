import { z } from "zod";
import type { SessionState } from "../schemas/session.js";
import type { ProcessModel } from "../schemas/process-model.js";
import { AgentContext, BA_PERSONA } from "./base.js";

export const CorrectionDiffSchema = z.object({
  /** A generalizable, Persian description of what the admin changed and why it matters. */
  description: z.string().default(""),
});
export type CorrectionDiff = z.infer<typeof CorrectionDiffSchema>;

/** One-line-per-element summary of the model the system generated. */
function generatedSummary(model: ProcessModel | undefined): string {
  if (!model) return "(مدل تولیدشده‌ای ثبت نشده است)";
  const lanes = model.lanes.map((l) => l.name).join("، ") || "—";
  const acts = model.activities.map((a) => `${a.name} [${a.type}]`).join(" | ") || "—";
  const gws = model.gateways.map((g) => `${g.name ?? g.id} (${g.type})`).join(" | ") || "—";
  return [`نقش‌ها: ${lanes}`, `فعالیت‌ها: ${acts}`, `گیت‌وی‌ها: ${gws}`].join("\n");
}

/**
 * Correction-diff agent — compares the model the system generated with the BPMN
 * an admin corrected by hand, and describes the delta as a *generalizable*
 * lesson. Its output is fed into the normal feedback-extraction → review queue,
 * so a silent hand-correction becomes reviewable knowledge with no extra typing.
 */
export async function runCorrectionDiff(
  ctx: AgentContext,
  session: SessionState,
  correctedXml: string,
  note: string,
): Promise<CorrectionDiff> {
  const system = [
    BA_PERSONA,
    "وظیفه: یک ادمین نمودار BPMN تولیدشده را اصلاح کرده است. تفاوت میان «مدل تولیدشده» و «BPMN اصلاح‌شده»",
    "را تحلیل کن و آن را به‌صورت یک «درس قابل تعمیم» توصیف کن که در مدل‌سازی فرآیندهای مشابه در آینده مفید باشد.",
    "روی الگوها تمرکز کن (مثل: «پس از هر مرحلهٔ تأیید باید مسیر رد وجود داشته باشد»، «فعالیت پرداخت باید",
    "serviceTask باشد»)، نه جزئیات مختص همین نمودار. اگر تغییر صرفاً جزئی و بی‌اهمیت است، توصیف کوتاه بده.",
    "خروجی یک پاراگراف فارسی روشن باشد.",
    "«مدل تولیدشده توسط سیستم»:",
    generatedSummary(session.processModel),
  ].join("\n\n");

  return ctx.llm.completeStructured({
    schema: CorrectionDiffSchema,
    schemaName: "CorrectionDiff",
    schemaDescription: "توصیف قابل‌تعمیم تفاوت مدل تولیدشده و نمودار اصلاح‌شده",
    system,
    messages: [
      {
        role: "user",
        content: [
          note ? `توضیح ادمین دربارهٔ اصلاح: ${note}` : "",
          "BPMN اصلاح‌شده:",
          "```xml",
          correctedXml.slice(0, 12000),
          "```",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
  });
}
