import { useEffect, useMemo, useState } from "react";
import { api, type Session, type SessionSummary } from "../api";
import {
  adminApi,
  setAdminToken,
  clearAdminToken,
  type AdminFeedback,
  type AdminStats,
  type BehaviorEntry,
  type EvalCase,
  type EvalResult,
  type ExampleEntry,
  type KnowledgeCandidate,
  type KnowledgeChunkInfo,
  type KnowledgeGap,
  type LearnedEntry,
} from "../admin-api";
import { BpmnViewer } from "./BpmnViewer";
import { PHASE_LABELS } from "../phases";

type AdminTab =
  | "sessions"
  | "queue"
  | "learned"
  | "knowledge"
  | "stats"
  | "examples"
  | "behavior"
  | "eval";

const KIND_LABELS: Record<string, string> = {
  bpmn_guideline: "اصول BPMN",
  validation: "اعتبارسنجی",
  domain: "دانش دامنه",
  glossary: "واژه‌نامه",
  other: "سایر",
};

const AGENT_LABELS: Record<string, string> = {
  elicitation: "استخراج نیازمندی",
  actors: "شناسایی نقش‌ها",
  business_rules: "قوانین کسب‌وکار",
  implicit: "دانش ضمنی",
  ambiguity: "ابهام‌ها",
  contradiction: "تناقض‌ها",
  logical_model: "مدل منطقی",
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export function AdminPage() {
  const [auth, setAuth] = useState<"checking" | "login" | "ok">("checking");
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<AdminTab>("sessions");

  const [feedback, setFeedback] = useState<AdminFeedback[]>([]);
  const [learned, setLearned] = useState<LearnedEntry[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [evalCases, setEvalCases] = useState<EvalCase[]>([]);
  // Which session (if any) is open in the review view — lifted here so switching
  // to the sessions tab always returns to the list.
  const [reviewId, setReviewId] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const [fb, ln, ss, ev] = await Promise.all([
        adminApi.listFeedback(),
        adminApi.listLearned(),
        api.listSessions(),
        adminApi.listEval(),
      ]);
      setFeedback(fb.feedback);
      setLearned(ln.entries);
      setSessions(ss.sessions);
      setEvalCases(ev.cases);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطای ناشناخته");
    }
  };

  useEffect(() => {
    (async () => {
      try {
        await adminApi.ping();
        setAuth("ok");
      } catch {
        setAuth("login");
      }
    })();
  }, []);

  useEffect(() => {
    if (auth === "ok") refresh();
  }, [auth]);

  const pendingCount = useMemo(
    () =>
      feedback.reduce(
        (n, f) => n + f.candidates.filter((c) => c.status === "pending").length,
        0,
      ),
    [feedback],
  );

  if (auth === "checking") return <p className="muted empty admin-pad">در حال بررسی دسترسی…</p>;
  if (auth === "login") return <LoginGate onSuccess={() => setAuth("ok")} />;

  return (
    <div className="admin">
      <nav className="tabs">
        <button
          className={tab === "sessions" ? "on" : ""}
          onClick={() => {
            setTab("sessions");
            setReviewId(null); // clicking the tab always returns to the list
          }}
        >
          جلسات {sessions.length ? `(${sessions.length})` : ""}
        </button>
        <button className={tab === "queue" ? "on" : ""} onClick={() => setTab("queue")}>
          صف بررسی {pendingCount ? `(${pendingCount})` : ""}
        </button>
        <button className={tab === "learned" ? "on" : ""} onClick={() => setTab("learned")}>
          دانش آموخته {learned.length ? `(${learned.length})` : ""}
        </button>
        <button className={tab === "knowledge" ? "on" : ""} onClick={() => setTab("knowledge")}>
          پایگاه دانش
        </button>
        <button className={tab === "behavior" ? "on" : ""} onClick={() => setTab("behavior")}>
          رفتار عامل‌ها
        </button>
        <button className={tab === "examples" ? "on" : ""} onClick={() => setTab("examples")}>
          نمونه‌ها
        </button>
        <button className={tab === "stats" ? "on" : ""} onClick={() => setTab("stats")}>
          آمار
        </button>
        <button className={tab === "eval" ? "on" : ""} onClick={() => setTab("eval")}>
          ارزیابی {evalCases.length ? `(${evalCases.length})` : ""}
        </button>
        <button
          className="admin-logout"
          title="خروج از پنل ادمین"
          onClick={() => {
            clearAdminToken();
            setAuth("login");
          }}
        >
          خروج
        </button>
      </nav>
      {error && <div className="error">⚠️ {error}</div>}
      <div className="tab-body">
        {tab === "sessions" && (
          <SessionsTab
            sessions={sessions}
            feedback={feedback}
            activeId={reviewId}
            onOpen={setReviewId}
            onChanged={refresh}
          />
        )}
        {tab === "queue" && <QueueTab feedback={feedback} onChanged={refresh} />}
        {tab === "learned" && <LearnedTab entries={learned} onChanged={refresh} />}
        {tab === "knowledge" && (
          <KnowledgeTab
            onOpenSession={(id) => {
              setReviewId(id);
              setTab("sessions");
            }}
          />
        )}
        {tab === "behavior" && <BehaviorTab />}
        {tab === "examples" && <ExamplesTab />}
        {tab === "stats" && <StatsTab />}
        {tab === "eval" && <EvalTab cases={evalCases} onChanged={refresh} />}
      </div>
    </div>
  );
}

