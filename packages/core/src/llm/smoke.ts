/**
 * Manual smoke test for the configured LLM provider.
 *   npm run smoke:llm            (uses .env — hits AgentRouter/glm-5.2)
 * Verifies plain completion + structured output. Keep prompts tiny (cost).
 */
import { z } from "zod";
import { createProvider } from "./registry.js";
import { getLLMConfig } from "./config.js";

async function main() {
  const cfg = getLLMConfig();
  console.log(`Provider: ${cfg.provider} | model: ${cfg.model} | base: ${cfg.baseUrl}`);
  const llm = createProvider();

  console.log("\n[1] plain completion...");
  const reply = await llm.complete({
    messages: [{ role: "user", content: "Reply with exactly: PONG" }],
    maxTokens: 256,
  });
  console.log("  ->", reply.trim().slice(0, 120));

  console.log("\n[2] structured output...");
  const Schema = z.object({
    initiator: z.string(),
    roles: z.array(z.string()),
    firstActivity: z.string(),
  });
  const result = await llm.completeStructured({
    schema: Schema,
    schemaName: "ProcessSketch",
    schemaDescription: "Extract a rough sketch of a leave-request process.",
    messages: [
      {
        role: "user",
        content: "درخواست مرخصی: کارمند درخواست می‌دهد و مدیر تأیید می‌کند.",
      },
    ],
    maxTokens: 1024,
  });
  console.log("  ->", JSON.stringify(result));
  console.log("\nOK");
}

main().catch((err) => {
  console.error("SMOKE FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
