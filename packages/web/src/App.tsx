import { useState } from "react";
import { api, type Session } from "./api";
import { Chat } from "./components/Chat";
import { BpmnViewer } from "./components/BpmnViewer";
import { RolesPanel, RulesPanel, AnalysisPanel, DocumentPanel } from "./components/Panels";

type Tab = "diagram" | "roles" | "rules" | "analysis" | "document";

const PHASE_LABELS: Record<string, string> = {
  intake: "دریافت درخواست",
  elicitation: "استخراج نیازمندی",
  actors: "شناسایی نقش‌ها",
  business_rules: "قوانین کسب‌وکار",
  implicit_knowledge: "دانش ضمنی",
  ambiguity: "رفع ابهام",
  contradiction: "رفع تناقض",
  logical_model: "مدل منطقی",
  bpmn_generation: "تولید BPMN",
  outputs: "خروجی‌ها",
  done: "تکمیل شد",
};

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [awaiting, setAwaiting] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("diagram");

  const send = async (text: string) => {
    setLoading(true);
    setError(null);
    // optimistic user bubble
    setSession((prev) =>
      prev
        ? { ...prev, messages: [...prev.messages, { role: "user", content: text, at: "" }] }
        : prev,
    );
    try {
      const res = session
        ? await api.sendMessage(session.id, text)
        : await api.createSession(text);
      setSession(res.session);
      setAwaiting(res.awaitingUser);
      if (res.session.outputs.bpmnXml) setTab("diagram");
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطای ناشناخته");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <header>
        <h1>🎓 تحلیل‌گر هوشمند BPMN</h1>
        <span className="subtitle">دستیار تحلیل فرآیندهای سامانه‌های دانشگاهی</span>
        {session && <span className="phase">مرحله: {PHASE_LABELS[session.phase] ?? session.phase}</span>}
      </header>

      {error && <div className="error">⚠️ {error}</div>}

      <main>
        <section className="left">
          <Chat
            messages={session?.messages ?? []}
            awaiting={awaiting}
            loading={loading}
            started={!!session}
            onSend={send}
          />
        </section>

        <section className="right">
          <nav className="tabs">
            <button className={tab === "diagram" ? "on" : ""} onClick={() => setTab("diagram")}>
              نمودار BPMN
            </button>
            <button className={tab === "roles" ? "on" : ""} onClick={() => setTab("roles")}>
              نقش‌ها {session?.roles.length ? `(${session.roles.length})` : ""}
            </button>
            <button className={tab === "rules" ? "on" : ""} onClick={() => setTab("rules")}>
              قوانین {session?.businessRules.length ? `(${session.businessRules.length})` : ""}
            </button>
            <button className={tab === "analysis" ? "on" : ""} onClick={() => setTab("analysis")}>
              ابهام/تناقض
            </button>
            <button className={tab === "document" ? "on" : ""} onClick={() => setTab("document")}>
              مستند
            </button>
          </nav>
          <div className="tab-body">
            {tab === "diagram" && <BpmnViewer xml={session?.outputs.bpmnXml} />}
            {tab === "roles" && session && <RolesPanel session={session} />}
            {tab === "rules" && session && <RulesPanel session={session} />}
            {tab === "analysis" && session && <AnalysisPanel session={session} />}
            {tab === "document" && session && <DocumentPanel session={session} />}
            {!session && tab !== "diagram" && <p className="muted empty">ابتدا یک تحلیل را شروع کنید.</p>}
          </div>
        </section>
      </main>
    </div>
  );
}
