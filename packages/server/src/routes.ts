import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { SessionState } from "@bpmn-analyst/core";
import type { AppContext } from "./app.js";

interface CreateBody {
  request?: string;
}
interface MessageBody {
  message?: string;
}

function view(session: SessionState, reply: string, awaitingUser: boolean) {
  return { reply, awaitingUser, session };
}

export function registerRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Create a session and run the first (elicitation) turn.
  app.post<{ Body: CreateBody }>("/api/sessions", async (req, res) => {
    const request = (req.body?.request ?? "").trim();
    if (!request) return res.status(400).send({ error: "request is required" });

    const session = ctx.newSession(randomUUID());
    try {
      const turn = await ctx.orchestrator.begin(session, request);
      await ctx.store.save(turn.session);
      return view(turn.session, turn.reply, turn.awaitingUser);
    } catch (err) {
      await ctx.store.save(session);
      return res.status(502).send({ error: llmError(err), sessionId: session.id });
    }
  });

  // Continue a session with a user message.
  app.post<{ Params: { id: string }; Body: MessageBody }>(
    "/api/sessions/:id/messages",
    async (req, res) => {
      const message = (req.body?.message ?? "").trim();
      if (!message) return res.status(400).send({ error: "message is required" });

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

  app.get("/api/sessions", async () => ({ sessions: await ctx.store.list() }));

  app.get<{ Params: { id: string } }>("/api/sessions/:id", async (req, res) => {
    const session = await ctx.store.get(req.params.id);
    if (!session) return res.status(404).send({ error: "session not found" });
    return { session };
  });

  app.get<{ Params: { id: string } }>("/api/sessions/:id/bpmn", async (req, res) => {
    const session = await ctx.store.get(req.params.id);
    const xml = session?.outputs.bpmnXml;
    if (!xml) return res.status(404).send({ error: "no BPMN yet" });
    return res.header("Content-Type", "application/xml; charset=utf-8").send(xml);
  });

  app.get<{ Params: { id: string } }>("/api/sessions/:id/document", async (req, res) => {
    const session = await ctx.store.get(req.params.id);
    const doc = session?.outputs.document;
    if (!doc) return res.status(404).send({ error: "no document yet" });
    return res.header("Content-Type", "text/markdown; charset=utf-8").send(doc);
  });
}

function llmError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("Insufficient balance")) return "اعتبار حساب LLM کافی نیست (Insufficient balance).";
  if (msg.includes("content-blocked")) return "درخواست توسط فیلتر محتوای provider بلاک شد.";
  if (msg.includes("network")) return "خطای شبکه در ارتباط با provider مدل زبانی.";
  return `خطای مدل زبانی: ${msg}`;
}
