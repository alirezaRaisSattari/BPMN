import { randomUUID } from "node:crypto";
import type { FastifyReply } from "fastify";
import type { Phase, SessionState, TurnResult } from "@bpmn-analyst/core";
import type { AppContext, ZodApp } from "./app.js";
import {
  CreateSessionBody,
  MessageBody,
  AnswerBody,
  IdParams,
  SessionQidParams,
  type TurnResponse,
  type SessionListResponse,
  type SessionResponse,
  type AnswerResponse,
} from "./schemas.js";

function view(session: SessionState, reply: string, awaitingUser: boolean): TurnResponse {
  return { reply, awaitingUser, session };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Write a single Server-Sent Event frame. */
function sseSend(res: FastifyReply, event: string, data: unknown): void {
  res.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Take over the reply and start an SSE stream. */
function sseOpen(res: FastifyReply): void {
  res.hijack();
  res.raw.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // disable proxy buffering so events flush live
  });
}

/** Stream the final reply text word-by-word so the UI can render it live. */
async function streamReplyText(res: FastifyReply, text: string): Promise<void> {
  const chunks = text.match(/\s*\S+|\s+/g) ?? (text ? [text] : []);
  for (const chunk of chunks) {
    sseSend(res, "delta", { text: chunk });
    await sleep(18);
  }
}

/**
 * Run one turn while streaming its lifecycle over SSE:
 * `created` (session is now persisted & listable) → `phase`… → `delta`… → `done`.
 */
async function runStreamingTurn(
  res: FastifyReply,
  ctx: AppContext,
  session: SessionState,
  run: (onProgress: (phase: Phase) => void) => Promise<TurnResult>,
): Promise<void> {
  sseOpen(res);
  // Persist and announce the session up front so it appears in the history list
  // immediately — before the assistant has produced any reply.
  await ctx.store.save(session);
  sseSend(res, "created", { session });

  try {
    const turn = await run((phase) => sseSend(res, "phase", { phase }));
    await ctx.store.save(turn.session);
    await streamReplyText(res, turn.reply);
    sseSend(res, "done", {
      session: turn.session,
      reply: turn.reply,
      awaitingUser: turn.awaitingUser,
    });
  } catch (err) {
    await ctx.store.save(session);
    sseSend(res, "error", { error: llmError(err), session });
  } finally {
    res.raw.end();
  }
}

export function registerRoutes(app: ZodApp, ctx: AppContext): void {
  // Create a session and run the first (elicitation) turn.
  app.post(
    "/api/sessions",
    { schema: { body: CreateSessionBody } },
    async (req, res): Promise<TurnResponse | FastifyReply> => {
      const { request } = req.body;
      const session = ctx.newSession(randomUUID());
      try {
        const turn = await ctx.orchestrator.begin(session, request);
        await ctx.store.save(turn.session);
        return view(turn.session, turn.reply, turn.awaitingUser);
      } catch (err) {
        await ctx.store.save(session);
        return res.status(502).send({ error: llmError(err), sessionId: session.id });
      }
    },
  );

  // Continue a session with a user message.
  app.post(
    "/api/sessions/:id/messages",
    { schema: { params: IdParams, body: MessageBody } },
    async (req, res): Promise<TurnResponse | FastifyReply> => {
      const { message } = req.body;
      const session = await ctx.store.get(req.params.id);
      if (!session) return res.status(404).send({ error: "session not found" });

      try {
        const turn = await ctx.orchestrator.respond(session, message);
        await ctx.store.save(turn.session);
        return view(turn.session, turn.reply, turn.awaitingUser);
      } catch (err) {
        await ctx.store.save(session);
        return res.status(502).send({ error: llmError(err) });
      }
    },
  );

  // Create a session and stream the first turn live over SSE.
  app.post(
    "/api/sessions/stream",
    { schema: { body: CreateSessionBody } },
    async (req, res) => {
      const { request } = req.body;
      const session = ctx.newSession(randomUUID());
      // Seed the request so the `created` event carries a listable title.
      session.request = request;
      await runStreamingTurn(res, ctx, session, (onProgress) =>
        ctx.orchestrator.begin(session, request, onProgress),
      );
    },
  );

  // Continue a session with a user message, streaming the turn live over SSE.
  app.post(
    "/api/sessions/:id/messages/stream",
    { schema: { params: IdParams, body: MessageBody } },
    async (req, res) => {
      const { message } = req.body;
      const session = await ctx.store.get(req.params.id);
      if (!session) return res.status(404).send({ error: "session not found" });

      await runStreamingTurn(res, ctx, session, (onProgress) =>
        ctx.orchestrator.respond(session, message, onProgress),
      );
    },
  );

  app.get("/api/sessions", async (): Promise<SessionListResponse> => ({
    sessions: await ctx.store.list(),
  }));

  app.get(
    "/api/sessions/:id",
    { schema: { params: IdParams } },
    async (req, res): Promise<SessionResponse | FastifyReply> => {
      const session = await ctx.store.get(req.params.id);
      if (!session) return res.status(404).send({ error: "session not found" });
      return { session };
    },
  );

  app.delete(
    "/api/sessions/:id",
    { schema: { params: IdParams } },
    async (req, res) => {
      const removed = await ctx.store.remove(req.params.id);
      if (!removed) return res.status(404).send({ error: "session not found" });
      return { ok: true as const };
    },
  );

  app.get(
    "/api/sessions/:id/bpmn",
    { schema: { params: IdParams } },
    async (req, res) => {
      const session = await ctx.store.get(req.params.id);
      const xml = session?.outputs.bpmnXml;
      if (!xml) return res.status(404).send({ error: "no BPMN yet" });
      return res.header("Content-Type", "application/xml; charset=utf-8").send(xml);
    },
  );

  app.get(
    "/api/sessions/:id/document",
    { schema: { params: IdParams } },
    async (req, res) => {
      const session = await ctx.store.get(req.params.id);
      const doc = session?.outputs.document;
      if (!doc) return res.status(404).send({ error: "no document yet" });
      return res.header("Content-Type", "text/markdown; charset=utf-8").send(doc);
    },
  );

  // The end user answers a question an admin posed during review. Public (no
  // admin token) — the session id is the capability to answer it.
  app.post(
    "/api/sessions/:id/questions/:qid/answer",
    { schema: { params: SessionQidParams, body: AnswerBody } },
    async (req, res): Promise<AnswerResponse | FastifyReply> => {
      const { answer } = req.body;
      const session = await ctx.store.get(req.params.id);
      if (!session) return res.status(404).send({ error: "session not found" });
      const q = session.adminQuestions.find((x) => x.id === req.params.qid);
      if (!q) return res.status(404).send({ error: "question not found" });

      q.answer = answer;
      q.status = "answered";
      q.answeredAt = new Date().toISOString();
      session.updatedAt = q.answeredAt;
      await ctx.store.save(session);
      return { question: q };
    },
  );
}

function llmError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("Insufficient balance")) return "اعتبار حساب LLM کافی نیست (Insufficient balance).";
  if (msg.includes("content-blocked")) return "درخواست توسط فیلتر محتوای provider بلاک شد.";
  if (msg.includes("network")) return "خطای شبکه در ارتباط با provider مدل زبانی.";
  return `خطای مدل زبانی: ${msg}`;
}
