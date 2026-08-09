from ..models import AmbiguityResult, Session
from .base import AgentContext, BA_PERSONA, behavior_block, recent_chat, session_digest

async def run_ambiguity(ctx: AgentContext, session: Session) -> AmbiguityResult:
    system = "\n\n".join([BA_PERSONA, "وظیفه: شناسایی ابهام‌هایی که مانع نهایی‌سازی مدل می‌شوند. برای هر ابهام یک سؤال روشن‌کننده بده.",
        "اگر اطلاعات کافی و بدون ابهام است، آرایهٔ خالی برگردان. فرآیند را حدس نزن.", behavior_block(ctx, "ambiguity"), session_digest(session)])
    return await ctx.llm.structured(AmbiguityResult, "AmbiguityResult", recent_chat(session), system, "ابهام‌های باقی‌مانده و سؤالات روشن‌کننده")

