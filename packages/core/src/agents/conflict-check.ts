import { z } from "zod";
import { BA_PERSONA, type AgentContext } from "./base.js";

export const ConflictCheckSchema = z.object({
  conflict: z.boolean().default(false),
  reason: z.string().default(""),
});
export type ConflictCheck = z.infer<typeof ConflictCheckSchema>;

/**
 * Decide whether a candidate knowledge point *contradicts* an existing knowledge
 * chunk (as opposed to merely overlapping/duplicating it). Used to flag review
 * items that need a human to resolve a conflict rather than accept a near-dupe.
 */
export async function runConflictCheck(
  ctx: AgentContext,
  candidate: string,
  existing: string,
): Promise<ConflictCheck> {
  const system = [
    BA_PERSONA,
    "وظیفه: تشخیص «تناقض» بین یک قاعدهٔ دانشی جدید و یک قاعدهٔ موجود در پایگاه دانش.",
    "conflict=true فقط زمانی که دو قاعده هم‌زمان نمی‌توانند درست باشند یا یکدیگر را نقض می‌کنند.",
    "اگر قاعدهٔ جدید صرفاً مشابه، مکمل یا تکرار قاعدهٔ موجود است، conflict=false.",
    "دلیل کوتاه فارسی بده.",
  ].join("\n");

  return ctx.llm.completeStructured({
    schema: ConflictCheckSchema,
    schemaName: "ConflictCheck",
    schemaDescription: "تشخیص تناقض دو قاعده",
    system,
    messages: [
      {
        role: "user",
        content: `قاعدهٔ جدید:\n"""${candidate}"""\n\nقاعدهٔ موجود:\n"""${existing}"""`,
      },
    ],
  });
}
