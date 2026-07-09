import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import {
  createProvider,
  buildKnowledge,
  Orchestrator,
  FileSessionStore,
  newSession,
  type KnowledgeRetriever,
  type LLMProvider,
  type SessionStore,
} from "@bpmn-analyst/core";
import { repoPaths } from "./paths.js";
import { registerRoutes } from "./routes.js";

export interface AppContext {
  llm: LLMProvider;
  retriever: KnowledgeRetriever;
  store: SessionStore;
  orchestrator: Orchestrator;
  newSession: typeof newSession;
}

export async function buildApp(): Promise<FastifyInstance> {
  const paths = repoPaths();
  const llm = createProvider();
  const retriever = await buildKnowledge({
    knowledgeDir: paths.knowledgeDir,
    indexPath: paths.indexPath,
  });
  const store = new FileSessionStore(paths.sessionsDir);
  const orchestrator = new Orchestrator({ llm, retriever });

  const ctx: AppContext = { llm, retriever, store, orchestrator, newSession };

  const app = Fastify({ logger: { level: "info" } });
  await app.register(cors, { origin: true });

  app.get("/api/health", async () => ({
    ok: true,
    provider: llm.name,
    model: llm.model,
    knowledgeChunks: retriever.size,
  }));

  registerRoutes(app, ctx);
  return app;
}
