import { randomUUID } from "node:crypto";
import type { FastifyReply } from "fastify";
import {
  knowledgeKinds,
  behaviorAgents,
  learnedToChunk,
  LEARNED_DOC_ID,
  computeGaps,
  runFeedbackExtraction,
  runConflictCheck,
  runCorrectionDiff,
  runEvalCase,
  validateModel,
  type AdminFeedback,
  type AdminQuestion,
  type BehaviorAgent,
  type BehaviorEntry,
  type EvalCase,
  type ExampleEntry,
  type KnowledgeCandidate,
  type KnowledgeKind,
  type LearnedEntry,
  type LearnedSource,
  type SimilarChunk,
} from "@bpmn-analyst/core";
import type { AppContext, ZodApp } from "./app.js";
import {
  IdParams,
  SessionQidParams,
  FeedbackCandidateParams,
  SessionChunkParams,
  FeedbackBody,
  AcceptCandidateBody,
  QuestionBody,
  CorrectionBody,
  ManualLearnedBody,
  LearnedPatchBody,
  FlagBody,
  ExampleBody,
  BehaviorBody,
  BehaviorPatchBody,
  EvalBody,
  type OkResponse,
  type FeedbackListResponse,
  type FeedbackResponse,
  type AcceptCandidateResponse,
  type LearnedListResponse,
  type LearnedEntryResponse,
  type LearnedPatchResponse,
  type KnowledgeListResponse,
  type KnowledgeGapsResponse,
  type ChunkToggleResponse,
  type CitationFlagResponse,
  type QuestionResponse,
  type CorrectionResponse,
  type CorrectionLearnResponse,
  type AdminStatsResponse,
  type ExampleListResponse,
  type ExampleResponse,
  type BehaviorListResponse,
  type BehaviorResponse,
  type BehaviorPatchResponse,
  type EvalListResponse,
  type EvalResponse,
  type EvalRunResponse,
} from "./schemas.js";

/**
 * Snapshot the chunks most similar to a candidate (duplicate/conflict warning).
 * The single most-similar chunk is additionally run through an LLM conflict check
 * so the reviewer can tell a contradiction from a mere overlap.
 */
async function similarChunks(ctx: AppContext, statement: string): Promise<SimilarChunk[]> {
  let results;
  try {
    results = await ctx.retriever.retrieve(statement, 3);
  } catch {
    return [];
  }
  const similar: SimilarChunk[] = results.map((r) => ({
    chunkId: r.chunk.id,
    docTitle: r.chunk.docTitle,
    text: r.chunk.text,
    score: r.score,
    conflict: false,
    conflictReason: "",
  }));
  if (similar[0]) {
    try {
      const check = await runConflictCheck({ llm: ctx.llm }, statement, similar[0].text);
      similar[0].conflict = check.conflict;
      similar[0].conflictReason = check.reason;
    } catch {
      /* conflict check is best-effort; leave defaults */
    }
  }
  return similar;
}

/** Per-chunk usage + usefulness, aggregated across every session's citations. */
interface ChunkUsage {
  usageCount: number;
  helpfulCount: number;
  irrelevantCount: number;
  sessions: string[];
}

/**
 * Walk every session's citations once and tally, per chunk id, how many
 * sessions cited it and how the admin rated those citations. Shared by the
 * learned tab and the knowledge dashboard.
 */
async function citationUsage(ctx: AppContext): Promise<Map<string, ChunkUsage>> {
  const usage = new Map<string, ChunkUsage>();
  const summaries = await ctx.store.list();
  const sessions = await Promise.all(summaries.map((s) => ctx.store.get(s.id)));
  for (const s of sessions) {
    if (!s) continue;
    for (const c of s.citations) {
      let u = usage.get(c.chunkId);
      if (!u) {
        u = { usageCount: 0, helpfulCount: 0, irrelevantCount: 0, sessions: [] };
        usage.set(c.chunkId, u);
      }
      u.usageCount += 1;
      if (c.helpful === true) u.helpfulCount += 1;
      if (c.helpful === false) u.irrelevantCount += 1;
      if (!u.sessions.includes(s.id)) u.sessions.push(s.id);
    }
  }
  return usage;
}

