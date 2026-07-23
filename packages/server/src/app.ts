import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import {
  validatorCompiler,
  hasZodFastifySchemaValidationErrors,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import {
  createProvider,
  buildKnowledge,
  Orchestrator,
  FileSessionStore,
  FileFeedbackStore,
  FileEvalStore,
  LearnedKnowledgeStore,
  RetrievalLog,
  KnowledgeOverridesStore,
  ExampleStore,
  BehaviorStore,
  learnedToChunk,
  newSession,
  type EvalStore,
  type FeedbackStore,
  type KnowledgeRetriever,
  type LLMProvider,
  type SessionStore,
} from "@bpmn-analyst/core";
import { repoPaths } from "./paths.js";
import { registerRoutes } from "./routes.js";
import { registerAdminRoutes } from "./admin-routes.js";

/** Fastify instance typed with the Zod type provider, so route `schema.body`/
 *  `schema.params` (zod objects) drive `req.body`/`req.params` inference. */
export type ZodApp = FastifyInstance<any, any, any, any, ZodTypeProvider>;

export interface AppContext {
  llm: LLMProvider;
  retriever: KnowledgeRetriever;
  store: SessionStore;
  feedback: FeedbackStore;
  learned: LearnedKnowledgeStore;
  evals: EvalStore;
  retrievalLog: RetrievalLog;
  overrides: KnowledgeOverridesStore;
  examples: ExampleStore;
  behavior: BehaviorStore;
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
  const feedback = new FileFeedbackStore(paths.feedbackDir);
  const evals = new FileEvalStore(paths.evalDir);
  const retrievalLog = new RetrievalLog(paths.retrievalLogPath);
  const examples = await ExampleStore.load(paths.examplesPath);
  const behavior = await BehaviorStore.load(paths.behaviorPath);
  // Admin-approved knowledge lives beside the base index and is injected on top.
  const learned = await LearnedKnowledgeStore.load(paths.learnedPath);
  await retriever.addChunks(learned.list().map(learnedToChunk));
  // Re-apply admin chunk disables after the base index + learned chunks are loaded
  // (the index is a rebuildable cache, so disables can't live inside it).
  const overrides = await KnowledgeOverridesStore.load(paths.overridesPath);
  for (const id of overrides.list()) retriever.disable(id);

  const orchestrator = new Orchestrator({
    llm,
    retriever,
    exampleBank: examples,
    behavior,
    logRetrieval: (entry) => {
      void retrievalLog.append(entry).catch(() => {});
    },
  });

  const ctx: AppContext = {
    llm,
    retriever,
    store,
    feedback,
    learned,
    evals,
    retrievalLog,
    overrides,
    examples,
    behavior,
    orchestrator,
    newSession,
  };

  const app = Fastify({ logger: { level: "info" } }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  // Reshape zod validation failures into the app's `{ error }` convention (the
  // web client reads `data.error`) instead of fastify-type-provider-zod's default
  // `{ statusCode, code, error, message }` ajv-style body.
  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      const detail = err.validation
        .map((v) => `${v.instancePath || "body"} ${v.message}`)
        .join("; ");
      return reply.status(400).send({ error: detail || "invalid request" });
    }
    req.log.error(err);
    const status = err.statusCode ?? 500;
    return reply.status(status).send({ error: err.message || "internal error" });
  });
  await app.register(cors, { origin: true });

  app.get("/api/health", async () => ({
    ok: true,
    provider: llm.name,
    model: llm.model,
    knowledgeChunks: retriever.size,
  }));

  registerRoutes(app, ctx);
  registerAdminRoutes(app, ctx);
  return app;
}
