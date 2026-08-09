from __future__ import annotations

from .bpmn import generate_bpmn, validate_model
from .models import Session, now

def _section(title: str, lines: list[str]) -> str:
    return f"## {title}\n\n" + ("\n".join(f"- {x}" for x in lines) if lines else "- (موردی ثبت نشده)") + "\n"

def build_process_summary(session: Session) -> str:
    roles = "، ".join(x.name for x in session.roles) or "—"; model = session.processModel
    if not model: return f"فرآیند «{session.request}» — نقش‌ها: {roles}."
    return f"فرآیند «{model.name or session.request}» شامل {len(model.activities)} فعالیت، {len(model.gateways)} نقطهٔ تصمیم و {len(session.roles)} نقش ({roles}) است. {len(model.startEvents)} رویداد شروع و {len(model.endEvents)} رویداد پایان دارد."

def build_final_document(session: Session, validation: dict | None = None) -> str:
    model = session.processModel; explicit = [x for x in session.businessRules if x.kind == "explicit"]; implicit = [x for x in session.businessRules if x.kind == "implicit"]
    lane_names = {x.id: x.name for x in model.lanes} if model else {}; parts = [f"# مستند فرآیند: {model.name if model else session.request}\n", f"> {build_process_summary(session)}\n"]
    parts.append(_section("نقش‌ها (Actors)", [f"{x.name} ({x.type})" for x in session.roles]))
    parts.append(_section("فعالیت‌های اصلی", [f"{x.name}{' — نقش: '+lane_names.get(x.lane, x.lane) if x.lane else ''} [{x.type}]" for x in (model.activities if model else [])]))
    parts.append(_section("قوانین کسب‌وکار", [x.statement for x in explicit]))
    parts.append(_section("قوانین ضمنی پیشنهادی/تأییدشده", [x.statement + (" ✓" if x.confirmed else " (در انتظار تأیید)") for x in implicit]))
    parts.append(_section("ابهام‌های برطرف‌شده", [x.description for x in session.ambiguities if x.status == "resolved"]))
    parts.append(_section("تناقض‌های شناسایی‌شده", [f"{x.description} — راهکار: {x.suggestedResolution} ({x.status})" for x in session.contradictions]))
    if validation:
        parts.append(_section("اعتبارسنجی مدل", [f"وضعیت اعتبارسنجی ساختاری: {'معتبر ✅' if validation['valid'] else 'دارای خطا ❌'}",
            *[f"خطا: {x}" for x in validation["errors"]], *[f"هشدار: {x}" for x in validation["warnings"]]]))
    parts.append("## خروجی BPMN\n\nمدل استاندارد BPMN 2.0 در فایل `process.bpmn` ذخیره شده و در ابزارهای BPMN قابل باز شدن است.\n")
    return "\n".join(parts)

def produce_outputs(session: Session) -> dict:
    if not session.processModel: raise RuntimeError("produceOutputs: session has no processModel yet.")
    validation = validate_model(session.processModel); xml = generate_bpmn(session.processModel); summary = build_process_summary(session); document = build_final_document(session, validation)
    session.outputs.bpmnXml, session.outputs.summary, session.outputs.document, session.updatedAt = xml, summary, document, now()
    return {"bpmnXml": xml, "validation": validation, "summary": summary, "document": document}

