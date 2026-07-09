import type { SessionState } from "../schemas/session.js";
import { ProcessModelSchema, type ProcessModel } from "../schemas/process-model.js";
import { AgentContext, BA_PERSONA, ground, knowledgeBlock, sessionDigest } from "./base.js";

/**
 * Logical-model agent — compiles the confirmed requirements/roles/rules into an
 * abstract ProcessModel (start/end events, activities, gateways, flows, lanes,
 * data objects). This is the structured hand-off to BPMN generation.
 */
export async function runLogicalModel(
  ctx: AgentContext,
  session: SessionState,
): Promise<ProcessModel> {
  const grounding = await ground(
    ctx,
    `اصول مدل‌سازی BPMN: رویداد شروع و پایان، gateway، lane، جریان توالی برای ${session.request}`,
    5,
  );

  const system = [
    BA_PERSONA,
    "وظیفه: ساخت «مدل منطقی فرآیند» بر اساس اطلاعات تأییدشده. الزامات:",
    "- شناسه‌ها (id) فقط حروف/عدد/زیرخط، یکتا و بدون فاصله (مثل: start_1، act_submit، gw_check).",
    "- حداقل یک startEvent و یک endEvent. مسیر رد/عدم‌تأیید هم یک endEvent یا بازگشت داشته باشد.",
    "- هر فعالیت را با lane مربوط به نقش مسئول مشخص کن. فعالیت انسانی=userTask، سیستمی=serviceTask.",
    "- تصمیم‌ها را با gateway (exclusive برای شرط، parallel برای هم‌زمانی) مدل کن؛ هر شاخهٔ",
    "  exclusive یک condition روشن داشته باشد. گیت‌وی موازی که باز می‌شود باید join شود.",
    "- sequenceFlows باید همهٔ گره‌ها را به‌درستی به هم وصل کند (بدون گره معلق).",
    "- lanes را از روی نقش‌ها بساز. dataObjects را برای ورودی/خروجی مهم اضافه کن.",
    "فرآیند را حدس نزن؛ فقط از اطلاعات تأییدشده استفاده کن.",
    knowledgeBlock(grounding),
    sessionDigest(session),
  ].join("\n\n");

  return ctx.llm.completeStructured({
    schema: ProcessModelSchema,
    schemaName: "ProcessModel",
    schemaDescription: "مدل منطقی کامل فرآیند برای تولید BPMN 2.0",
    system,
    messages: [{ role: "user", content: "مدل منطقی کامل فرآیند را بساز." }],
    maxTokens: 8000,
    retries: 3,
  });
}
