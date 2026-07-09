import type { z } from "zod";
/* z is used only in type position (z.ZodTypeAny, z.infer<S>). */

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompleteOptions {
  messages: LLMMessage[];
  system?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface StructuredOptions<S extends z.ZodTypeAny> extends CompleteOptions {
  schema: S;
  /** Short name for the schema (used in the prompt / json_schema). */
  schemaName: string;
  /** One-line description of what the model should produce. */
  schemaDescription?: string;
  /** How many times to retry on parse/validation failure. */
  retries?: number;
}

/**
 * Provider-agnostic LLM interface. Analysis modules depend ONLY on this — never
 * on a concrete SDK — so models/providers can be swapped without code changes.
 */
export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  complete(opts: CompleteOptions): Promise<string>;
  completeStructured<S extends z.ZodTypeAny>(opts: StructuredOptions<S>): Promise<z.infer<S>>;
}

/**
 * Extract the first JSON value from a model response. Handles ```json fences,
 * leading prose / reasoning, and trailing text by scanning for a balanced
 * object or array.
 */
export function extractJson(raw: string): string {
  let text = raw.trim();

  // Strip a fenced code block if present.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) text = fence[1].trim();

  const start = text.search(/[{[]/);
  if (start === -1) return text;

  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start);
}
