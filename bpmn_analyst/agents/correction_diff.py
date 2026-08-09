from ..models import CorrectionDiff, Session
from .base import AgentContext, BA_PERSONA

def generated_summary(session: Session) -> str:
    model = session.processModel
    if not model: return "(مدل تولیدشده‌ای ثبت نشده است)"
    return "\n".join(["نقش‌ها: " + ("، ".join(x.name for x in model.lanes) or "—"),
        "فعالیت‌ها: " + (" | ".join(f"{x.name} [{x.type}]" for x in model.activities) or "—"),
        "گیت‌وی‌ها: " + (" | ".join(f"{x.name or x.id} ({x.type})" for x in model.gateways) or "—")])

async def run_correction_diff(ctx: AgentContext, session: Session, corrected_xml: str, note: str) -> CorrectionDiff:
    system = "\n\n".join([BA_PERSONA, "وظیفه: یک ادمین نمودار BPMN تولیدشده را اصلاح کرده است. تفاوت میان «مدل تولیدشده» و «BPMN اصلاح‌شده»",
        "را تحلیل کن و آن را به‌صورت یک «درس قابل تعمیم» توصیف کن که در مدل‌سازی فرآیندهای مشابه در آینده مفید باشد.",
        "روی الگوها تمرکز کن (مثل: «پس از هر مرحلهٔ تأیید باید مسیر رد وجود داشته باشد»، «فعالیت پرداخت باید",
        "serviceTask باشد»)، نه جزئیات مختص همین نمودار. اگر تغییر صرفاً جزئی و بی‌اهمیت است، توصیف کوتاه بده.",
        "خروجی یک پاراگراف فارسی روشن باشد.",
        "«مدل تولیدشده توسط سیستم»:\n" + generated_summary(session)])
    content = "\n".join(x for x in [f"توضیح ادمین دربارهٔ اصلاح: {note}" if note else "", "BPMN اصلاح‌شده:", "```xml", corrected_xml[:12000], "```"] if x)
    return await ctx.llm.structured(CorrectionDiff, "CorrectionDiff", [{"role": "user", "content": content}], system, "توصیف قابل‌تعمیم تفاوت مدل تولیدشده و نمودار اصلاح‌شده")
