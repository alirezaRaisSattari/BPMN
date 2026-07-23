import type { LLMProvider } from "../llm/index.js";
import { formatContext, type KnowledgeRetriever } from "../knowledge/index.js";
import type { ChunkFilter } from "../knowledge/store.js";
import type { RetrievalLogEntry, RetrievalResult } from "../schemas/knowledge.js";
import type { BehaviorAgent } from "../schemas/behavior.js";
import type { SessionState } from "../schemas/session.js";
import type { ExampleBank } from "../state/example-store.js";
import type { BehaviorLookup } from "../state/behavior-store.js";

/** Shared dependencies handed to every analysis agent. */
export interface AgentContext {
  llm: LLMProvider;
  retriever?: KnowledgeRetriever;
  /** Called with every retrieval's results + the query — used to record provenance. */
  onRetrieve?: (results: RetrievalResult[], query: string) => void;
  /** Telemetry sink for knowledge-gap analysis (session context filled by the orchestrator). */
  logRetrieval?: (entry: RetrievalLogEntry) => void;
  /** Worked-example lookup for case-based few-shot (logical-model phase). */
  exampleBank?: ExampleBank;
  /** Per-agent behavioral instructions appended to system prompts. */
  behavior?: BehaviorLookup;
}

/** The Business-Analyst persona, specialized for university-system processes. */
export const BA_PERSONA = [
  "شما یک تحلیل‌گر ارشد فرآیندهای کسب‌وکار و متخصص استاندارد BPMN 2.0 هستید.",
  "دامنهٔ کاری شما «فرآیندهای سامانه‌های دانشگاهی» است (ثبت‌نام، انتخاب واحد، مرخصی تحصیلی،",
  "تصویب و دفاع پایان‌نامه، تسویه‌حساب و فارغ‌التحصیلی، وام و خوابگاه و مانند آن).",
  "شما مانند یک تحلیل‌گر خبره در جلسهٔ تحلیل نیازمندی عمل می‌کنید:",
  "- هرگز فرآیند را حدس نمی‌زنید؛ در صورت نقص یا ابهام، سؤال هدفمند می‌پرسید.",
  "- دانش ضمنی و قوانین رایج دامنه را پیشنهاد می‌دهید و تأیید می‌گیرید.",
  "- تناقض‌ها را شناسایی و راهکار پیشنهاد می‌کنید.",
  "پاسخ‌های متنی شما به زبان فارسی، کوتاه، حرفه‌ای و دقیق است.",
].join(" ");

let counter = 0;
/** Short id that satisfies the BPMN identifier rule (^[A-Za-z_][A-Za-z0-9_-]*$). */
export function genId(prefix: string): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}`;
}

function list(items: string[]): string {
  return items.length ? items.map((i) => `  - ${i}`).join("\n") : "  (خالی)";
}

/** Compact digest of everything known so far — injected into agent prompts. */
export function sessionDigest(s: SessionState): string {
  const reqs = s.requirements.map((r) => `[${r.category}] ${r.statement}${r.confirmed ? " ✓" : ""}`);
  const roles = s.roles.map((r) => `${r.name} (${r.type})`);
  const rules = s.businessRules.map((r) => `[${r.kind}] ${r.statement}${r.confirmed ? " ✓" : ""}`);
  const questions = s.openQuestions.filter((q) => !q.answered).map((q) => q.text);
  const ambiguities = s.ambiguities.filter((a) => a.status === "open").map((a) => a.description);
  const contradictions = s.contradictions
    .filter((c) => c.status === "open")
    .map((c) => c.description);

  return [
    `درخواست اولیه: ${s.request || "(نامشخص)"}`,
    `فاز فعلی: ${s.phase}`,
    `نیازمندی‌های استخراج‌شده:\n${list(reqs)}`,
    `نقش‌ها:\n${list(roles)}`,
    `قوانین کسب‌وکار:\n${list(rules)}`,
    `سؤالات باز:\n${list(questions)}`,
    `ابهام‌های باز:\n${list(ambiguities)}`,
    `تناقض‌های باز:\n${list(contradictions)}`,
  ].join("\n\n");
}

/** Fetch grounding context from the knowledge base (safe if no retriever). */
export async function ground(
  ctx: AgentContext,
  query: string,
  k = 4,
  filter?: ChunkFilter,
): Promise<string> {
  if (!ctx.retriever) return "";
  try {
    const results = await ctx.retriever.retrieve(query, k, filter);
    ctx.onRetrieve?.(results, query);
    return formatContext(results);
  } catch {
    return "";
  }
}

/** Wrap grounding text as a labeled block for prompts. */
export function knowledgeBlock(text: string): string {
  return text
    ? `دانش مرجع مرتبط (از پایگاه دانش پروژه):\n"""\n${text}\n"""\n`
    : "";
}

/**
 * Behavioral instructions for one agent, formatted as a prompt block. These are
 * admin-approved rules about how the agent should behave; they apply on every
 * run (unlike RAG knowledge, which only appears when retrieval hits).
 */
export function behaviorBlock(ctx: AgentContext, agent: BehaviorAgent): string {
  const items = ctx.behavior?.instructionsFor(agent) ?? [];
  if (items.length === 0) return "";
  return [
    "دستورهای رفتاری آموخته‌شده (از بازخورد ادمین) — این موارد را در این مرحله رعایت کن:",
    ...items.map((t) => `- ${t}`),
  ].join("\n");
}
