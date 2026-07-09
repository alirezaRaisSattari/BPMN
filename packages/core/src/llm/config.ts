import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** Walk up from `start` looking for a `.env` file. */
function findEnvFile(start: string): string | undefined {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

let envLoaded = false;
/** Load the nearest .env once, using Node's built-in loader (no dependency). */
export function loadEnv(): void {
  if (envLoaded) return;
  envLoaded = true;
  const envPath = findEnvFile(process.cwd());
  const loader = (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile;
  if (envPath && typeof loader === "function") {
    try {
      loader(envPath);
    } catch {
      /* ignore malformed/locked .env */
    }
  }
}

export type ProviderKind = "openai-compatible" | "mock";

export interface LLMConfig {
  provider: ProviderKind;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  /** Extra HTTP headers required by AgentRouter's anti-abuse filter. */
  headers: Record<string, string>;
}

export function getLLMConfig(overrides: Partial<LLMConfig> = {}): LLMConfig {
  loadEnv();
  const env = process.env;
  const headers: Record<string, string> = {};
  if (env.LLM_USER_AGENT) headers["User-Agent"] = env.LLM_USER_AGENT;
  if (env.LLM_X_APP) headers["x-app"] = env.LLM_X_APP;

  const provider = (env.LLM_PROVIDER as ProviderKind) || "mock";
  return {
    provider: overrides.provider ?? provider,
    baseUrl: overrides.baseUrl ?? env.LLM_BASE_URL ?? "https://agentrouter.org/v1",
    apiKey: overrides.apiKey ?? env.LLM_API_KEY ?? "",
    model: overrides.model ?? env.LLM_MODEL ?? "glm-5.2",
    maxTokens: overrides.maxTokens ?? Number(env.LLM_MAX_TOKENS ?? 4096),
    headers: overrides.headers ?? headers,
  };
}
