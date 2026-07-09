import type { SessionState } from "../schemas/session.js";
import type { ValidationResult } from "../bpmn/validator.js";

function section(title: string, lines: string[]): string {
  const body = lines.length ? lines.map((l) => `- ${l}`).join("\n") : "- (موردی ثبت نشده)";
  return `## ${title}\n\n${body}\n`;
}

/** Short human summary of the process (template-based, no LLM cost). */
export function buildProcessSummary(session: SessionState): string {
  const m = session.processModel;
  const roles = session.roles.map((r) => r.name).join("، ") || "—";
  if (!m) return `فرآیند «${session.request}» — نقش‌ها: ${roles}.`;
  return [
    `فرآیند «${m.name || session.request}» شامل ${m.activities.length} فعالیت،`,
    `${m.gateways.length} نقطهٔ تصمیم و ${session.roles.length} نقش (${roles}) است.`,
    `${m.startEvents.length} رویداد شروع و ${m.endEvents.length} رویداد پایان دارد.`,
  ].join(" ");
}

/** Assemble the final process documentation as Markdown. */
export function buildFinalDocument(
  session: SessionState,
  validation?: ValidationResult,
): string {
  const explicit = session.businessRules.filter((r) => r.kind === "explicit");
  const implicit = session.businessRules.filter((r) => r.kind === "implicit");
  const resolvedAmbiguities = session.ambiguities.filter((a) => a.status === "resolved");
  const parts: string[] = [];

  parts.push(`# مستند فرآیند: ${session.processModel?.name || session.request}\n`);
  parts.push(`> ${buildProcessSummary(session)}\n`);

  parts.push(section("نقش‌ها (Actors)", session.roles.map((r) => `${r.name} (${r.type})`)));
  parts.push(
    section(
      "فعالیت‌های اصلی",
      (session.processModel?.activities ?? []).map(
        (a) => `${a.name}${a.lane ? ` — نقش: ${laneName(session, a.lane)}` : ""} [${a.type}]`,
      ),
    ),
  );
  parts.push(section("قوانین کسب‌وکار", explicit.map((r) => r.statement)));
  parts.push(
    section(
      "قوانین ضمنی پیشنهادی/تأییدشده",
      implicit.map((r) => `${r.statement}${r.confirmed ? " ✓" : " (در انتظار تأیید)"}`),
    ),
  );
  parts.push(section("ابهام‌های برطرف‌شده", resolvedAmbiguities.map((a) => a.description)));
  parts.push(
    section(
      "تناقض‌های شناسایی‌شده",
      session.contradictions.map(
        (c) => `${c.description} — راهکار: ${c.suggestedResolution} (${c.status})`,
      ),
    ),
  );

  if (validation) {
    const v = [
      `وضعیت اعتبارسنجی ساختاری: ${validation.valid ? "معتبر ✅" : "دارای خطا ❌"}`,
      ...validation.errors.map((e) => `خطا: ${e}`),
      ...validation.warnings.map((w) => `هشدار: ${w}`),
    ];
    parts.push(section("اعتبارسنجی مدل", v));
  }

  parts.push("## خروجی BPMN\n\nمدل استاندارد BPMN 2.0 در فایل `process.bpmn` ذخیره شده و در ابزارهای BPMN قابل باز شدن است.\n");
  return parts.join("\n");
}

function laneName(session: SessionState, laneId: string): string {
  return session.processModel?.lanes.find((l) => l.id === laneId)?.name ?? laneId;
}
