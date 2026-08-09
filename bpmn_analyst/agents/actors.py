from ..models import ActorsResult, Session
from .base import AgentContext, BA_PERSONA, behavior_block, ground, knowledge_block, session_digest

async def run_actors(ctx: AgentContext, session: Session) -> ActorsResult:
    grounding = await ground(ctx, f"نقش‌های دخیل در {session.request} در سامانه دانشگاهی", 3,
                             lambda c: c.kind in {"glossary", "domain"})
    system = "\n\n".join([BA_PERSONA, "وظیفه: شناسایی همهٔ نقش‌های دخیل در فرآیند (شامل نقش «سیستم» برای فعالیت‌های خودکار).",
        "فقط نقش‌هایی را بیاور که از گفته‌های کاربر یا ماهیت فرآیند قابل‌استنتاج‌اند.",
        "برای نام‌گذاری نقش‌ها، در صورت وجود، از اصطلاحات واژه‌نامه و دانش دامنه استفاده کن تا نام‌ها یکدست بمانند.",
        knowledge_block(grounding), behavior_block(ctx, "actors"), session_digest(session)])
    return await ctx.llm.structured(ActorsResult, "ActorsResult", [{"role": "user", "content": "نقش‌های این فرآیند را استخراج کن."}], system, "فهرست نقش‌های فرآیند")

