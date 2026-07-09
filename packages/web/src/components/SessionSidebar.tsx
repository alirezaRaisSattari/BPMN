import type { SessionSummary } from "../api";
import { PHASE_LABELS } from "../phases";

interface Props {
  sessions: SessionSummary[];
  activeId?: string;
  pendingIds: Set<string>;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export function SessionSidebar({ sessions, activeId, pendingIds, onNew, onSelect, onDelete }: Props) {
  return (
    <div className="sidebar">
      <button className="btn new-session" onClick={onNew}>
        + جلسه جدید
      </button>
      <div className="session-list">
        {sessions.length === 0 && <p className="muted empty-sidebar">هنوز جلسه‌ای ثبت نشده است.</p>}
        {sessions.map((s) => (
          <div key={s.id} className={`session-item ${s.id === activeId ? "on" : ""}`}>
            <button className="session-open" onClick={() => onSelect(s.id)}>
              <span className="session-title">{s.request || "بدون عنوان"}</span>
              <span className="session-meta">
                <span className="tag">{PHASE_LABELS[s.phase] ?? s.phase}</span>
                <span>{pendingIds.has(s.id) ? "در حال پاسخ…" : formatDate(s.updatedAt)}</span>
              </span>
            </button>
            <button
              className="session-delete"
              title="حذف جلسه"
              aria-label="حذف جلسه"
              onClick={() => onDelete(s.id)}
            >
              🗑
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