/** Extract knowledge candidates from a piece of text about a session. */
async function extractCandidates(
  ctx: AppContext,
  session: Parameters<AppContext["orchestrator"]["begin"]>[0],
  text: string,
  now: string,
): Promise<{ candidates: KnowledgeCandidate[]; error?: string }> {
  try {
    const extraction = await runFeedbackExtraction(
      { llm: ctx.llm, retriever: ctx.retriever },
      session,
      text,
    );
    const general = extraction.points.filter((p) => p.generalizable);
    const candidates = await Promise.all(
      general.map(
        async (p): Promise<KnowledgeCandidate> => ({
          id: randomUUID(),
          statement: p.statement,
          rationale: p.rationale,
          kind: p.kind,
          tags: p.tags,
          status: "pending",
          similar: await similarChunks(ctx, p.statement),
          createdAt: now,
        }),
      ),
    );
    return { candidates };
  } catch (err) {
    return { candidates: [], error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Admin API: review sessions, submit feedback, curate extracted knowledge
 * candidates, and manage learned knowledge. Guarded by the `x-admin-token`
 * header when ADMIN_TOKEN is set; open (with a warning) otherwise.
 */
export function registerAdminRoutes(app: ZodApp, ctx: AppContext): void {
  const token = (process.env.ADMIN_TOKEN ?? "").trim();
  if (!token) {
    app.log.warn("ADMIN_TOKEN is not set — the admin API is open (dev mode)");
  }

  app.register(
    async (admin: ZodApp) => {
      admin.addHook("preHandler", async (req, reply) => {
        if (token && req.headers["x-admin-token"] !== token) {
          return reply.status(401).send({ error: "invalid admin token" });
        }
      });

      // Token check for the web login gate.
      admin.get("/ping", async (): Promise<OkResponse> => ({ ok: true }));

      admin.get(
        "/feedback",
        async (): Promise<FeedbackListResponse> => ({ feedback: await ctx.feedback.list() }),
      );

      // Submit feedback on a session and extract knowledge candidates from it.
      admin.post(
        "/sessions/:id/feedback",
        { schema: { params: IdParams, body: FeedbackBody } },
        async (req, res): Promise<FeedbackResponse | FastifyReply> => {
          const { text } = req.body;
          const session = await ctx.store.get(req.params.id);
          if (!session) return res.status(404).send({ error: "session not found" });

          const now = new Date().toISOString();
          const { candidates, error } = await extractCandidates(ctx, session, text, now);
          const feedback: AdminFeedback = {
            id: randomUUID(),
            sessionId: session.id,
            sessionRequest: session.request,
            text,
            createdAt: now,
            candidates,
            // Never lose the admin's text because the LLM failed.
            extractionError: error,
          };
          await ctx.feedback.save(feedback);
          return { feedback };
        },
      );

      // Accept a candidate (with optional admin edits) → learned knowledge.
      admin.post(
        "/feedback/:fid/candidates/:cid/accept",
        { schema: { params: FeedbackCandidateParams, body: AcceptCandidateBody } },
        async (req, res): Promise<AcceptCandidateResponse | FastifyReply> => {
          const feedback = await ctx.feedback.get(req.params.fid);
          if (!feedback) return res.status(404).send({ error: "feedback not found" });
          const candidate = feedback.candidates.find((c) => c.id === req.params.cid);
          if (!candidate) return res.status(404).send({ error: "candidate not found" });
          if (candidate.status !== "pending")
            return res.status(409).send({ error: `candidate is already ${candidate.status}` });

          const statement = req.body.statement ?? candidate.statement;
          if (!statement) return res.status(400).send({ error: "statement must not be empty" });
          const kind = req.body.kind ?? candidate.kind;
          const tags = req.body.tags ?? candidate.tags;

          const now = new Date().toISOString();
          candidate.statement = statement;
          candidate.kind = kind as KnowledgeKind;
          candidate.tags = tags;
          candidate.status = "accepted";
          candidate.decidedAt = now;

          const source: LearnedSource = {
            feedbackId: feedback.id,
            sessionId: feedback.sessionId,
            at: now,
          };

          // Behavior destination: the statement is an instruction for one agent's
          // prompt, not RAG knowledge. Reinforce-on-duplicate mirrors learned knowledge.
          if (req.body.destination === "behavior") {
            const agent = req.body.agent;
            if (!agent || !(behaviorAgents as readonly string[]).includes(agent))
              return res.status(400).send({ error: `invalid or missing agent: ${agent}` });
            const existingBehavior = ctx.behavior.findByText(agent as BehaviorAgent, statement);
            if (existingBehavior) {
              const updated = await ctx.behavior.reinforce(existingBehavior.id, source);
              await ctx.feedback.save(feedback);
              return { feedback, behavior: updated, reinforced: true };
            }
            const behaviorEntry: BehaviorEntry = {
              id: `behavior-${candidate.id}`,
              agent: agent as BehaviorAgent,
              instruction: statement,
              weight: 1,
              sources: [source],
              createdAt: now,
            };
            await ctx.behavior.add(behaviorEntry);
            await ctx.feedback.save(feedback);
            return { feedback, behavior: behaviorEntry, reinforced: false };
          }

          // If an identical rule was already learned, reinforce it (weight++)
          // rather than adding a near-duplicate chunk that would dilute retrieval.
          const existing = ctx.learned.findByText(statement);
          if (existing) {
            const updated = await ctx.learned.reinforce(existing.id, source);
            await ctx.feedback.save(feedback);
            return { feedback, entry: updated, reinforced: true };
          }

          const entry: LearnedEntry = {
            id: `learned-${candidate.id}`,
            feedbackId: feedback.id,
            sessionId: feedback.sessionId,
            kind: candidate.kind,
            text: statement,
            tags,
            weight: 1,
            sources: [source],
            createdAt: now,
          };
          await ctx.learned.add(entry);
          await ctx.retriever.addChunks([learnedToChunk(entry)]);
          await ctx.feedback.save(feedback);
          return { feedback, entry, reinforced: false };
        },
      );

      admin.post(
        "/feedback/:fid/candidates/:cid/reject",
        { schema: { params: FeedbackCandidateParams } },
        async (req, res): Promise<FeedbackResponse | FastifyReply> => {
          const feedback = await ctx.feedback.get(req.params.fid);
          if (!feedback) return res.status(404).send({ error: "feedback not found" });
          const candidate = feedback.candidates.find((c) => c.id === req.params.cid);
          if (!candidate) return res.status(404).send({ error: "candidate not found" });
          if (candidate.status !== "pending")
            return res.status(409).send({ error: `candidate is already ${candidate.status}` });

          candidate.status = "rejected";
          candidate.decidedAt = new Date().toISOString();
          await ctx.feedback.save(feedback);
          return { feedback };
        },
      );

      // Deleting feedback keeps already-learned entries (they carry provenance).
      admin.delete(
        "/feedback/:id",
        { schema: { params: IdParams } },
        async (req, res): Promise<OkResponse | FastifyReply> => {
          const removed = await ctx.feedback.remove(req.params.id);
          if (!removed) return res.status(404).send({ error: "feedback not found" });
          return { ok: true };
        },
      );

      // Learned knowledge with reinforcement weight + how many sessions used it.
      admin.get("/learned", async (): Promise<LearnedListResponse> => {
        const usage = await citationUsage(ctx);
        return {
          entries: ctx.learned
            .list()
            .map((e) => ({ ...e, usageCount: usage.get(e.id)?.usageCount ?? 0 })),
        };
      });

      // Manually add a learned entry (skips extraction) — survives index rebuilds
      // because learned knowledge is a separate layer, not part of the markdown corpus.
      admin.post(
        "/learned",
        { schema: { body: ManualLearnedBody } },
        async (req): Promise<LearnedEntryResponse> => {
          const { kind, tags } = req.body;
          const text = req.body.statement;

          const now = new Date().toISOString();
          const existing = ctx.learned.findByText(text);
          if (existing) {
            // existing was just resolved from the same store, so it must still be there.
            const updated = (await ctx.learned.reinforce(existing.id, {
              feedbackId: "manual",
              sessionId: "manual",
              at: now,
            }))!;
            return { entry: updated, reinforced: true };
          }
          const entry: LearnedEntry = {
            id: `learned-manual-${randomUUID()}`,
            feedbackId: "manual",
            sessionId: "manual",
            kind: kind as KnowledgeKind,
            text,
            tags,
            weight: 1,
            sources: [{ feedbackId: "manual", sessionId: "manual", at: now }],
            createdAt: now,
          };
          await ctx.learned.add(entry);
          await ctx.retriever.addChunks([learnedToChunk(entry)]);
          return { entry, reinforced: false };
        },
      );

      // Edit a learned entry, refreshing its live chunk (remove + re-add).
      admin.patch(
        "/learned/:id",
        { schema: { params: IdParams, body: LearnedPatchBody } },
        async (req, res): Promise<LearnedPatchResponse | FastifyReply> => {
          const entry = ctx.learned.get(req.params.id);
          if (!entry) return res.status(404).send({ error: "learned entry not found" });
          if (req.body.text !== undefined) entry.text = req.body.text;
          if (req.body.kind !== undefined) entry.kind = req.body.kind as KnowledgeKind;
          if (req.body.tags !== undefined) entry.tags = req.body.tags;
          await ctx.learned.save();
          ctx.retriever.removeChunk(entry.id);
          await ctx.retriever.addChunks([learnedToChunk(entry)]);
          return { entry };
        },
      );

      admin.delete(
        "/learned/:id",
        { schema: { params: IdParams } },
        async (req, res): Promise<OkResponse | FastifyReply> => {
          const removed = await ctx.learned.remove(req.params.id);
          if (!removed) return res.status(404).send({ error: "learned entry not found" });
          ctx.retriever.removeChunk(req.params.id);
          return { ok: true };
        },
      );

      // ---- knowledge dashboard: all chunks with usage + usefulness -----------
      admin.get("/knowledge", async (): Promise<KnowledgeListResponse> => {
        const usage = await citationUsage(ctx);
        const chunks = ctx.retriever.allChunks().map((c) => {
          const u = usage.get(c.id);
          return {
            id: c.id,
            docId: c.docId,
            docTitle: c.docTitle,
            kind: c.kind,
            text: c.text,
            tags: c.tags,
            source: c.docId === LEARNED_DOC_ID ? ("learned" as const) : ("markdown" as const),
            disabled: ctx.retriever.isDisabled(c.id),
            usageCount: u?.usageCount ?? 0,
            helpfulCount: u?.helpfulCount ?? 0,
            irrelevantCount: u?.irrelevantCount ?? 0,
            sessions: u?.sessions ?? [],
          };
        });
        // Most-used first so noisy/critical chunks surface at the top.
        chunks.sort((a, b) => b.usageCount - a.usageCount);
        return { chunks };
      });

      // Knowledge gaps: queries the base could not ground (from the retrieval log).
      admin.get("/knowledge/gaps", async (): Promise<KnowledgeGapsResponse> => {
        const entries = await ctx.retrievalLog.read();
        return { gaps: computeGaps(entries) };
      });

      // Disable / enable a chunk (durable via the overrides file).
      admin.post(
        "/knowledge/:id/disable",
        { schema: { params: IdParams } },
        async (req, res): Promise<ChunkToggleResponse | FastifyReply> => {
          if (!ctx.retriever.disable(req.params.id))
            return res.status(404).send({ error: "chunk not found" });
          await ctx.overrides.disable(req.params.id);
          return { ok: true, disabled: true };
        },
      );

      admin.post(
        "/knowledge/:id/enable",
        { schema: { params: IdParams } },
        async (req): Promise<ChunkToggleResponse> => {
          ctx.retriever.enable(req.params.id);
          await ctx.overrides.enable(req.params.id);
          return { ok: true, disabled: false };
        },
      );

      // Flag a session citation as helpful / irrelevant / unrated.
      admin.post(
        "/sessions/:id/citations/:chunkId/flag",
        { schema: { params: SessionChunkParams, body: FlagBody } },
        async (req, res): Promise<CitationFlagResponse | FastifyReply> => {
          const session = await ctx.store.get(req.params.id);
          if (!session) return res.status(404).send({ error: "session not found" });
          const citation = session.citations.find((c) => c.chunkId === req.params.chunkId);
          if (!citation) return res.status(404).send({ error: "citation not found" });
          const helpful = req.body.helpful;
          citation.helpful = helpful === null ? undefined : helpful;
          session.updatedAt = new Date().toISOString();
          await ctx.store.save(session);
          return { citation };
        },
      );

      // ---- admin → user questions ------------------------------------------
      admin.post(
        "/sessions/:id/questions",
        { schema: { params: IdParams, body: QuestionBody } },
        async (req, res): Promise<QuestionResponse | FastifyReply> => {
          const session = await ctx.store.get(req.params.id);
          if (!session) return res.status(404).send({ error: "session not found" });

          const q: AdminQuestion = {
            id: randomUUID(),
            question: req.body.question,
            status: "pending",
            createdAt: new Date().toISOString(),
          };
          session.adminQuestions.push(q);
          session.updatedAt = q.createdAt;
          await ctx.store.save(session);
          return { question: q };
        },
      );

      // Turn an answered question into knowledge candidates (same review queue).
      admin.post(
        "/sessions/:id/questions/:qid/learn",
        { schema: { params: SessionQidParams } },
        async (req, res): Promise<FeedbackResponse | FastifyReply> => {
          const session = await ctx.store.get(req.params.id);
          if (!session) return res.status(404).send({ error: "session not found" });
          const q = session.adminQuestions.find((x) => x.id === req.params.qid);
          if (!q) return res.status(404).send({ error: "question not found" });
          if (q.status !== "answered" || !q.answer)
            return res.status(409).send({ error: "question is not answered yet" });
          if (q.learnedFeedbackId)
            return res.status(409).send({ error: "already learned from this answer" });

          const now = new Date().toISOString();
          const text = `پرسش ادمین: ${q.question}\nپاسخ کاربر: ${q.answer}`;
          const { candidates, error } = await extractCandidates(ctx, session, text, now);
          const feedback: AdminFeedback = {
            id: randomUUID(),
            sessionId: session.id,
            sessionRequest: session.request,
            text,
            createdAt: now,
            candidates,
            extractionError: error,
          };
          await ctx.feedback.save(feedback);
          q.learnedFeedbackId = feedback.id;
          await ctx.store.save(session);
          return { feedback };
        },
      );

      // ---- admin corrects the diagram --------------------------------------
      admin.post(
        "/sessions/:id/correction",
        { schema: { params: IdParams, body: CorrectionBody } },
        async (req, res): Promise<CorrectionResponse | FastifyReply> => {
          const session = await ctx.store.get(req.params.id);
          if (!session) return res.status(404).send({ error: "session not found" });

          session.correction = {
            bpmnXml: req.body.bpmnXml,
            note: req.body.note,
            at: new Date().toISOString(),
          };
          session.updatedAt = session.correction.at;
          await ctx.store.save(session);
          return { correction: session.correction };
        },
      );

      // ---- correction mining -----------------------------------------------
      // Turn an admin's corrected diagram into knowledge candidates (same queue).
      admin.post(
        "/sessions/:id/correction/learn",
        { schema: { params: IdParams } },
        async (req, res): Promise<CorrectionLearnResponse | FastifyReply> => {
          const session = await ctx.store.get(req.params.id);
          if (!session) return res.status(404).send({ error: "session not found" });
          if (!session.correction)
            return res.status(409).send({ error: "no correction to learn from" });
          if (session.correction.learnedFeedbackId)
            return res.status(409).send({ error: "already learned from this correction" });

          const now = new Date().toISOString();
          let description = "";
          try {
            const diff = await runCorrectionDiff(
              { llm: ctx.llm },
              session,
              session.correction.bpmnXml,
              session.correction.note,
            );
            description = diff.description.trim();
          } catch {
            /* diff is best-effort; fall back to the admin's note below */
          }
          const text = description || session.correction.note;
          if (!text)
            return res.status(422).send({ error: "could not derive a lesson from the correction" });

          const { candidates, error } = await extractCandidates(ctx, session, text, now);
          const feedback: AdminFeedback = {
            id: randomUUID(),
            sessionId: session.id,
            sessionRequest: session.request,
            text,
            createdAt: now,
            candidates,
            extractionError: error,
          };
          await ctx.feedback.save(feedback);
          session.correction.learnedFeedbackId = feedback.id;
          await ctx.store.save(session);
          return { feedback, description };
        },
      );

      // ---- feedback / knowledge analytics ----------------------------------
      admin.get("/stats", async (): Promise<AdminStatsResponse> => {
        const feedback = await ctx.feedback.list();
        const summaries = await ctx.store.list();
        const sessions = await Promise.all(summaries.map((s) => ctx.store.get(s.id)));

        const candByStatus = { pending: 0, accepted: 0, rejected: 0 };
        const candByKind: Record<string, number> = {};
        const tagCounts: Record<string, number> = {};
        for (const f of feedback)
          for (const c of f.candidates) {
            candByStatus[c.status] += 1;
            candByKind[c.kind] = (candByKind[c.kind] ?? 0) + 1;
            for (const t of c.tags) tagCounts[t] = (tagCounts[t] ?? 0) + 1;
          }

        const withCorrection = sessions.filter((s) => s?.correction).length;
        const learned = ctx.learned.list();
        const learnedByKind: Record<string, number> = {};
        let reinforcements = 0;
        for (const e of learned) {
          learnedByKind[e.kind] = (learnedByKind[e.kind] ?? 0) + 1;
          reinforcements += e.weight - 1;
        }
        const topTags = Object.entries(tagCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([tag, count]) => ({ tag, count }));

        return {
          candidates: { ...candByStatus, byKind: candByKind },
          sessions: {
            total: summaries.length,
            withFeedback: new Set(feedback.map((f) => f.sessionId)).size,
            withCorrection,
          },
          learned: { total: learned.length, byKind: learnedByKind, reinforcements },
          behavior: ctx.behavior.list().length,
          examples: ctx.examples.list().length,
          topTags,
        };
      });

      // ---- golden example bank ---------------------------------------------
      admin.get(
        "/examples",
        async (): Promise<ExampleListResponse> => ({ examples: ctx.examples.list() }),
      );

      admin.post(
        "/examples",
        { schema: { body: ExampleBody } },
        async (req, res): Promise<ExampleResponse | FastifyReply> => {
          const { sessionId, note } = req.body;
          const session = await ctx.store.get(sessionId);
          if (!session) return res.status(404).send({ error: "session not found" });
          if (!session.processModel)
            return res
              .status(409)
              .send({ error: "session has no process model to use as an example" });

          const entry: ExampleEntry = {
            id: randomUUID(),
            sessionId,
            request: session.request,
            processModel: session.processModel,
            note,
            createdAt: new Date().toISOString(),
          };
          await ctx.examples.add(entry);
          return { example: entry };
        },
      );

      admin.delete(
        "/examples/:id",
        { schema: { params: IdParams } },
        async (req, res): Promise<OkResponse | FastifyReply> => {
          const removed = await ctx.examples.remove(req.params.id);
          if (!removed) return res.status(404).send({ error: "example not found" });
          return { ok: true };
        },
      );

      // ---- behavioral instructions -----------------------------------------
      admin.get(
        "/behavior",
        async (): Promise<BehaviorListResponse> => ({
          entries: ctx.behavior.list(),
          agents: behaviorAgents,
        }),
      );

      admin.post(
        "/behavior",
        { schema: { body: BehaviorBody } },
        async (req): Promise<BehaviorResponse> => {
          const { agent, instruction } = req.body;

          const now = new Date().toISOString();
          const source: LearnedSource = { feedbackId: "manual", sessionId: "manual", at: now };
          const existing = ctx.behavior.findByText(agent, instruction);
          if (existing) {
            // existing was just resolved from the same store, so it must still be there.
            const updated = (await ctx.behavior.reinforce(existing.id, source))!;
            return { entry: updated, reinforced: true };
          }
          const entry: BehaviorEntry = {
            id: `behavior-manual-${randomUUID()}`,
            agent,
            instruction,
            weight: 1,
            sources: [source],
            createdAt: now,
          };
          await ctx.behavior.add(entry);
          return { entry, reinforced: false };
        },
      );

      admin.patch(
        "/behavior/:id",
        { schema: { params: IdParams, body: BehaviorPatchBody } },
        async (req, res): Promise<BehaviorPatchResponse | FastifyReply> => {
          const patch: { instruction?: string; agent?: BehaviorAgent } = {};
          if (req.body.instruction !== undefined) patch.instruction = req.body.instruction;
          if (req.body.agent !== undefined) patch.agent = req.body.agent;
          const updated = await ctx.behavior.update(req.params.id, patch);
          if (!updated) return res.status(404).send({ error: "behavior entry not found" });
          return { entry: updated };
        },
      );

      admin.delete(
        "/behavior/:id",
        { schema: { params: IdParams } },
        async (req, res): Promise<OkResponse | FastifyReply> => {
          const removed = await ctx.behavior.remove(req.params.id);
          if (!removed) return res.status(404).send({ error: "behavior entry not found" });
          return { ok: true };
        },
      );

      // ---- evaluation suite -------------------------------------------------
      admin.get("/eval", async (): Promise<EvalListResponse> => ({ cases: await ctx.evals.list() }));

      // Promote a reviewed session to a golden eval case.
      admin.post(
        "/eval",
        { schema: { body: EvalBody } },
        async (req, res): Promise<EvalResponse | FastifyReply> => {
          const { sessionId, note, expected } = req.body;
          const session = await ctx.store.get(sessionId);
          if (!session) return res.status(404).send({ error: "session not found" });

          const model = session.processModel;
          const evalCase: EvalCase = EvalCaseFrom(sessionId, session.request, note, {
            // Auto-derive sensible expectations from the reviewed session.
            bpmnValid: model ? validateModel(model).valid : true,
            minRoles: Math.max(1, session.roles.length),
            minActivities: model ? Math.max(1, model.activities.length) : 1,
            mustHaveRejectionPath: false,
            expectedRoles: [],
            ...(expected ?? {}),
          });
          await ctx.evals.save(evalCase);
          return { case: evalCase };
        },
      );

      admin.delete(
        "/eval/:id",
        { schema: { params: IdParams } },
        async (req, res): Promise<OkResponse | FastifyReply> => {
          const removed = await ctx.evals.remove(req.params.id);
          if (!removed) return res.status(404).send({ error: "eval case not found" });
          return { ok: true };
        },
      );

      // Run all eval cases against their stored sessions (deterministic, no LLM).
      admin.post("/eval/run", async (): Promise<EvalRunResponse> => {
        const cases = await ctx.evals.list();
        const results = [];
        for (const c of cases) {
          const session = await ctx.store.get(c.sessionId);
          if (!session) {
            results.push({
              caseId: c.id,
              request: c.request,
              passed: false,
              checks: [],
              error: "session not found",
            });
            continue;
          }
          results.push(await runEvalCase(c, session));
        }
        const passed = results.filter((r) => r.passed).length;
        return { results, passed, total: results.length };
      });
    },
    { prefix: "/api/admin" },
  );
}

/** Build an EvalCase with a fresh id/timestamp from the given parts. */
function EvalCaseFrom(
  sessionId: string,
  request: string,
  note: string | undefined,
  expected: EvalCase["expected"],
): EvalCase {
  return {
    id: randomUUID(),
    sessionId,
    request,
    note: (note ?? "").trim(),
    expected,
    createdAt: new Date().toISOString(),
  };
}
