from ..models import FeedbackExtraction, Session
from .base import AgentContext, BA_PERSONA, session_digest

async def run_feedback_extraction(ctx: AgentContext, session: Session, feedback_text: str) -> FeedbackExtraction:
    system = "\n\n".join([BA_PERSONA, "وظیفه: یک ادمین خروجی این جلسهٔ تحلیل را بررسی کرده و بازخورد نوشته است.",
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
        session_digest(session)])
    return await ctx.llm.structured(FeedbackExtraction, "FeedbackExtraction", [{"role": "user", "content": f'متن بازخورد ادمین:\n"""\n{feedback_text}\n"""'}], system, "نکات دانشی استخراج‌شده از بازخورد ادمین")
