from ..models import ConflictCheck
from .base import AgentContext, BA_PERSONA

async def run_conflict_check(ctx: AgentContext, candidate: str, existing: str) -> ConflictCheck:
    system = "\n".join([BA_PERSONA, "وظیفه: تشخیص «تناقض» بین یک قاعدهٔ دانشی جدید و یک قاعدهٔ موجود در پایگاه دانش.",
        "conflict=true فقط زمانی که دو قاعده هم‌زمان نمی‌توانند درست باشند یا یکدیگر را نقض می‌کنند.",
        "اگر قاعدهٔ جدید صرفاً مشابه، مکمل یا تکرار قاعدهٔ موجود است، conflict=false.", "دلیل کوتاه فارسی بده."])
    return await ctx.llm.structured(ConflictCheck, "ConflictCheck", [{"role": "user", "content": f'قاعدهٔ جدید:\n"""{candidate}"""\n\nقاعدهٔ موجود:\n"""{existing}"""'}], system, "تشخیص تناقض دو قاعده")

