import type { ProcessModel } from "../schemas/process-model.js";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Deterministic structural validation of a logical model. Complements the
 * LLM Reviewer agent (soft, guideline-based) with hard correctness checks.
 */
export function validateModel(model: ProcessModel): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const nodeIds = new Set<string>();
  const dup = new Set<string>();
  const allNodes = [
    ...model.startEvents,
    ...model.endEvents,
    ...model.intermediateEvents,
    ...model.activities,
    ...model.gateways,
  ];
  for (const n of allNodes) {
    if (nodeIds.has(n.id)) dup.add(n.id);
    nodeIds.add(n.id);
  }
  if (dup.size) errors.push(`شناسه‌های تکراری: ${[...dup].join(", ")}`);

  if (model.startEvents.length === 0) errors.push("هیچ رویداد شروعی وجود ندارد.");
  if (model.endEvents.length === 0) errors.push("هیچ رویداد پایانی وجود ندارد.");

  const hasIncoming = new Set<string>();
  const hasOutgoing = new Set<string>();
  for (const f of model.sequenceFlows) {
    if (!nodeIds.has(f.sourceRef)) errors.push(`جریان ${f.id}: مبدأ نامعتبر «${f.sourceRef}».`);
    if (!nodeIds.has(f.targetRef)) errors.push(`جریان ${f.id}: مقصد نامعتبر «${f.targetRef}».`);
    hasOutgoing.add(f.sourceRef);
    hasIncoming.add(f.targetRef);
  }

  for (const s of model.startEvents)
    if (!hasOutgoing.has(s.id)) errors.push(`رویداد شروع «${s.id}» جریان خروجی ندارد.`);
  for (const e of model.endEvents)
    if (!hasIncoming.has(e.id)) errors.push(`رویداد پایان «${e.id}» جریان ورودی ندارد.`);

  for (const a of model.activities) {
    if (!hasIncoming.has(a.id)) warnings.push(`فعالیت «${a.name}» جریان ورودی ندارد.`);
    if (!hasOutgoing.has(a.id)) warnings.push(`فعالیت «${a.name}» جریان خروجی ندارد.`);
  }
  for (const g of model.gateways) {
    const inc = model.sequenceFlows.filter((f) => f.targetRef === g.id).length;
    const out = model.sequenceFlows.filter((f) => f.sourceRef === g.id).length;
    if (inc === 0 || out === 0) warnings.push(`گیت‌وی «${g.id}» اتصال ناقص دارد.`);
    if (g.type === "exclusive" && out > 1) {
      const branches = model.sequenceFlows.filter((f) => f.sourceRef === g.id);
      if (branches.some((f) => !f.condition && !f.name))
        warnings.push(`گیت‌وی انحصاری «${g.id}» شاخهٔ بدون شرط دارد.`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
