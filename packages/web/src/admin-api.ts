/** Client for the token-guarded admin API (feedback → knowledge curation). */

export type CandidateStatus = "pending" | "accepted" | "rejected";

export interface SimilarChunk {
  chunkId: string;
  docTitle: string;
  text: string;
  score: number;
  conflict: boolean;
  conflictReason: string;
}

export interface KnowledgeCandidate {
  id: string;
  statement: string;
  rationale: string;
  kind: string;
  tags: string[];
  status: CandidateStatus;
  similar: SimilarChunk[];
  createdAt: string;
  decidedAt?: string;
}

export interface AdminFeedback {
  id: string;
  sessionId: string;
  sessionRequest: string;
  text: string;
  createdAt: string;
  extractionError?: string;
  candidates: KnowledgeCandidate[];
}

export interface LearnedEntry {
  id: string;
  feedbackId: string;
  sessionId: string;
  kind: string;
  text: string;
  tags: string[];
  weight: number;
  createdAt: string;
  /** Server-computed: how many sessions cited this entry. */
  usageCount?: number;
}

export interface KnowledgeChunkInfo {
  id: string;
  docId: string;
  docTitle: string;
  kind: string;
  text: string;
  tags: string[];
  source: "markdown" | "learned";
  disabled: boolean;
  usageCount: number;
  helpfulCount: number;
  irrelevantCount: number;
  sessions: string[];
}

export interface KnowledgeGap {
  query: string;
  count: number;
  worstScore: number;
  lastAt: string;
  phases: string[];
}

export interface AdminStats {
  candidates: {
    pending: number;
    accepted: number;
    rejected: number;
    byKind: Record<string, number>;
  };
  sessions: { total: number; withFeedback: number; withCorrection: number };
  learned: { total: number; byKind: Record<string, number>; reinforcements: number };
  behavior: number;
  examples: number;
  topTags: Array<{ tag: string; count: number }>;
}

export type BehaviorAgent =
  | "elicitation"
  | "actors"
  | "business_rules"
  | "implicit"
  | "ambiguity"
  | "contradiction"
  | "logical_model";

export interface BehaviorEntry {
  id: string;
  agent: BehaviorAgent;
  instruction: string;
  weight: number;
  createdAt: string;
}

export interface ExampleEntry {
  id: string;
  sessionId: string;
  request: string;
  note: string;
  createdAt: string;
  processModel: { name: string; activities: unknown[]; gateways: unknown[]; lanes: unknown[] };
}

export interface EvalExpectation {
  bpmnValid: boolean;
  minRoles: number;
  minActivities: number;
  mustHaveRejectionPath: boolean;
  expectedRoles: string[];
}
export interface EvalCase {
  id: string;
  sessionId: string;
  request: string;
  note: string;
  expected: EvalExpectation;
  createdAt: string;
}
export interface EvalCheck {
  label: string;
  passed: boolean;
  detail: string;
}
export interface EvalResult {
  caseId: string;
  request: string;
  passed: boolean;
  checks: EvalCheck[];
  error?: string;
}

const TOKEN_KEY = "bpmn-admin-token";

export function getAdminToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? "";
}
export function setAdminToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearAdminToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  // Only send Content-Type when a JSON body exists.
  const headers: Record<string, string> = { "x-admin-token": getAdminToken() };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

