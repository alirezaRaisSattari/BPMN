/** List models exposed by the configured OpenAI-compatible endpoint.
 *   npm run llm:models
 * Run this locally where the endpoint is reachable. */
import { getJson } from "./transport.js";
import { getLLMConfig } from "./config.js";

const cfg = getLLMConfig();
console.log(`GET ${cfg.baseUrl}/models`);

const headers: Record<string, string> = {
  Authorization: `Bearer ${cfg.apiKey}`,
  ...cfg.headers,
};

const res = await getJson(`${cfg.baseUrl}/models`, headers);
if (res.status < 200 || res.status >= 300) {
  console.error(`HTTP ${res.status}: ${res.text.slice(0, 400)}`);
  process.exit(1);
}
try {
  const data = JSON.parse(res.text) as { data?: Array<{ id?: string }> };
  const ids = (data.data ?? []).map((m) => m.id).filter(Boolean);
  console.log(`\n${ids.length} model(s):`);
  for (const id of ids) console.log(`  - ${id}`);
} catch {
  console.log(res.text.slice(0, 800));
}
