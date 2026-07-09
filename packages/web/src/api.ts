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

export const api = {
  createSession: (request: string) => post<TurnResponse>("/api/sessions", { request }),
  sendMessage: (id: string, message: string) =>
    post<TurnResponse>(`/api/sessions/${id}/messages`, { message }),
  bpmnUrl: (id: string) => `/api/sessions/${id}/bpmn`,
  documentUrl: (id: string) => `/api/sessions/${id}/document`,
};
