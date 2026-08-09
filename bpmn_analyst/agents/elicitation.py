from ..models import ElicitationResult, Session
from .base import AgentContext, BA_PERSONA, behavior_block, ground, knowledge_block, recent_chat, session_digest

async def run_elicitation(ctx: AgentContext, session: Session) -> ElicitationResult:
    grounding = await ground(ctx, f"{session.request}\nنقش‌ها و مراحل و قوانین فرآیند", 3)
    system = "\n".join([BA_PERSONA, "", "وظیفهٔ این مرحله: استخراج نیازمندی‌ها از گفتگو و پرسیدن سؤالات تکمیلی هدفمند.",
        "دسته‌های نیازمندی که باید پوشش داده شوند: آغازکننده، نقش‌ها، فعالیت‌های اصلی، ترتیب،",
        "شرایط تصمیم، شرایط تأیید/رد، استثناها، مدیریت خطا، محدودیت زمانی، فعالیت موازی،",
        "پایان‌های مختلف، ورودی/خروجی هر مرحله.",
        "قواعد: هر بار حداکثر ۳ سؤال مهم بپرس. اگر همهٔ دسته‌های حیاتی (آغازکننده، نقش‌ها،",
        "فعالیت‌ها و ترتیب، شرایط تصمیم و تأیید/رد، پایان‌ها) به‌اندازهٔ کافی روشن‌اند،",
        "readyToModel=true بگذار و در assistantMessage خلاصه‌ای برای تأیید کاربر بیاور.",
        "فرآیند را حدس نزن؛ فقط چیزهایی را استخراج کن که کاربر گفته یا تأیید کرده است.", "",
        knowledge_block(grounding), behavior_block(ctx, "elicitation"), "وضعیت فعلی تحلیل:", session_digest(session)])
    return await ctx.llm.structured(ElicitationResult, "ElicitationResult", recent_chat(session), system,
        "استخراج نیازمندی‌ها و سؤالات تکمیلی برای فرآیند دانشگاهی")

