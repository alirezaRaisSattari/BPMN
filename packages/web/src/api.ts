export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  at: string;
}
export interface Role {
  id: string;
  name: string;
  type: string;
  description?: string;
}
export interface Requirement {
  id: string;
  category: string;
  statement: string;
  confirmed: boolean;
}
export interface BusinessRule {
  id: string;
  statement: string;
  kind: "explicit" | "implicit";
  rationale?: string;
  confirmed: boolean;
}
export interface Ambiguity {
  id: string;
  description: string;
  question: string;
  status: string;
}
export interface Contradiction {
  id: string;
  description: string;
  suggestedResolution: string;
  severity: string;
  status: string;
}
export interface Session {
  id: string;
  phase: string;
  request: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  roles: Role[];
  requirements: Requirement[];
  businessRules: BusinessRule[];
  ambiguities: Ambiguity[];
  contradictions: Contradiction[];
  processModel?: { name: string; activities: unknown[]; gateways: unknown[] };
  outputs: { bpmnXml?: string; summary?: string; document?: string };
}
export interface TurnResponse {
  reply: string;
  awaitingUser: boolean;
  session: Session;
}
export interface SessionSummary {
  id: string;
  request: string;
  phase: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

async function del<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: "DELETE" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

/** Live turn events streamed from the server over SSE. */
export interface StreamHandlers {
  onCreated?: (session: Session) => void;
  onPhase?: (phase: string) => void;
  onDelta?: (text: string) => void;
  onDone?: (data: { session: Session; reply: string; awaitingUser: boolean }) => void;
  onError?: (message: string) => void;
}

function dispatchSSE(frame: string, h: StreamHandlers): void {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return;
  let data: any;
  try {
    data = JSON.parse(dataLines.join("\n"));
  } catch {
    return;
  }
  switch (event) {
    case "created":
      h.onCreated?.(data.session);
      break;
    case "phase":
      h.onPhase?.(data.phase);
      break;
    case "delta":
      h.onDelta?.(data.text);
      break;
    case "done":
      h.onDone?.(data);
      break;
    case "error":
      h.onError?.(data.error);
      break;
  }
}

async function streamSSE(url: string, body: unknown, h: StreamHandlers): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    let msg = `HTTP ${res.status}`;
    try {
      msg = (await res.json()).error ?? msg;
    } catch {
      // non-JSON error body; keep the status message
    }
    h.onError?.(msg);
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    // SSE frames are separated by a blank line.
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      dispatchSSE(buffer.slice(0, sep), h);
      buffer = buffer.slice(sep + 2);
    }
  }
  if (buffer.trim()) dispatchSSE(buffer, h);
}

export const api = {
  createSession: (request: string) => post<TurnResponse>("/api/sessions", { request }),
  sendMessage: (id: string, message: string) =>
    post<TurnResponse>(`/api/sessions/${id}/messages`, { message }),
  streamCreate: (request: string, h: StreamHandlers) =>
    streamSSE("/api/sessions/stream", { request }, h),
  streamMessage: (id: string, message: string, h: StreamHandlers) =>
    streamSSE(`/api/sessions/${id}/messages/stream`, { message }, h),
  listSessions: () => get<{ sessions: SessionSummary[] }>("/api/sessions"),
  getSession: (id: string) => get<{ session: Session }>(`/api/sessions/${id}`),
  deleteSession: (id: string) => del<{ ok: true }>(`/api/sessions/${id}`),
  bpmnUrl: (id: string) => `/api/sessions/${id}/bpmn`,
  documentUrl: (id: string) => `/api/sessions/${id}/document`,
};
