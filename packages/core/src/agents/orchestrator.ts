import type { Phase, SessionState } from "../schemas/session.js";
import type { ProcessModel } from "../schemas/process-model.js";
import { AgentContext, genId } from "./base.js";
import { runElicitation } from "./elicitation.js";
import { runActors } from "./actors.js";
import { runBusinessRules } from "./business-rules.js";
import { runImplicit } from "./implicit.js";
import { runAmbiguity } from "./ambiguity.js";
import { runContradiction } from "./contradiction.js";
import { runLogicalModel } from "./logical-model.js";
import { produceOutputs } from "../output/finalize.js";

export interface TurnResult {
  session: SessionState;
  reply: string;
  phase: Phase;
  awaitingUser: boolean;
  processModel?: ProcessModel;
}

/** Called whenever the turn advances to a new phase (for live progress UIs). */
export type ProgressFn = (phase: Phase) => void;

const AFFIRM = [
  "بله", "اره", "آره", "تایید", "تأیید", "موافق", "درسته", "اوکی", "قبول",
  "ادامه", "بساز", "ok", "okay", "yes", "confirm", "proceed",
];
function isAffirmative(text: string): boolean {
  const s = text.toLowerCase();
  return AFFIRM.some((w) => s.includes(w));
}

function addMessage(s: SessionState, role: "user" | "assistant", content: string): void {
  s.messages.push({ role, content, at: new Date().toISOString(), phase: s.phase });
  s.updatedAt = new Date().toISOString();
}

function bullet(items: string[]): string {
  return items.map((i) => `• ${i}`).join("\n");
}

/**
 * Coordinator agent. Drives the multi-phase interview deterministically, calling
 * the specialized agents at their phase and applying their structured results to
 * the session. One LLM call per turn during elicitation; a short cascade at the
 * hand-off points.
 */
export class Orchestrator {
  constructor(private readonly ctx: AgentContext) {}

  /** Start a new analysis from the initial request. */
  async begin(session: SessionState, request: string, onProgress?: ProgressFn): Promise<TurnResult> {
    session.request = request;
    this.setPhase(session, "elicitation", onProgress);
    addMessage(session, "user", request);
    return this.runElicitationTurn(session, onProgress);
  }

  /** Handle a user message according to the current phase. */
  async respond(session: SessionState, userText: string, onProgress?: ProgressFn): Promise<TurnResult> {
    addMessage(session, "user", userText);

    switch (session.phase) {
      case "intake":
      case "elicitation":
        if (isAffirmative(userText) && /(بساز|ادامه|مدل|proceed|بله)/i.test(userText)) {
          return this.startModelingCascade(session, onProgress);
        }
        return this.runElicitationTurn(session, onProgress);
      case "implicit_knowledge":
        return this.handleImplicitConfirmation(session, userText, onProgress);
      case "ambiguity":
        return this.handleAmbiguityPhase(session, onProgress);
      case "contradiction":
        return this.handleContradictionPhase(session, onProgress);
      default:
        return this.result(session, "این مرحله به تعامل بیشتری نیاز ندارد.", false);
    }
  }

  // ---- phase handlers -------------------------------------------------------

  /** Advance the session to a phase and notify any progress listener. */
  private setPhase(session: SessionState, phase: Phase, onProgress?: ProgressFn): void {
    session.phase = phase;
    onProgress?.(phase);
  }

  private async runElicitationTurn(session: SessionState, onProgress?: ProgressFn): Promise<TurnResult> {
    const res = await runElicitation(this.ctx, session);

    for (const r of res.extractedRequirements) {
      session.requirements.push({
        id: genId("req"),
        category: r.category,
        statement: r.statement,
        source: "user",
        confirmed: true,
      });
    }
    session.openQuestions = res.questions.map((q) => ({
      id: genId("q"),
      text: q.text,
      category: q.category,
      rationale: q.rationale,
      answered: false,
    }));

    if (res.readyToModel && res.questions.length === 0) {
      addMessage(session, "assistant", res.assistantMessage);
      return this.startModelingCascade(session, onProgress);
    }

    const reply = [res.assistantMessage, "", bullet(res.questions.map((q) => q.text))]
      .filter(Boolean)
      .join("\n");
    addMessage(session, "assistant", reply);
    return this.result(session, reply, true);
  }