export const adminApi = {
  ping: () => request<{ ok: true }>("GET", "/api/admin/ping"),
  listFeedback: () => request<{ feedback: AdminFeedback[] }>("GET", "/api/admin/feedback"),
  submitFeedback: (sessionId: string, text: string) =>
    request<{ feedback: AdminFeedback }>("POST", `/api/admin/sessions/${sessionId}/feedback`, {
      text,
    }),
  deleteFeedback: (id: string) => request<{ ok: true }>("DELETE", `/api/admin/feedback/${id}`),
  acceptCandidate: (
    feedbackId: string,
    candidateId: string,
    edits: {
      statement?: string;
      kind?: string;
      tags?: string[];
      destination?: "knowledge" | "behavior";
      agent?: string;
    },
  ) =>
    request<{ feedback: AdminFeedback; entry?: LearnedEntry; behavior?: BehaviorEntry }>(
      "POST",
      `/api/admin/feedback/${feedbackId}/candidates/${candidateId}/accept`,
      edits,
    ),
  rejectCandidate: (feedbackId: string, candidateId: string) =>
    request<{ feedback: AdminFeedback }>(
      "POST",
      `/api/admin/feedback/${feedbackId}/candidates/${candidateId}/reject`,
      {},
    ),
  listLearned: () => request<{ entries: LearnedEntry[] }>("GET", "/api/admin/learned"),
  addLearned: (statement: string, kind: string, tags: string[]) =>
    request<{ entry: LearnedEntry; reinforced: boolean }>("POST", "/api/admin/learned", {
      statement,
      kind,
      tags,
    }),
  editLearned: (id: string, patch: { text?: string; kind?: string; tags?: string[] }) =>
    request<{ entry: LearnedEntry }>("PATCH", `/api/admin/learned/${id}`, patch),
  deleteLearned: (id: string) => request<{ ok: true }>("DELETE", `/api/admin/learned/${id}`),

  // Knowledge dashboard
  listKnowledge: () =>
    request<{ chunks: KnowledgeChunkInfo[] }>("GET", "/api/admin/knowledge"),
  knowledgeGaps: () => request<{ gaps: KnowledgeGap[] }>("GET", "/api/admin/knowledge/gaps"),
  disableChunk: (id: string) =>
    request<{ ok: true; disabled: boolean }>("POST", `/api/admin/knowledge/${encodeURIComponent(id)}/disable`, {}),
  enableChunk: (id: string) =>
    request<{ ok: true; disabled: boolean }>("POST", `/api/admin/knowledge/${encodeURIComponent(id)}/enable`, {}),
  flagCitation: (sessionId: string, chunkId: string, helpful: boolean | null) =>
    request<{ citation: unknown }>(
      "POST",
      `/api/admin/sessions/${sessionId}/citations/${encodeURIComponent(chunkId)}/flag`,
      { helpful },
    ),

  stats: () => request<AdminStats>("GET", "/api/admin/stats"),

  learnFromCorrection: (sessionId: string) =>
    request<{ feedback: AdminFeedback; description: string }>(
      "POST",
      `/api/admin/sessions/${sessionId}/correction/learn`,
    ),

  // Golden example bank
  listExamples: () => request<{ examples: ExampleEntry[] }>("GET", "/api/admin/examples"),
  promoteExample: (sessionId: string, note: string) =>
    request<{ example: ExampleEntry }>("POST", "/api/admin/examples", { sessionId, note }),
  deleteExample: (id: string) => request<{ ok: true }>("DELETE", `/api/admin/examples/${id}`),

  // Behavioral instructions
  listBehavior: () =>
    request<{ entries: BehaviorEntry[]; agents: BehaviorAgent[] }>("GET", "/api/admin/behavior"),
  addBehavior: (agent: string, instruction: string) =>
    request<{ entry: BehaviorEntry; reinforced: boolean }>("POST", "/api/admin/behavior", {
      agent,
      instruction,
    }),
  editBehavior: (id: string, patch: { agent?: string; instruction?: string }) =>
    request<{ entry: BehaviorEntry }>("PATCH", `/api/admin/behavior/${id}`, patch),
  deleteBehavior: (id: string) => request<{ ok: true }>("DELETE", `/api/admin/behavior/${id}`),

  askUser: (sessionId: string, question: string) =>
    request<{ question: unknown }>("POST", `/api/admin/sessions/${sessionId}/questions`, {
      question,
    }),
  learnFromAnswer: (sessionId: string, questionId: string) =>
    request<{ feedback: AdminFeedback }>(
      "POST",
      `/api/admin/sessions/${sessionId}/questions/${questionId}/learn`,
    ),
  saveCorrection: (sessionId: string, bpmnXml: string, note: string) =>
    request<{ correction: unknown }>("POST", `/api/admin/sessions/${sessionId}/correction`, {
      bpmnXml,
      note,
    }),

  listEval: () => request<{ cases: EvalCase[] }>("GET", "/api/admin/eval"),
  createEval: (sessionId: string, note: string, expected?: Partial<EvalExpectation>) =>
    request<{ case: EvalCase }>("POST", "/api/admin/eval", { sessionId, note, expected }),
  deleteEval: (id: string) => request<{ ok: true }>("DELETE", `/api/admin/eval/${id}`),
  runEval: () =>
    request<{ results: EvalResult[]; passed: number; total: number }>("POST", "/api/admin/eval/run"),
};
