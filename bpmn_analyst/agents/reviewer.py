import json
from ..models import ProcessModel, ReviewResult
from .base import AgentContext, BA_PERSONA, ground, knowledge_block

async def run_reviewer(ctx: AgentContext, model: ProcessModel) -> ReviewResult:
    grounding = await ground(ctx, "چک‌لیست اعتبارسنجی و اصول مدل‌سازی BPMN", 4)
    system = "\n\n".join([BA_PERSONA, "وظیفه: بازبینی کیفی مدل فرآیند در برابر چک‌لیست اعتبارسنجی BPMN.",
        "مسائل را با شدت (info/warning/error) و پیشنهاد اصلاح گزارش کن. اگر مدل سالم است ok=true.",
        knowledge_block(grounding), "مدل فرآیند (JSON):\n" + json.dumps(model.model_dump(), ensure_ascii=False)])
    return await ctx.llm.structured(ReviewResult, "ReviewResult", [{"role": "user", "content": "این مدل را بازبینی کن."}], system, "نتیجهٔ بازبینی کیفی مدل")

