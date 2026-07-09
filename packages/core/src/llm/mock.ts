import { z } from "zod";
import type {
  CompleteOptions,
  LLMProvider,
  StructuredOptions,
} from "./provider.js";

/**
 * Offline provider used for tests and no-key demos. `complete` echoes a canned
 * reply; `completeStructured` synthesizes a schema-valid placeholder (optionally
 * overridden by a fixtures map keyed on schemaName).
 */
export class MockProvider implements LLMProvider {
  readonly name = "mock";
  readonly model = "mock";

  constructor(private readonly fixtures: Record<string, unknown> = {}) {}

  async complete(opts: CompleteOptions): Promise<string> {
    const last = opts.messages[opts.messages.length - 1];
    return `MOCK: ${last?.content?.slice(0, 80) ?? ""}`;
  }

  async completeStructured<S extends z.ZodTypeAny>(
    opts: StructuredOptions<S>,
  ): Promise<z.infer<S>> {
    if (opts.schemaName in this.fixtures) {
      return opts.schema.parse(this.fixtures[opts.schemaName]) as z.infer<S>;
    }
    const sample = synthesize(opts.schema);
    return opts.schema.parse(sample) as z.infer<S>;
  }
}

/** Produce a minimal value that satisfies a zod schema (subset used here). */
export function synthesize(schema: z.ZodTypeAny): unknown {
  const def = schema._def as { typeName?: string; [k: string]: unknown };
  switch (def.typeName) {
    case z.ZodFirstPartyTypeKind.ZodDefault:
      return (def.defaultValue as () => unknown)();
    case z.ZodFirstPartyTypeKind.ZodOptional:
    case z.ZodFirstPartyTypeKind.ZodNullable:
      return synthesize(def.innerType as z.ZodTypeAny);
    case z.ZodFirstPartyTypeKind.ZodEffects:
      return synthesize(def.schema as z.ZodTypeAny);
    case z.ZodFirstPartyTypeKind.ZodObject: {
      const shape = (def.shape as () => Record<string, z.ZodTypeAny>)();
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(shape)) out[key] = synthesize(value);
      return out;
    }
    case z.ZodFirstPartyTypeKind.ZodArray: {
      const min = (def.minLength as { value: number } | null)?.value ?? 0;
      const inner = def.type as z.ZodTypeAny;
      return Array.from({ length: min }, () => synthesize(inner));
    }
    case z.ZodFirstPartyTypeKind.ZodString:
      return "sample";
    case z.ZodFirstPartyTypeKind.ZodNumber:
      return 0;
    case z.ZodFirstPartyTypeKind.ZodBoolean:
      return false;
    case z.ZodFirstPartyTypeKind.ZodEnum:
      return (def.values as readonly string[])[0];
    case z.ZodFirstPartyTypeKind.ZodLiteral:
      return def.value;
    case z.ZodFirstPartyTypeKind.ZodUnion:
      return synthesize((def.options as z.ZodTypeAny[])[0]!);
    default:
      return null;
  }
}
