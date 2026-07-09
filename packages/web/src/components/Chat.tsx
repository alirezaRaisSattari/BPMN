import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../api";

interface Props {
  messages: ChatMessage[];
  awaiting: boolean;
  loading: boolean;
  started: boolean;
  onSend: (text: string) => void;
  /** Assistant reply streamed so far (SSE); shown as a live-typing bubble. */
  streamingText?: string;
  /** Phase-based status line shown while the assistant works. */
  statusLabel?: string;
}

const SAMPLES = [
  "طراحی فرآیند ثبت‌نام دانشجو",
  "طراحی فرآیند درخواست مرخصی تحصیلی",
  "طراحی فرآیند تسویه‌حساب و فارغ‌التحصیلی",
  "طراحی فرآیند تصویب پروپوزال پایان‌نامه",
];

export function Chat({
  messages,
  awaiting,
  loading,
  started,
  onSend,
  streamingText,
  statusLabel,
}: Props) {
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, loading, streamingText]);

  const submit = () => {
    const t = text.trim();
    if (!t || loading) return;
    onSend(t);
    setText("");
  };

  return (
    <div className="chat">
      <div className="messages">
        {!started && (
          <div className="samples">
            <p>یک درخواست را انتخاب یا تایپ کنید:</p>
            {SAMPLES.map((s) => (
              <button key={s} className="sample" onClick={() => onSend(s)} disabled={loading}>
                {s}
              </button>
            ))}
          </div>
        )}
        {messages
          .filter((m) => m.role !== "system")
          .map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              <div className="bubble">{m.content}</div>
            </div>
          ))}
        {streamingText ? (
          <div className="msg assistant">
            <div className="bubble">
              {streamingText}
              <span className="caret" />
            </div>
          </div>
        ) : (
          loading && (
            <div className="msg assistant">
              <div className="bubble typing">{statusLabel ?? "در حال تحلیل…"}</div>
            </div>
          )
        )}
        <div ref={endRef} />
      </div>

      <div className="composer">
        <textarea
          value={text}
          placeholder={awaiting ? "پاسخ خود را بنویسید…" : "درخواست فرآیند را بنویسید…"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={2}
          disabled={loading}
        />
        <button onClick={submit} disabled={loading || !text.trim()}>
          ارسال
        </button>
      </div>
    </div>
  );
}
