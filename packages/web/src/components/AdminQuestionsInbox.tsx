import { useState } from "react";
import { api, type Session } from "../api";

/**
 * User-facing inbox: shows questions an admin posed on this session and lets the
 * user answer them. The session id is the capability, so no login is needed.
 */
export function AdminQuestionsInbox({
  session,
  onAnswered,
}: {
  session: Session;
  onAnswered: () => void;
}) {
  const pending = session.adminQuestions.filter((q) => q.status === "pending");
  if (pending.length === 0) return null;
  return (
    <div className="admin-inbox">
      <div className="admin-inbox-head">
        📩 پرسش از سوی بازبین ({pending.length})
      </div>
      {pending.map((q) => (
        <QuestionItem key={q.id} sessionId={session.id} qid={q.id} question={q.question} onAnswered={onAnswered} />
      ))}
    </div>
  );
}

function QuestionItem({
  sessionId,
  qid,
  question,
  onAnswered,
}: {
  sessionId: string;
  qid: string;
  question: string;
  onAnswered: () => void;
}) {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    const a = answer.trim();
    if (!a) return;
    setBusy(true);
    setError(null);
    try {
      await api.answerQuestion(sessionId, qid, a);
      onAnswered();
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطای ناشناخته");
      setBusy(false);
    }
  };

  return (
    <div className="admin-inbox-item">
      <p className="admin-inbox-q">{question}</p>
      <div className="admin-inbox-answer">
        <textarea
          rows={2}
          value={answer}
          placeholder="پاسخ شما…"
          onChange={(e) => setAnswer(e.target.value)}
        />
        <button className="btn" onClick={send} disabled={busy || !answer.trim()}>
          ارسال پاسخ
        </button>
      </div>
      {error && <p className="login-error">⚠️ {error}</p>}
    </div>
  );
}
