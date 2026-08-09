from ..models import ImplicitResult, Session
from .base import AgentContext, BA_PERSONA, behavior_block, ground, knowledge_block, session_digest

async def run_implicit(ctx: AgentContext, session: Session) -> ImplicitResult:
    grounding = await ground(ctx, f"دانش ضمنی و قوانین رایج و best practice برای {session.request} در سامانه دانشگاهی", 5)
    system = "\n\n".join([BA_PERSONA, "وظیفه: پیشنهاد «دانش ضمنی» — قوانینی که کاربران معمولاً نمی‌گویند اما تحلیل‌گر خبره لحاظ می‌کند",
        "(مثل: هر فرآیند شروع/پایان دارد، فعالیت سیستمی توسط کاربر انجام نمی‌شود، مدیریت خطا،",
        "ثبت سابقهٔ عملیات حساس، وضعیت مشخص برای هر درخواست، مسیر رد درخواست).",
        "برای هر مورد یک دلیل کوتاه بیاور. فقط موارد مرتبط با همین فرآیند را پیشنهاد بده.",
        "این موارد باید بعداً توسط کاربر تأیید شوند.", knowledge_block(grounding), behavior_block(ctx, "implicit"), session_digest(session)])
    return await ctx.llm.structured(ImplicitResult, "ImplicitResult", [{"role": "user", "content": "قوانین ضمنی مرتبط را پیشنهاد بده."}], system, "قوانین ضمنی پیشنهادی")

