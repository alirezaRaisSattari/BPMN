from __future__ import annotations

from .bpmn import generate_bpmn, validate_model
from .models import EvalCase, EvalCheck, EvalResult, Session

REJECTION_WORDS = ["رد", "عدم", "بازگشت", "اصلاح", "reject", "deny", "return"]

def run_eval_case(case: EvalCase, session: Session) -> EvalResult:
    model = session.processModel
    if not model: return EvalResult(caseId=case.id, request=case.request, passed=False,
        checks=[EvalCheck(label="process model exists", passed=False, detail="session has no processModel")], error="no process model")
    checks: list[EvalCheck] = []; expected = case.expected
    if expected.bpmnValid:
        validation = validate_model(model); checks.append(EvalCheck(label="BPMN ساختاری معتبر", passed=bool(validation["valid"]), detail="" if validation["valid"] else " | ".join(validation["errors"])))
        try: generate_bpmn(model); checks.append(EvalCheck(label="تولید BPMN بدون خطا", passed=True))
        except Exception as exc: checks.append(EvalCheck(label="تولید BPMN بدون خطا", passed=False, detail=str(exc)))
    if expected.minRoles > 0: checks.append(EvalCheck(label=f"حداقل {expected.minRoles} نقش", passed=len(session.roles) >= expected.minRoles, detail=f"{len(session.roles)} نقش"))
    if expected.minActivities > 0: checks.append(EvalCheck(label=f"حداقل {expected.minActivities} فعالیت", passed=len(model.activities) >= expected.minActivities, detail=f"{len(model.activities)} فعالیت"))
    if expected.mustHaveRejectionPath:
        branches = [x for x in model.sequenceFlows if any(g.type == "exclusive" and g.id == x.sourceRef for g in model.gateways)]
        found = any(any(word in f"{x.name or ''} {x.condition or ''}".lower() for word in REJECTION_WORDS) for x in branches)
        checks.append(EvalCheck(label="مسیر رد/بازگشت مدل شده", passed=found, detail="" if found else "هیچ شاخهٔ رد روی گیت‌وی انحصاری یافت نشد"))
    for role in expected.expectedRoles:
        found = any(role.lower() in x.name.lower() for x in session.roles); checks.append(EvalCheck(label=f"نقش «{role}» حاضر", passed=found))
    return EvalResult(caseId=case.id, request=case.request, passed=all(x.passed for x in checks), checks=checks)
