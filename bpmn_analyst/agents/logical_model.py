from ..models import ExampleEntry, ProcessModel, Session
from .base import AgentContext, BA_PERSONA, behavior_block, ground, knowledge_block, session_digest

def model_digest(model: ProcessModel) -> str:
    return "\n".join([f"نام فرآیند: {model.name}", f"لِین‌ها/نقش‌ها: {'، '.join(x.name for x in model.lanes) or '—'}",
        "فعالیت‌ها: " + (" | ".join(f"{x.name} [{x.type}{'@'+x.lane if x.lane else ''}]" for x in model.activities) or "—"),
        "گیت‌وی‌ها: " + (" | ".join(f"{x.name or x.id} ({x.type})" for x in model.gateways) or "—"),
        "شرط‌های شاخه: " + (" | ".join(f"{x.sourceRef}→{x.targetRef}: {x.condition}" for x in model.sequenceFlows if x.condition) or "—")])

def example_block(example: ExampleEntry | None) -> str:
    if not example: return ""
    return "\n".join(["نمونهٔ کار مشابه (تأییدشده توسط ادمین) — ساختار و سبک آن را الگو بگیر، اما آن را کورکورانه کپی نکن؛",
        "مدل را بر اساس اطلاعات همین جلسه بساز:", f"«درخواست نمونه»: {example.request}", model_digest(example.processModel)])

async def run_logical_model(ctx: AgentContext, session: Session) -> ProcessModel:
    grounding = await ground(ctx, f"اصول مدل‌سازی BPMN: رویداد شروع و پایان، gateway، lane، جریان توالی برای {session.request}", 5)
    examples = ctx.example_bank.find_similar(session.request, 1, session.id) if ctx.example_bank else []
    system = "\n\n".join([BA_PERSONA, "وظیفه: ساخت «مدل منطقی فرآیند» بر اساس اطلاعات تأییدشده. الزامات:",
        "- شناسه‌ها (id) فقط حروف/عدد/زیرخط، یکتا و بدون فاصله (مثل: start_1، act_submit، gw_check).",
        "- حداقل یک startEvent و یک endEvent. مسیر رد/عدم‌تأیید هم یک endEvent یا بازگشت داشته باشد.",
        "- هر فعالیت را با lane مربوط به نقش مسئول مشخص کن. فعالیت انسانی=userTask، سیستمی=serviceTask.",
        "- تصمیم‌ها را با gateway (exclusive برای شرط، parallel برای هم‌زمانی) مدل کن؛ هر شاخهٔ exclusive یک condition روشن داشته باشد. گیت‌وی موازی که باز می‌شود باید join شود.",
        "- sequenceFlows باید همهٔ گره‌ها را به‌درستی به هم وصل کند (بدون گره معلق).",
        "- lanes را از روی نقش‌ها بساز. dataObjects را برای ورودی/خروجی مهم اضافه کن.",
        "فرآیند را حدس نزن؛ فقط از اطلاعات تأییدشده استفاده کن.", knowledge_block(grounding),
        example_block(examples[0] if examples else None), behavior_block(ctx, "logical_model"), session_digest(session)])
    return await ctx.llm.structured(ProcessModel, "ProcessModel", [{"role": "user", "content": "مدل منطقی کامل فرآیند را بساز."}], system,
        "مدل منطقی کامل فرآیند برای تولید BPMN 2.0", max_tokens=8000, retries=3)

