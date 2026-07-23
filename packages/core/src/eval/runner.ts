import { validateModel } from "../bpmn/validator.js";
import { generateBpmn } from "../bpmn/layout.js";
import type { SessionState } from "../schemas/session.js";
import type { EvalCase, EvalCheck, EvalResult } from "../schemas/eval.js";

/** Words that mark a rejection / send-back branch on an exclusive gateway. */
const REJECTION_WORDS = ["رد", "عدم", "بازگشت", "اصلاح", "reject", "deny", "return"];

/**
 * Deterministically evaluate one golden case against its stored session. Reruns
 * the process model through structural validation + BPMN generation and checks
 * the recorded expectations. No LLM — this guards the deterministic pipeline.
 */
export async function runEvalCase(evalCase: EvalCase, session: SessionState): Promise<EvalResult> {
  const checks: EvalCheck[] = [];
  const model = session.processModel;

  if (!model) {
    return {
      caseId: evalCase.id,
      request: evalCase.request,
      passed: false,
      checks: [{ label: "process model exists", passed: false, detail: "session has no processModel" }],
      error: "no process model",
    };
  }

  const exp = evalCase.expected;

  if (exp.bpmnValid) {
    const validation = validateModel(model);
    checks.push({
      label: "BPMN ساختاری معتبر",
      passed: validation.valid,
      detail: validation.valid ? "" : validation.errors.join(" | "),
    });
    // Ensure the model still compiles to XML without throwing.
    try {
      await generateBpmn(model);
      checks.push({ label: "تولید BPMN بدون خطا", passed: true, detail: "" });
    } catch (err) {
      checks.push({
        label: "تولید BPMN بدون خطا",
        passed: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (exp.minRoles > 0) {
    checks.push({
      label: `حداقل ${exp.minRoles} نقش`,
      passed: session.roles.length >= exp.minRoles,
      detail: `${session.roles.length} نقش`,
    });
  }

  if (exp.minActivities > 0) {
    checks.push({
      label: `حداقل ${exp.minActivities} فعالیت`,
      passed: model.activities.length >= exp.minActivities,
      detail: `${model.activities.length} فعالیت`,
    });
  }

  if (exp.mustHaveRejectionPath) {
    const branches = model.sequenceFlows.filter((f) =>
      model.gateways.some((g) => g.type === "exclusive" && g.id === f.sourceRef),
    );
    const has = branches.some((f) => {
      const text = `${f.name ?? ""} ${f.condition ?? ""}`.toLowerCase();
      return REJECTION_WORDS.some((w) => text.includes(w.toLowerCase()));
    });
    checks.push({
      label: "مسیر رد/بازگشت مدل شده",
      passed: has,
      detail: has ? "" : "هیچ شاخهٔ رد روی گیت‌وی انحصاری یافت نشد",
    });
  }

  for (const role of exp.expectedRoles) {
    const needle = role.toLowerCase();
    const found = session.roles.some((r) => r.name.toLowerCase().includes(needle));
    checks.push({ label: `نقش «${role}» حاضر`, passed: found, detail: "" });
  }

  return {
    caseId: evalCase.id,
    request: evalCase.request,
    passed: checks.every((c) => c.passed),
    checks,
  };
}
