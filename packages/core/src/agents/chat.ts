import type { LLMMessage } from "../llm/index.js";
import type { SessionState } from "../schemas/session.js";

/** Map recent session messages to LLM messages (drops system/meta lines). */
export function recentChat(session: SessionState, limit = 12): LLMMessage[] {
  const msgs = session.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-limit)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  // Ensure there is at least one user turn for the model to respond to.
  if (msgs.length === 0 && session.request) {
    return [{ role: "user", content: session.request }];
  }
  return msgs;
}
