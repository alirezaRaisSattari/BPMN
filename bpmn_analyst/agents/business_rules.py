from ..models import RulesResult, Session
from .base import AgentContext, BA_PERSONA, behavior_block, ground, knowledge_block, session_digest

async def run_business_rules(ctx: AgentContext, session: Session) -> RulesResult:
    grounding = await ground(ctx, f"قوانین کسب‌وکار برای {session.request}", 3)
    system = "\n\n".join([BA_PERSONA, "وظیفه: استخراج قوانین کسب‌وکار صریح که کاربر بیان کرده یا مستقیماً از گفته‌های او برمی‌آید.",
        "قوانین ضمنی/پیشنهادی را اینجا نیاور (آن‌ها مرحلهٔ جداگانه دارند). هر قانون یک جملهٔ روشن باشد.",
        knowledge_block(grounding), behavior_block(ctx, "business_rules"), session_digest(session)])
    return await ctx.llm.structured(RulesResult, "RulesResult", [{"role": "user", "content": "قوانین کسب‌وکار صریح را استخراج کن."}], system, "قوانین کسب‌وکار صریح فرآیند")

