from ..models import ContradictionResult, Session
from .base import AgentContext, BA_PERSONA, behavior_block, ground, knowledge_block, recent_chat, session_digest

async def run_contradiction(ctx: AgentContext, session: Session) -> ContradictionResult:
    grounding = await ground(ctx, f"قوانین و ترتیب صحیح فرآیند {session.request}", 3)
    system = "\n\n".join([BA_PERSONA, "وظیفه: شناسایی تناقض‌ها بین نیازمندی‌ها، قوانین و نقش‌ها. نمونه‌ها:",
        "- دو نقش مسئول یک فعالیت انحصاری، - ترتیب ناسازگار با قوانین، - حذف مرحلهٔ ضروری،",
        "- قوانین ناسازگار با یکدیگر. برای هر تناقض راهکار پیشنهاد بده.", "اگر تناقضی نیست، آرایهٔ خالی برگردان.",
        knowledge_block(grounding), behavior_block(ctx, "contradiction"), session_digest(session)])
    return await ctx.llm.structured(ContradictionResult, "ContradictionResult", recent_chat(session), system, "تناقض‌های شناسایی‌شده و راهکار پیشنهادی")