function LoginGate({ onSuccess }: { onSuccess: () => void }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const login = async () => {
    setBusy(true);
    setError(null);
    setAdminToken(token.trim());
    try {
      await adminApi.ping();
      onSuccess();
    } catch (e) {
      clearAdminToken();
      setError(e instanceof Error ? e.message : "توکن نامعتبر است");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-box">
      <h3>ورود به پنل ادمین</h3>
      <p className="muted">توکن ادمین (ADMIN_TOKEN) را وارد کنید.</p>
      <input
        type="password"
        value={token}
        placeholder="توکن ادمین"
        onChange={(e) => setToken(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && login()}
      />
      <button className="btn" onClick={login} disabled={busy}>
        {busy ? "در حال بررسی…" : "ورود"}
      </button>
      {error && <p className="login-error">⚠️ {error}</p>}
    </div>
  );
}

/* ---------------- sessions ---------------- */

function SessionsTab({
  sessions,
  feedback,
  activeId,
  onOpen,
  onChanged,
}: {
  sessions: SessionSummary[];
  feedback: AdminFeedback[];
  activeId: string | null;
  onOpen: (id: string | null) => void;
  onChanged: () => void;
}) {
  if (activeId) {
    return (
      <SessionReview
        id={activeId}
        feedback={feedback.filter((f) => f.sessionId === activeId)}
        onBack={() => onOpen(null)}
        onChanged={onChanged}
      />
    );
  }

  if (sessions.length === 0) return <p className="muted empty">هنوز جلسه‌ای ثبت نشده است.</p>;
  return (
    <ul className="cards">
      {sessions.map((s) => {
        const count = feedback.filter((f) => f.sessionId === s.id).length;
        return (
          <li key={s.id} className="card admin-session" onClick={() => onOpen(s.id)}>
            <strong>{s.request || "بدون عنوان"}</strong>
            <p className="muted">
              <span className="tag">{PHASE_LABELS[s.phase] ?? s.phase}</span>{" "}
              {formatDate(s.updatedAt)} — {s.messageCount} پیام
              {count > 0 && <> — {count} بازخورد</>}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

function SessionReview({
  id,
  feedback,
  onBack,
  onChanged,
}: {
  id: string;
  feedback: AdminFeedback[];
  onBack: () => void;
  onChanged: () => void;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<AdminFeedback | null>(null);

  const reload = () => {
    api
      .getSession(id)
      .then((r) => setSession(r.session))
      .catch((e) => setError(e instanceof Error ? e.message : "خطای ناشناخته"));
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const submit = async () => {
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    setError(null);
    try {
      const res = await adminApi.submitFeedback(id, t);
      setLastResult(res.feedback);
      setText("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطای ناشناخته");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-review">
      <button className="btn back" onClick={onBack}>
        ← بازگشت به فهرست جلسات
      </button>
      {error && <div className="error">⚠️ {error}</div>}
      {!session && !error && <p className="muted">در حال بارگذاری جلسه…</p>}
      {session && (
        <div className="admin-review-grid">
          <div className="admin-transcript">
            <h4>گفتگو</h4>
            <div className="messages admin-messages">
              {session.messages.map((m, i) => (
                <div key={i} className={`msg ${m.role}`}>
                  <div className="bubble">{m.content}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="admin-output">
            <h4>خروجی BPMN</h4>
            <div className="admin-diagram">
              <BpmnViewer xml={session.outputs.bpmnXml} />
            </div>
            <h4>بازخورد ادمین</h4>
            <textarea
              rows={4}
              value={text}
              placeholder="بازخورد خود را بنویسید… نکات قابل تعمیم به‌صورت خودکار استخراج می‌شوند."
              onChange={(e) => setText(e.target.value)}
            />
            <button className="btn" onClick={submit} disabled={busy || !text.trim()}>
              {busy ? "در حال استخراج نکات…" : "ثبت بازخورد و استخراج نکات"}
            </button>
            {lastResult && (
              <div className="card extraction-result">
                {lastResult.extractionError ? (
                  <p className="muted">
                    بازخورد ذخیره شد اما استخراج نکات ناموفق بود: {lastResult.extractionError}
                  </p>
                ) : lastResult.candidates.length === 0 ? (
                  <p className="muted">بازخورد ذخیره شد؛ نکتهٔ قابل تعمیمی یافت نشد.</p>
                ) : (
                  <p>
                    ✅ بازخورد ذخیره شد و {lastResult.candidates.length} نکتهٔ قابل تعمیم به «صف
                    بررسی» اضافه شد.
                  </p>
                )}
              </div>
            )}
            {feedback.length > 0 && (
              <>
                <h4>بازخوردهای قبلی</h4>
                <ul className="cards">
                  {feedback.map((f) => (
                    <li key={f.id} className="card">
                      {f.text}
                      <p className="muted">
                        {formatDate(f.createdAt)} —{" "}
                        {f.candidates.length
                          ? `${f.candidates.length} نکته (${f.candidates.filter((c) => c.status === "accepted").length} پذیرفته)`
                          : "بدون نکتهٔ استخراج‌شده"}
                      </p>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <AskUserPanel
              session={session}
              onChanged={() => {
                reload();
                onChanged();
              }}
            />
            <CitationsPanel session={session} onChanged={reload} />
            <CorrectionPanel
              session={session}
              onChanged={() => {
                reload();
                onChanged();
              }}
            />
            <PromoteEvalPanel session={session} />
            <PromoteExamplePanel session={session} />
          </div>
        </div>
      )}
    </div>
  );
}

function CitationsPanel({ session, onChanged }: { session: Session; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (session.citations.length === 0) return null;

  const flag = async (chunkId: string, helpful: boolean | null) => {
    setBusy(chunkId);
    setError(null);
    try {
      await adminApi.flagCitation(session.id, chunkId, helpful);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطای ناشناخته");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="citations-panel">
      <h4>دانش استفاده‌شده در این جلسه</h4>
      <p className="muted">
        مفید بودن هر منبع را مشخص کنید. منابعی که زیاد استفاده می‌شوند اما مفید نیستند، در «پایگاه دانش»
        قابل‌ویرایش یا غیرفعال‌سازی‌اند.
      </p>
      {error && <p className="login-error">⚠️ {error}</p>}
      <ul className="cards citations-list">
        {session.citations.map((c) => (
          <li key={c.chunkId} className="card citation-item">
            <span className="tag">{KIND_LABELS[c.kind] ?? c.kind}</span> {c.docTitle}
            <div className="citation-flags">
              <button
                className={`flag ${c.helpful === true ? "on" : ""}`}
                title="مفید بود"
                disabled={busy === c.chunkId}
                onClick={() => flag(c.chunkId, c.helpful === true ? null : true)}
              >
                👍
              </button>
              <button
                className={`flag ${c.helpful === false ? "on" : ""}`}
                title="نامرتبط بود"
                disabled={busy === c.chunkId}
                onClick={() => flag(c.chunkId, c.helpful === false ? null : false)}
              >
                👎
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AskUserPanel({ session, onChanged }: { session: Session; onChanged: () => void }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async () => {
    const text = q.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.askUser(session.id, text);
      setQ("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطای ناشناخته");
    } finally {
      setBusy(false);
    }
  };

  const learn = async (qid: string) => {
    setBusy(true);
    setError(null);
    try {
      await adminApi.learnFromAnswer(session.id, qid);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطای ناشناخته");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ask-user">
      <h4>پرسش از کاربر</h4>
      <p className="muted">
        اگر برای بهبود نیاز به اطلاعاتی دارید که فقط کاربر می‌داند، از او بپرسید. پاسخ در گفتگوی کاربر
        نمایش داده می‌شود و می‌توانید از آن دانش استخراج کنید.
      </p>
      <textarea
        rows={2}
        value={q}
        placeholder="سؤال خود را از کاربر بنویسید…"
        onChange={(e) => setQ(e.target.value)}
      />
      <button className="btn" onClick={ask} disabled={busy || !q.trim()}>
        ارسال سؤال به کاربر
      </button>
      {error && <p className="login-error">⚠️ {error}</p>}
      {session.adminQuestions.length > 0 && (
        <ul className="cards questions">
          {session.adminQuestions.map((qq) => (
            <li key={qq.id} className="card">
              <strong>پرسش:</strong> {qq.question}
              {qq.status === "answered" ? (
                <>
                  <p>
                    <strong>پاسخ کاربر:</strong> {qq.answer}
                  </p>
                  {qq.learnedFeedbackId ? (
                    <p className="muted">✅ از این پاسخ دانش استخراج شد (به صف بررسی بروید).</p>
                  ) : (
                    <button className="btn small" onClick={() => learn(qq.id)} disabled={busy}>
                      استخراج دانش از پاسخ
                    </button>
                  )}
                </>
              ) : (
                <p className="muted">⏳ در انتظار پاسخ کاربر</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CorrectionPanel({ session, onChanged }: { session: Session; onChanged: () => void }) {
  const [xml, setXml] = useState(session.correction?.bpmnXml ?? "");
  const [note, setNote] = useState(session.correction?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await adminApi.saveCorrection(session.id, xml.trim(), note.trim());
      setSaved(true);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطای ناشناخته");
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="correction">
      <summary>
        <h4>اصلاح نمودار (اختیاری)</h4>
      </summary>
      <p className="muted">
        اگر نمودار تولیدشده اشتباه است، BPMN صحیح را اینجا قرار دهید. این «قبل/بعد» بهترین دادهٔ آموزشی
        برای بهبود مدل است.
      </p>
      <textarea
        rows={4}
        value={xml}
        placeholder="<bpmn:definitions …> … </bpmn:definitions>"
        onChange={(e) => setXml(e.target.value)}
        dir="ltr"
      />
      <input
        value={note}
        placeholder="توضیح اصلاح (اختیاری)"
        onChange={(e) => setNote(e.target.value)}
      />
      <button className="btn" onClick={save} disabled={busy || !xml.trim()}>
        ذخیرهٔ نمودار اصلاح‌شده
      </button>
      {saved && <p className="muted">✅ ذخیره شد.</p>}
      {session.correction && !saved && (
        <p className="muted">نسخهٔ اصلاح‌شده در {formatDate(session.correction.at)} ثبت شده است.</p>
      )}
      {error && <p className="login-error">⚠️ {error}</p>}
      {session.correction && <CorrectionLearn session={session} onChanged={onChanged} />}
    </details>
  );
}

function CorrectionLearn({ session, onChanged }: { session: Session; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alreadyLearned = Boolean(session.correction?.learnedFeedbackId);

  const learn = async () => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const res = await adminApi.learnFromCorrection(session.id);
      const n = res.feedback.candidates.length;
      setMsg(
        n > 0
          ? `✅ ${n} نکته از اصلاح استخراج و به «صف بررسی» اضافه شد.`
          : "✅ اصلاح تحلیل شد؛ نکتهٔ قابل‌تعمیمی یافت نشد.",
      );
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطای ناشناخته");
    } finally {
      setBusy(false);
    }
  };

  if (alreadyLearned)
    return <p className="muted">✅ از این اصلاح قبلاً دانش استخراج شده است (به «صف بررسی» بروید).</p>;

  return (
    <div className="correction-learn">
      <p className="muted">
        از تفاوت نمودار تولیدشده و نمودار اصلاح‌شده، یک «درس قابل‌تعمیم» استخراج کنید تا در مدل‌سازی‌های
        بعدی به‌کار رود.
      </p>
      <button className="btn" onClick={learn} disabled={busy}>
        {busy ? "در حال تحلیل اصلاح…" : "استخراج دانش از اصلاح"}
      </button>
      {msg && <p className="muted">{msg}</p>}
      {error && <p className="login-error">⚠️ {error}</p>}
    </div>
  );
}

function PromoteExamplePanel({ session }: { session: Session }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const hasModel = Boolean(session.processModel);

  const promote = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await adminApi.promoteExample(session.id, note.trim());
      setMsg("✅ به‌عنوان نمونهٔ کار ثبت شد (تب نمونه‌ها).");
      setNote("");
    } catch (e) {
      setMsg("⚠️ " + (e instanceof Error ? e.message : "خطای ناشناخته"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="promote-example">
      <h4>ثبت به‌عنوان نمونهٔ کار</h4>
      <p className="muted">
        این جلسه را به‌عنوان «نمونهٔ تأییدشده» ثبت کنید تا در فرآیندهای مشابه آینده، مدل منطقی از روی آن
        الگوبرداری کند.
      </p>
      <input
        value={note}
        placeholder="یادداشت (اختیاری)"
        onChange={(e) => setNote(e.target.value)}
      />
      <button className="btn" onClick={promote} disabled={busy || !hasModel}>
        {hasModel ? "ثبت نمونهٔ کار" : "این جلسه مدلی برای ثبت ندارد"}
      </button>
      {msg && <p className="muted">{msg}</p>}
    </div>
  );
}

function PromoteEvalPanel({ session }: { session: Session }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [rejection, setRejection] = useState(false);

  const promote = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await adminApi.createEval(session.id, "", { mustHaveRejectionPath: rejection });
      setMsg("✅ به‌عنوان کیس ارزیابی ثبت شد (تب ارزیابی).");
    } catch (e) {
      setMsg("⚠️ " + (e instanceof Error ? e.message : "خطای ناشناخته"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="promote-eval">
      <h4>ثبت به‌عنوان کیس ارزیابی</h4>
      <p className="muted">
        این جلسه را به‌عنوان «کیس طلایی» ثبت کنید تا در آینده تغییرات کد باعث افت کیفیت خروجی آن نشود.
      </p>
      <label className="checkbox-label">
        <input type="checkbox" checked={rejection} onChange={(e) => setRejection(e.target.checked)} />
        باید مسیر رد/بازگشت داشته باشد
      </label>
      <button className="btn" onClick={promote} disabled={busy}>
        ثبت کیس ارزیابی
      </button>
      {msg && <p className="muted">{msg}</p>}
    </div>
  );
}

/* ---------------- review queue ---------------- */

function QueueTab({
  feedback,
  onChanged,
}: {
  feedback: AdminFeedback[];
  onChanged: () => void;
}) {
  const pending = feedback.flatMap((f) =>
    f.candidates.filter((c) => c.status === "pending").map((c) => ({ feedback: f, candidate: c })),
  );
  if (pending.length === 0)
    return <p className="muted empty">نکته‌ای در انتظار بررسی نیست. 🎉</p>;
  return (
    <ul className="cards">
      {pending.map(({ feedback: f, candidate: c }) => (
        <CandidateCard key={c.id} feedback={f} candidate={c} onChanged={onChanged} />
      ))}
    </ul>
  );
}

function CandidateCard({
  feedback,
  candidate,
  onChanged,
}: {
  feedback: AdminFeedback;
  candidate: KnowledgeCandidate;
  onChanged: () => void;
}) {
  const [statement, setStatement] = useState(candidate.statement);
  const [kind, setKind] = useState(candidate.kind);
  const [tags, setTags] = useState(candidate.tags.join("، "));
  const [destination, setDestination] = useState<"knowledge" | "behavior">("knowledge");
  const [agent, setAgent] = useState("elicitation");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (action: "accept" | "reject") => {
    setBusy(true);
    setError(null);
    try {
      if (action === "accept") {
        await adminApi.acceptCandidate(feedback.id, candidate.id, {
          statement: statement.trim(),
          kind,
          tags: tags
            .split(/[,،]/)
            .map((t) => t.trim())
            .filter(Boolean),
          destination,
          agent: destination === "behavior" ? agent : undefined,
        });
      } else {
        await adminApi.rejectCandidate(feedback.id, candidate.id);
      }
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطای ناشناخته");
      setBusy(false);
    }
  };

  return (
    <li className="card candidate">
      <textarea
        rows={2}
        value={statement}
        onChange={(e) => setStatement(e.target.value)}
        aria-label="متن نکته"
      />
      {candidate.rationale && <p className="muted">دلیل: {candidate.rationale}</p>}
      <p className="muted candidate-source">
        از بازخورد: «{feedback.text}» — جلسهٔ «{feedback.sessionRequest || feedback.sessionId}»
      </p>
      <div className="candidate-controls">
        <label>
          دسته:
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {Object.entries(KIND_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="tags-label">
          برچسب‌ها:
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="با ویرگول جدا کنید"
          />
        </label>
      </div>
      {candidate.similar.some((s) => s.conflict) && (
        <div className="conflict-banner">
          ⛔ تناقض با دانش موجود:{" "}
          {candidate.similar.find((s) => s.conflict)?.conflictReason || "این نکته با یک قاعدهٔ موجود در تضاد است."}
        </div>
      )}
      {candidate.similar.length > 0 && (
        <details className="similar">
          <summary>
            {candidate.similar.some((s) => s.conflict) ? "⛔" : "⚠️"} دانش مشابه موجود (
            {candidate.similar.length})
          </summary>
          <ul>
            {candidate.similar.map((s) => (
              <li key={s.chunkId} className={s.conflict ? "conflict" : ""}>
                {s.conflict && <span className="tag sev-high">تناقض</span>}{" "}
                <span className="tag">{s.docTitle}</span> {s.text.slice(0, 220)}
                {s.text.length > 220 ? "…" : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="candidate-destination">
        <label>
          مقصد:
          <select
            value={destination}
            onChange={(e) => setDestination(e.target.value as "knowledge" | "behavior")}
          >
            <option value="knowledge">دانش (RAG)</option>
            <option value="behavior">رفتار یک عامل</option>
          </select>
        </label>
        {destination === "behavior" && (
          <label>
            عامل:
            <select value={agent} onChange={(e) => setAgent(e.target.value)}>
              {Object.entries(AGENT_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {destination === "behavior" && (
        <p className="muted">
          به‌عنوان «دستور رفتاری» به system prompt این عامل افزوده می‌شود و در همهٔ جلسات اعمال می‌شود.
        </p>
      )}
      {error && <p className="login-error">⚠️ {error}</p>}
      <div className="candidate-actions">
        <button className="btn" onClick={() => act("accept")} disabled={busy || !statement.trim()}>
          {destination === "behavior" ? "✅ افزودن به رفتار عامل" : "✅ پذیرش و افزودن به دانش"}
        </button>
        <button className="btn danger" onClick={() => act("reject")} disabled={busy}>
          ✖ رد
        </button>
      </div>
    </li>
  );
}

/* ---------------- learned knowledge ---------------- */

function LearnedTab({ entries, onChanged }: { entries: LearnedEntry[]; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);

  const remove = async (id: string) => {
    if (!window.confirm("این مورد از پایگاه دانش حذف شود؟")) return;
    try {
      await adminApi.deleteLearned(id);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطای ناشناخته");
    }
  };

  return (
    <div>
      {error && <div className="error">⚠️ {error}</div>}
      <ManualLearnedForm onChanged={onChanged} />
      {entries.length === 0 ? (
        <p className="muted empty">هنوز دانشی افزوده نشده است.</p>
      ) : (
        <ul className="cards">
          {entries.map((e) => (
            <LearnedItem key={e.id} entry={e} onChanged={onChanged} onRemove={() => remove(e.id)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ManualLearnedForm({ onChanged }: { onChanged: () => void }) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState("domain");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.addLearned(
        t,
        kind,
        tags.split(/[,،]/).map((x) => x.trim()).filter(Boolean),
      );
      setText("");
      setTags("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطای ناشناخته");
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="manual-add">
      <summary>
        <h4>افزودن دستی دانش</h4>
      </summary>
      <p className="muted">
        دانشی که مستقیماً وارد می‌کنید در لایهٔ «دانش آموخته» ذخیره می‌شود و با بازسازی ایندکس پایه از بین
        نمی‌رود.
      </p>
      <textarea
        rows={2}
        value={text}
        placeholder="یک قاعده یا اصطلاح روشن بنویسید…"
        onChange={(e) => setText(e.target.value)}
      />
      <div className="candidate-controls">
        <label>
          دسته:
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {Object.entries(KIND_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="tags-label">
          برچسب‌ها:
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="با ویرگول جدا کنید" />
        </label>
      </div>
      <button className="btn" onClick={add} disabled={busy || !text.trim()}>
        افزودن به دانش
      </button>
      {error && <p className="login-error">⚠️ {error}</p>}
    </details>
  );
}

function LearnedItem({
  entry,
  onChanged,
  onRemove,
}: {
  entry: LearnedEntry;
  onChanged: () => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(entry.text);
  const [kind, setKind] = useState(entry.kind);
  const [tags, setTags] = useState(entry.tags.join("، "));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await adminApi.editLearned(entry.id, {
        text: text.trim(),
        kind,
        tags: tags.split(/[,،]/).map((t) => t.trim()).filter(Boolean),
      });
      setEditing(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطای ناشناخته");
    } finally {
      setBusy(false);
    }
  };

  if (editing)
    return (
      <li className="card">
        <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="candidate-controls">
          <label>
            دسته:
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {Object.entries(KIND_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="tags-label">
            برچسب‌ها:
            <input value={tags} onChange={(e) => setTags(e.target.value)} />
          </label>
        </div>
        {error && <p className="login-error">⚠️ {error}</p>}
        <div className="candidate-actions">
          <button className="btn" onClick={save} disabled={busy || !text.trim()}>
            ذخیره
          </button>
          <button className="btn danger" onClick={() => setEditing(false)} disabled={busy}>
            انصراف
          </button>
        </div>
      </li>
    );

  return (
    <li className="card">
      {entry.text}
      <p className="muted">
        <span className="tag">{KIND_LABELS[entry.kind] ?? entry.kind}</span>{" "}
        {entry.weight > 1 && <span className="tag weight">⭐ {entry.weight}× تأیید</span>}{" "}
        <span className="tag usage">استفاده در {entry.usageCount ?? 0} جلسه</span>{" "}
        {entry.tags.map((t) => (
          <span key={t} className="tag">
            {t}
          </span>
        ))}{" "}
        {formatDate(entry.createdAt)}
        <button className="learned-delete" title="ویرایش" onClick={() => setEditing(true)}>
          ✏️
        </button>
        <button className="learned-delete" title="حذف از پایگاه دانش" onClick={onRemove}>
          🗑
        </button>
      </p>
    </li>
  );
}

/* ---------------- evaluation ---------------- */

function EvalTab({ cases, onChanged }: { cases: EvalCase[]; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<EvalResult[] | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await adminApi.runEval();
      setResults(res.results);
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطای ناشناخته");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm("این کیس ارزیابی حذف شود؟")) return;
    try {
      await adminApi.deleteEval(id);
      setResults(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطای ناشناخته");
    }
  };

  const passed = results ? results.filter((r) => r.passed).length : 0;

  return (
    <div>
      {error && <div className="error">⚠️ {error}</div>}
      <div className="eval-actions">
        <button className="btn" onClick={run} disabled={busy || cases.length === 0}>
          {busy ? "در حال اجرا…" : "▶ اجرای همهٔ ارزیابی‌ها"}
        </button>
        {results && (
          <span className={passed === results.length ? "eval-pass" : "eval-fail"}>
            {passed}/{results.length} کیس موفق
          </span>
        )}
      </div>
      {cases.length === 0 && (
        <p className="muted empty">
          هنوز کیس ارزیابی ثبت نشده است. از تب «جلسات» یک جلسه را باز کنید و آن را به‌عنوان کیس ثبت کنید.
        </p>
      )}
      <ul className="cards">
        {cases.map((c) => {
          const result = results?.find((r) => r.caseId === c.id);
          return (
            <li key={c.id} className="card">
              <div className="eval-head">
                <strong>{c.request || c.id}</strong>
                {result && (
                  <span className={result.passed ? "eval-pass" : "eval-fail"}>
                    {result.passed ? "✓ موفق" : "✖ ناموفق"}
                  </span>
                )}
                <button className="learned-delete" title="حذف" onClick={() => remove(c.id)}>
                  🗑
                </button>
              </div>
              <p className="muted">
                انتظار: BPMN معتبر={c.expected.bpmnValid ? "بله" : "خیر"} · حداقل نقش=
                {c.expected.minRoles} · حداقل فعالیت={c.expected.minActivities}
                {c.expected.mustHaveRejectionPath ? " · مسیر رد لازم" : ""}
              </p>
              {result && (
                <ul className="eval-checks">
                  {result.checks.map((ch, i) => (
                    <li key={i} className={ch.passed ? "ok" : "bad"}>
                      {ch.passed ? "✓" : "✖"} {ch.label}
                      {ch.detail ? ` — ${ch.detail}` : ""}
                    </li>
                  ))}
                  {result.error && <li className="bad">خطا: {result.error}</li>}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ---------------- knowledge dashboard ---------------- */

function KnowledgeTab({ onOpenSession }: { onOpenSession: (id: string) => void }) {
  const [chunks, setChunks] = useState<KnowledgeChunkInfo[]>([]);
  const [gaps, setGaps] = useState<KnowledgeGap[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [k, g] = await Promise.all([adminApi.listKnowledge(), adminApi.knowledgeGaps()]);
      setChunks(k.chunks);
      setGaps(g.gaps);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطای ناشناخته");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const toggle = async (c: KnowledgeChunkInfo) => {
    try {
      if (c.disabled) await adminApi.enableChunk(c.id);
      else await adminApi.disableChunk(c.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطای ناشناخته");
    }
  };

  const filtered = chunks.filter(
    (c) => !q.trim() || (c.text + c.docTitle).toLowerCase().includes(q.trim().toLowerCase()),
  );

  if (loading) return <p className="muted empty">در حال بارگذاری پایگاه دانش…</p>;

  return (
    <div className="knowledge-dash">
      {error && <div className="error">⚠️ {error}</div>}

      {gaps.length > 0 && (
        <div className="gaps">
          <h4>شکاف‌های دانش ({gaps.length})</h4>
          <p className="muted">
            پرس‌وجوهایی که پایگاه دانش نتوانست پاسخ خوبی برایشان پیدا کند. اسنادی دربارهٔ این موضوع‌ها
            اضافه کنید.
          </p>
          <ul className="cards">
            {gaps.slice(0, 20).map((g, i) => (
              <li key={i} className="card gap-item">
                <span className="tag sev-high">{g.count}× تکرار</span> {g.query}
                <p className="muted">
                  بیشترین امتیاز: {g.worstScore.toFixed(2)} · فازها:{" "}
                  {g.phases.map((p) => PHASE_LABELS[p] ?? p).join("، ")}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="knowledge-head">
        <h4>همهٔ داده‌های دانش ({chunks.length})</h4>
        <input
          value={q}
          placeholder="جست‌وجو در متن دانش…"
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <ul className="cards">
        {filtered.map((c) => (
          <li key={c.id} className={`card knowledge-item ${c.disabled ? "disabled" : ""}`}>
            <div className="knowledge-badges">
              <span className={`tag ${c.source === "learned" ? "weight" : ""}`}>
                {c.source === "learned" ? "آموخته" : "سند پایه"}
              </span>{" "}
              <span className="tag">{KIND_LABELS[c.kind] ?? c.kind}</span>{" "}
              <span className="tag usage">{c.usageCount} استفاده</span>{" "}
              {c.helpfulCount > 0 && <span className="tag ok-tag">👍 {c.helpfulCount}</span>}{" "}
              {c.irrelevantCount > 0 && <span className="tag bad-tag">👎 {c.irrelevantCount}</span>}{" "}
              {c.disabled && <span className="tag sev-high">غیرفعال</span>}
            </div>
            <p className="knowledge-text">
              <strong>{c.docTitle}</strong> — {c.text.slice(0, 300)}
              {c.text.length > 300 ? "…" : ""}
            </p>
            {c.sessions.length > 0 && (
              <p className="muted knowledge-trace">
                استفاده در:{" "}
                {c.sessions.slice(0, 8).map((sid) => (
                  <button key={sid} className="link-btn" onClick={() => onOpenSession(sid)}>
                    {sid.slice(0, 8)}
                  </button>
                ))}
              </p>
            )}
            <button className="btn small" onClick={() => toggle(c)}>
              {c.disabled ? "فعال‌سازی" : "غیرفعال‌سازی"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------------- behavioral instructions ---------------- */

function BehaviorTab() {
  const [entries, setEntries] = useState<BehaviorEntry[]>([]);
  const [agent, setAgent] = useState("elicitation");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await adminApi.listBehavior();
      setEntries(res.entries);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطای ناشناخته");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const add = async () => {
    const t = instruction.trim();
    if (!t) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.addBehavior(agent, t);
      setInstruction("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطای ناشناخته");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm("این دستور رفتاری حذف شود؟")) return;
    try {
      await adminApi.deleteBehavior(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطای ناشناخته");
    }
  };

  if (loading) return <p className="muted empty">در حال بارگذاری…</p>;

  const byAgent = (a: string) => entries.filter((e) => e.agent === a);

  return (
    <div className="behavior-tab">
      {error && <div className="error">⚠️ {error}</div>}
      <div className="behavior-add">
        <h4>افزودن دستور رفتاری</h4>
        <p className="muted">
          دستوری که به system prompt یک عامل افزوده می‌شود و در همهٔ جلسات اعمال می‌شود (برخلاف دانش RAG
          که فقط هنگام بازیابی ظاهر می‌شود).
        </p>
        <label>
          عامل:
          <select value={agent} onChange={(e) => setAgent(e.target.value)}>
            {Object.entries(AGENT_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <textarea
          rows={2}
          value={instruction}
          placeholder="مثال: همیشه دربارهٔ مسیرهای استثنا و خطا سؤال کن."
          onChange={(e) => setInstruction(e.target.value)}
        />
        <button className="btn" onClick={add} disabled={busy || !instruction.trim()}>
          افزودن
        </button>
      </div>

      {Object.keys(AGENT_LABELS).map((a) => {
        const items = byAgent(a);
        if (items.length === 0) return null;
        return (
          <div key={a} className="behavior-group">
            <h4>{AGENT_LABELS[a]}</h4>
            <ul className="cards">
              {items.map((e) => (
                <li key={e.id} className="card">
                  {e.instruction}
                  <p className="muted">
                    {e.weight > 1 && <span className="tag weight">⭐ {e.weight}× تأیید</span>}{" "}
                    {formatDate(e.createdAt)}
                    <button className="learned-delete" title="حذف" onClick={() => remove(e.id)}>
                      🗑
                    </button>
                  </p>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {entries.length === 0 && <p className="muted empty">هنوز دستور رفتاری‌ای ثبت نشده است.</p>}
    </div>
  );
}

/* ---------------- example bank ---------------- */

function ExamplesTab() {
  const [examples, setExamples] = useState<ExampleEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await adminApi.listExamples();
      setExamples(res.examples);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطای ناشناخته");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const remove = async (id: string) => {
    if (!window.confirm("این نمونه حذف شود؟")) return;
    try {
      await adminApi.deleteExample(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطای ناشناخته");
    }
  };

  if (loading) return <p className="muted empty">در حال بارگذاری…</p>;

  return (
    <div>
      {error && <div className="error">⚠️ {error}</div>}
      <p className="muted">
        نمونه‌های تأییدشدهٔ کار. هنگام ساخت مدل منطقی، نزدیک‌ترین نمونه (بر اساس شباهت درخواست) به‌عنوان
        الگو به عامل نشان داده می‌شود.
      </p>
      {examples.length === 0 ? (
        <p className="muted empty">
          هنوز نمونه‌ای ثبت نشده است. از تب «جلسات» یک جلسه را باز کنید و آن را به‌عنوان نمونه ثبت کنید.
        </p>
      ) : (
        <ul className="cards">
          {examples.map((e) => (
            <li key={e.id} className="card">
              <strong>{e.request || e.id}</strong>
              <p className="muted">
                <span className="tag">{e.processModel.name}</span>{" "}
                <span className="tag usage">{e.processModel.activities.length} فعالیت</span>{" "}
                {e.note && <span className="tag">{e.note}</span>} {formatDate(e.createdAt)}
                <button className="learned-delete" title="حذف نمونه" onClick={() => remove(e.id)}>
                  🗑
                </button>
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------------- stats ---------------- */

function StatsTab() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminApi
      .stats()
      .then(setStats)
      .catch((e) => setError(e instanceof Error ? e.message : "خطای ناشناخته"));
  }, []);

  if (error) return <div className="error">⚠️ {error}</div>;
  if (!stats) return <p className="muted empty">در حال بارگذاری آمار…</p>;

  const c = stats.candidates;
  return (
    <div className="stats-tab">
      <div className="stat-cards">
        <StatCard label="نکات پذیرفته‌شده" value={c.accepted} />
        <StatCard label="در انتظار بررسی" value={c.pending} />
        <StatCard label="رد شده" value={c.rejected} />
        <StatCard label="دانش آموخته" value={stats.learned.total} />
        <StatCard label="تقویت‌ها" value={stats.learned.reinforcements} />
        <StatCard label="دستور رفتاری" value={stats.behavior} />
        <StatCard label="نمونهٔ کار" value={stats.examples} />
        <StatCard label="جلسات" value={stats.sessions.total} />
        <StatCard label="جلسات دارای بازخورد" value={stats.sessions.withFeedback} />
        <StatCard label="جلسات دارای اصلاح" value={stats.sessions.withCorrection} />
      </div>

      <div className="stat-breakdown">
        <div>
          <h4>نکات بر اساس دسته</h4>
          <ul className="cards">
            {Object.entries(c.byKind).map(([k, n]) => (
              <li key={k} className="card">
                <span className="tag">{KIND_LABELS[k] ?? k}</span> {n}
              </li>
            ))}
            {Object.keys(c.byKind).length === 0 && <p className="muted">—</p>}
          </ul>
        </div>
        <div>
          <h4>پرتکرارترین برچسب‌ها</h4>
          <ul className="cards">
            {stats.topTags.map((t) => (
              <li key={t.tag} className="card">
                <span className="tag">{t.tag}</span> {t.count}
              </li>
            ))}
            {stats.topTags.length === 0 && <p className="muted">—</p>}
          </ul>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat-card">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
