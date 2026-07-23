import type { Session } from "../api";

export function RolesPanel({ session }: { session: Session }) {
  if (session.roles.length === 0) return <Empty text="هنوز نقشی استخراج نشده است." />;
  return (
    <ul className="cards">
      {session.roles.map((r) => (
        <li key={r.id} className="card">
          <strong>{r.name}</strong> <span className="tag">{r.type}</span>
          {r.description && <p>{r.description}</p>}
        </li>
      ))}
    </ul>
  );
}

export function RulesPanel({ session }: { session: Session }) {
  const explicit = session.businessRules.filter((r) => r.kind === "explicit");
  const implicit = session.businessRules.filter((r) => r.kind === "implicit");
  if (explicit.length + implicit.length === 0)
    return <Empty text="هنوز قانونی استخراج نشده است." />;
  return (
    <div>
      <h4>قوانین کسب‌وکار</h4>
      <ul className="cards">
        {explicit.map((r) => (
          <li key={r.id} className="card">
            {r.statement}
          </li>
        ))}
        {explicit.length === 0 && <Empty text="—" />}
      </ul>
      <h4>قوانین ضمنی پیشنهادی</h4>
      <ul className="cards">
        {implicit.map((r) => (
          <li key={r.id} className="card">
            {r.confirmed ? "✅ " : "⏳ "}
            {r.statement}
            {r.rationale && <p className="muted">دلیل: {r.rationale}</p>}
          </li>
        ))}
        {implicit.length === 0 && <Empty text="—" />}
      </ul>
    </div>
  );
}

export function AnalysisPanel({ session }: { session: Session }) {
  const amb = session.ambiguities;
  const con = session.contradictions;
  if (amb.length + con.length === 0)
    return <Empty text="ابهام یا تناقضی ثبت نشده است." />;
  return (
    <div>
      <h4>ابهام‌ها</h4>
      <ul className="cards">
        {amb.map((a) => (
          <li key={a.id} className="card">
            {a.status === "resolved" ? "✅ " : "❓ "}
            {a.description}
            <p className="muted">{a.question}</p>
          </li>
        ))}
        {amb.length === 0 && <Empty text="—" />}
      </ul>
      <h4>تناقض‌ها</h4>
      <ul className="cards">
        {con.map((c) => (
          <li key={c.id} className="card">
            <span className={`tag sev-${c.severity}`}>{c.severity}</span> {c.description}
            <p className="muted">راهکار: {c.suggestedResolution}</p>
          </li>
        ))}
        {con.length === 0 && <Empty text="—" />}
      </ul>
    </div>
  );
}

const KIND_LABELS: Record<string, string> = {
  bpmn_guideline: "اصول BPMN",
  validation: "اعتبارسنجی",
  domain: "دانش دامنه",
  glossary: "واژه‌نامه",
  "learned-from-feedback": "دانش آموخته",
  other: "سایر",
};

/** Distinct knowledge sources that grounded this analysis (retrieval provenance). */
export function SourcesPanel({ session }: { session: Session }) {
  const citations = session.citations ?? [];
  if (citations.length === 0) return null;
  const byDoc = new Map<string, { title: string; kind: string }>();
  for (const c of citations) byDoc.set(c.docId, { title: c.docTitle, kind: c.kind });
  return (
    <div className="sources">
      <h4>دانش استفاده‌شده در این تحلیل</h4>
      <ul className="cards">
        {[...byDoc.entries()].map(([docId, d]) => (
          <li key={docId} className="card sources-item">
            <span className="tag">{KIND_LABELS[d.kind] ?? d.kind}</span> {d.title}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DocumentPanel({ session }: { session: Session }) {
  const doc = session.outputs.document;
  if (!doc) {
    return (
      <div>
        <SourcesPanel session={session} />
        <Empty text="مستند نهایی پس از تکمیل تحلیل آماده می‌شود." />
      </div>
    );
  }
  return (
    <div>
      <div className="doc-actions">
        <a href={`/api/sessions/${session.id}/document`} download="process.md" className="btn">
          دانلود مستند (.md)
        </a>
        <a href={`/api/sessions/${session.id}/bpmn`} download="process.bpmn" className="btn">
          دانلود BPMN (.bpmn)
        </a>
      </div>
      <pre className="document">{doc}</pre>
      <SourcesPanel session={session} />
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="muted empty">{text}</p>;
}