  /** After elicitation: roles → explicit rules → propose implicit rules. */
  private async startModelingCascade(session: SessionState, onProgress?: ProgressFn): Promise<TurnResult> {
    this.setPhase(session, "actors", onProgress);
    const actors = await runActors(this.ctx, session);
    for (const role of actors.roles) {
      if (session.roles.some((r) => r.name === role.name)) continue;
      session.roles.push({ id: genId("role"), name: role.name, type: role.type, description: role.description });
    }

    this.setPhase(session, "business_rules", onProgress);
    const rules = await runBusinessRules(this.ctx, session);
    for (const r of rules.rules) {
      session.businessRules.push({
        id: genId("rule"),
        statement: r.statement,
        kind: "explicit",
        category: r.category,
        rationale: r.rationale,
        source: "user",
        confirmed: true,
      });
    }

    this.setPhase(session, "implicit_knowledge", onProgress);
    const implicit = await runImplicit(this.ctx, session);
    const added = implicit.implicitRules.map((r) => {
      const rule = {
        id: genId("rule"),
        statement: r.statement,
        kind: "implicit" as const,
        rationale: r.rationale,
        source: "suggested" as const,
        confirmed: false,
      };
      session.businessRules.push(rule);
      return rule;
    });

    if (added.length === 0) {
      return this.handleAmbiguityPhase(session, onProgress);
    }
    const reply = [
      "بر اساس دانش دامنه، این «قوانین ضمنی» را پیشنهاد می‌کنم که معمولاً لازم‌اند اما ذکر نمی‌شوند:",
      "",
      bullet(added.map((r) => `${r.statement} — دلیل: ${r.rationale}`)),
      "",
      "آیا این موارد را تأیید می‌کنید؟ (بله/خیر یا اصلاحات خود را بگویید)",
    ].join("\n");
    addMessage(session, "assistant", reply);
    return this.result(session, reply, true);
  }

  private async handleImplicitConfirmation(
    session: SessionState,
    userText: string,
    onProgress?: ProgressFn,
  ): Promise<TurnResult> {
    if (isAffirmative(userText)) {
      for (const r of session.businessRules) if (r.kind === "implicit") r.confirmed = true;
      addMessage(session, "assistant", "قوانین ضمنی تأیید شد. حالا ابهام‌ها را بررسی می‌کنم…");
    } else {
      addMessage(session, "assistant", "متوجه شدم؛ نظر شما را لحاظ می‌کنم و ادامه می‌دهم…");
    }
    return this.handleAmbiguityPhase(session, onProgress);
  }

  private async handleAmbiguityPhase(session: SessionState, onProgress?: ProgressFn): Promise<TurnResult> {
    this.setPhase(session, "ambiguity", onProgress);
    const res = await runAmbiguity(this.ctx, session);
    const open = res.ambiguities.filter((a) => a.description.trim());
    if (open.length > 0) {
      session.ambiguities = open.map((a) => ({
        id: genId("amb"),
        description: a.description,
        question: a.question,
        status: "open" as const,
      }));
      const reply = [
        "قبل از نهایی‌سازی، این ابهام‌ها باید روشن شوند:",
        "",
        bullet(open.map((a) => `${a.description}\n   ↳ ${a.question}`)),
      ].join("\n");
      addMessage(session, "assistant", reply);
      return this.result(session, reply, true);
    }
    // mark any previously open ambiguities resolved
    for (const a of session.ambiguities) a.status = "resolved";
    return this.handleContradictionPhase(session, onProgress);
  }

  private async handleContradictionPhase(session: SessionState, onProgress?: ProgressFn): Promise<TurnResult> {
    this.setPhase(session, "contradiction", onProgress);
    const res = await runContradiction(this.ctx, session);
    const open = res.contradictions.filter((c) => c.description.trim());
    if (open.length > 0) {
      session.contradictions = open.map((c) => ({
        id: genId("con"),
        description: c.description,
        conflictingItems: c.conflictingItems,
        severity: c.severity,
        suggestedResolution: c.suggestedResolution,
        status: "open" as const,
      }));
      const reply = [
        "تناقض‌های زیر را شناسایی کردم. لطفاً تعیین تکلیف کنید:",
        "",
        bullet(open.map((c) => `${c.description}\n   ↳ راهکار پیشنهادی: ${c.suggestedResolution}`)),
      ].join("\n");
      addMessage(session, "assistant", reply);
      return this.result(session, reply, true);
    }
    for (const c of session.contradictions) c.status = "resolved";
    return this.buildLogicalModel(session, onProgress);
  }

  private async buildLogicalModel(session: SessionState, onProgress?: ProgressFn): Promise<TurnResult> {
    this.setPhase(session, "logical_model", onProgress);
    const model = await runLogicalModel(this.ctx, session);
    session.processModel = model;

    this.setPhase(session, "bpmn_generation", onProgress);
    const { validation } = await produceOutputs(session);
    this.setPhase(session, "done", onProgress);

    const status = validation.valid
      ? "مدل از نظر ساختاری معتبر است ✅"
      : `مدل دارای ${validation.errors.length} خطای ساختاری است ⚠️`;
    const reply = [
      "مدل منطقی و BPMN 2.0 فرآیند تولید شد ✅",
      `فعالیت‌ها: ${model.activities.length} | گیت‌وی‌ها: ${model.gateways.length} | نقش‌ها: ${session.roles.length}`,
      status,
      "خروجی‌ها آماده‌اند: نمودار BPMN، خلاصهٔ فرآیند و مستند نهایی.",
    ].join("\n");
    addMessage(session, "assistant", reply);
    return this.result(session, reply, false, model);
  }

  private result(
    session: SessionState,
    reply: string,
    awaitingUser: boolean,
    processModel?: ProcessModel,
  ): TurnResult {
    return { session, reply, phase: session.phase, awaitingUser, processModel };
  }
}
