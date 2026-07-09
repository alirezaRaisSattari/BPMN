import { getLLMConfig, type LLMConfig } from "./config.js";
import { MockProvider } from "./mock.js";
import { OpenAICompatibleProvider } from "./openai-compatible.js";
import type { LLMProvider } from "./provider.js";

/** Build the configured LLM provider. Swap providers via env, not code. */
export function createProvider(overrides: Partial<LLMConfig> = {}): LLMProvider {
  const config = getLLMConfig(overrides);
  switch (config.provider) {
    case "openai-compatible":
      return new OpenAICompatibleProvider(config);
    case "mock":
      return new MockProvider();
    default:
      throw new Error(`Unknown LLM provider: ${config.provider}`);
  }
}
