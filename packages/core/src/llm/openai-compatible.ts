import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { LLMConfig } from "./config.js";
import { postJson } from "./transport.js";
import {
  extractJson,
  type CompleteOptions,
  type LLMProvider,
  type StructuredOptions,
} from "./provider.js";

interface ChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
}

/**
 * LLM provider for any OpenAI-compatible /chat/completions endpoint.
 * Default target: AgentRouter (glm-5.2). The client headers in `config.headers`
 * satisfy AgentRouter's anti-abuse filter.
 */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly name = "openai-compatible";
  readonly model: string;

  constructor(private readonly config: LLMConfig) {
    this.model = config.model;
  }

  private async chat(body: Record<string, unknown>): Promise<string> {
    const { status, text } = await this.postWithRetry(body);
    let json: ChatResponse;
    try {
      json = JSON.parse(text) as ChatResponse;
    } catch {
      throw new Error(`LLM HTTP ${status}: non-JSON response: ${text.slice(0, 300)}`);
    }
    if (status < 200 || status >= 300 || json.error) {
      throw new Error(`LLM HTTP ${status}: ${json.error?.message ?? text.slice(0, 300)}`);
    }
    const content = json.choices?.[0]?.message?.content ?? "";
    return content ?? "";
  }

  /** POST with a small backoff on transient network errors (socket resets etc.). */
  private async postWithRetry(body: Record<string, unknown>, attempts = 3) {
    const headers = {
      Authorization: `Bearer ${this.config.apiKey}`,
      ...this.config.headers,
    };
    let lastErr = "";
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await postJson(`${this.config.baseUrl}/chat/completions`, headers, body);
        // Retry transient upstream errors (5xx / 429); return everything else.
        if (res.status < 500 && res.status !== 429) return res;
        lastErr = `HTTP ${res.status}`;
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
      }
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
    throw new Error(`LLM request failed after ${attempts} attempts: ${lastErr}`);
  }

  async complete(opts: CompleteOptions): Promise<string> {
    const messages = opts.system
      ? [{ role: "system" as const, content: opts.system }, ...opts.messages]
      : opts.messages;
    return this.chat({
      model: this.model,
      messages,
      max_tokens: opts.maxTokens ?? this.config.maxTokens,
      temperature: opts.temperature ?? 0.3,
    });
  }

  async completeStructured<S extends z.ZodTypeAny>(opts: StructuredOptions<S>): Promise<z.infer<S>> {
    const jsonSchema = zodToJsonSchema(opts.schema, opts.schemaName);
    const schemaText = JSON.stringify(jsonSchema);
    const retries = opts.retries ?? 2;

    const systemInstruction = [
      opts.system ?? "",
      "You must respond with a SINGLE JSON value and nothing else.",
      opts.schemaDescription ? `Goal: ${opts.schemaDescription}` : "",
      `The JSON MUST validate against this JSON Schema:\n${schemaText}`,
      "Do not include markdown fences, comments, or any prose outside the JSON.",
    ]
      .filter(Boolean)
      .join("\n\n");

    let lastError = "";
    for (let attempt = 0; attempt <= retries; attempt++) {
      const messages = [...opts.messages];
      if (attempt > 0) {
        messages.push({
          role: "user",
          content: `Your previous answer was invalid: ${lastError}\nReturn corrected JSON only.`,
        });
      }
      const raw = await this.chat({
        model: this.model,
        messages: [{ role: "system", content: systemInstruction }, ...messages],
        max_tokens: opts.maxTokens ?? this.config.maxTokens,
        temperature: opts.temperature ?? 0.2,
      });

      try {
        const parsed = JSON.parse(extractJson(raw)) as unknown;
        return opts.schema.parse(parsed) as z.infer<S>;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
    throw new Error(
      `completeStructured(${opts.schemaName}) failed after ${retries + 1} attempts: ${lastError}`,
    );
  }
}
