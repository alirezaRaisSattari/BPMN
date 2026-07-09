import { useEffect, useRef, useState } from "react";
import { api, type Session, type SessionSummary } from "./api";
import { Chat } from "./components/Chat";
import { BpmnViewer } from "./components/BpmnViewer";
import { RolesPanel, RulesPanel, AnalysisPanel, DocumentPanel } from "./components/Panels";
import { SessionSidebar } from "./components/SessionSidebar";
import { PHASE_LABELS } from "./phases";

type Tab = "diagram" | "roles" | "rules" | "analysis" | "document";

const NEW_SESSION_KEY = "__new__";

/** A local, id-less session so the chat can render the user's turn before the
 *  server has created the real session. Replaced by the server's `done` payload. */
function makePlaceholder(request: string, at: string): Session {
  return {
    id: "",
    phase: "elicitation",
    request,
    createdAt: at,
    updatedAt: at,
    messages: [{ role: "user", content: request, at }],
    roles: [],
    requirements: [],
    businessRules: [],
    ambiguities: [],
    contradictions: [],
    outputs: {},
  };
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [awaiting, setAwaiting] = useState(true);
  // ids (or NEW_SESSION_KEY) that currently have a reply in flight — lets us keep
  // replies going in the background while the user browses other sessions.
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());
  // live streaming state per session key: the assistant text streamed so far and
  // the current phase. Kept per-key so background replies keep progressing.
  const [streams, setStreams] = useState<Record<string, { text: string; phase?: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("diagram");

  // mirrors which session the user is currently looking at; updated synchronously
  // (unlike state) so in-flight requests can tell whether they're still relevant.
  const activeKeyRef = useRef<string>(NEW_SESSION_KEY);

  const isLoading = pendingKeys.has(activeKeyRef.current);
  const activeStream = streams[activeKeyRef.current];

  const refreshSessions = async () => {
    try {
      const res = await api.listSessions();
      setSessions(res.sessions);
    } catch {
      // sidebar list is a convenience; ignore transient failures
    }
  };

  useEffect(() => {
    refreshSessions();
  }, []);

  const startNew = () => {
    activeKeyRef.current = NEW_SESSION_KEY;
    setSession(null);
    setAwaiting(true);
    setError(null);
    setTab("diagram");
  };

  const deleteSession = async (id: string) => {
    if (!window.confirm("این جلسه حذف شود؟ این عمل قابل بازگشت نیست.")) return;
    // optimistic removal from the list
    setSessions((prev) => prev.filter((s) => s.id !== id));
    // if we're viewing the session being deleted, reset to the new-session view
    if (activeKeyRef.current === id) startNew();
    try {
      await api.deleteSession(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطای ناشناخته");
      refreshSessions(); // restore the list if the delete failed
    }
  };

  const openSession = async (id: string) => {
    if (id === activeKeyRef.current) return;
    activeKeyRef.current = id;
    setError(null);
    try {
      const res = await api.getSession(id);
      if (activeKeyRef.current !== id) return; // user browsed elsewhere before this resolved
      setSession(res.session);
      setAwaiting(res.session.phase !== "done");
      setTab("diagram");
    } catch (e) {
      if (activeKeyRef.current === id) setError(e instanceof Error ? e.message : "خطای ناشناخته");
    }
  };

  const finishStream = (key: string) => {
    setPendingKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setStreams((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const send = async (text: string) => {
    // `key` starts as NEW_SESSION_KEY for a fresh session and is reassigned to the
    // real id once the server emits `created`. Closures below read it lazily.
    let key = activeKeyRef.current;
    const isNew = key === NEW_SESSION_KEY;
    const sessionId = isNew ? undefined : key;
    const now = new Date().toISOString();

    setError(null);
    setPendingKeys((prev) => new Set(prev).add(key));
    setStreams((prev) => ({ ...prev, [key]: { text: "" } }));

    // optimistic user bubble
    if (isNew) {
      setSession(makePlaceholder(text, now));
    } else {
      setSession((prev) =>
        prev && prev.id === sessionId
          ? { ...prev, messages: [...prev.messages, { role: "user", content: text, at: now }] }
          : prev,
      );
    }

    const handlers = {
      onCreated: (s: Session) => {
        if (isNew) {
          const realId = s.id;
          setPendingKeys((prev) => {
            const next = new Set(prev);
            next.delete(key);
            next.add(realId);
            return next;
          });
          setStreams((prev) => {
            const next = { ...prev };
            next[realId] = prev[key] ?? { text: "" };
            delete next[key];
            return next;
          });
          if (activeKeyRef.current === key) activeKeyRef.current = realId;
          setSession((prev) => (prev && prev.id === "" ? { ...prev, id: realId } : prev));
          key = realId;
        }
        refreshSessions();
      },
      onPhase: (phase: string) =>
        setStreams((prev) => ({ ...prev, [key]: { ...prev[key], phase } })),
      onDelta: (t: string) =>
        setStreams((prev) => ({
          ...prev,
          [key]: { ...prev[key], text: (prev[key]?.text ?? "") + t },
        })),
      onDone: ({ session: full, awaitingUser }: { session: Session; awaitingUser: boolean }) => {
        if (activeKeyRef.current === key) {
          setSession(full);
          setAwaiting(awaitingUser);
          if (full.outputs.bpmnXml) setTab("diagram");
        }
        finishStream(key);
        refreshSessions();
      },
      onError: (msg: string) => {
        if (activeKeyRef.current === key) setError(msg);
        finishStream(key);
        refreshSessions();
      },
    };

    try {
      if (isNew) await api.streamCreate(text, handlers);
      else await api.streamMessage(sessionId!, text, handlers);
    } catch (e) {
      if (activeKeyRef.current === key) setError(e instanceof Error ? e.message : "خطای ناشناخته");
      finishStream(key);
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
        <SessionSidebar
          sessions={sessions}
          activeId={session?.id}
          pendingIds={pendingKeys}
          onNew={startNew}
          onSelect={openSession}
          onDelete={deleteSession}
        />

        <section className="left">
          <Chat
            messages={session?.messages ?? []}
            awaiting={awaiting}
            loading={isLoading}
            started={!!session}
            onSend={send}
            streamingText={activeStream?.text}
            statusLabel={
              activeStream?.phase
                ? `در حال ${PHASE_LABELS[activeStream.phase] ?? activeStream.phase}…`
                : undefined
            }
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
