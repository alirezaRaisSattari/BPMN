/** Ingest the repo `knowledge/` folder and probe keyword retrieval (no network). */
import { buildKnowledge } from "./index.js";

const kb = await buildKnowledge({
  knowledgeDir: "knowledge",
  indexPath: "data/knowledge-index.json",
  rebuild: true,
});
console.log("index size (chunks):", kb.size);
for (const q of [
  "مسیر رد درخواست و تصمیم",
  "فعالیت سیستمی توسط چه کسی انجام میشود",
  "audit log عملیات حساس",
]) {
  const r = await kb.retrieve(q, 1);
  const top = r[0];
  console.log(`Q: ${q}\n  -> ${top ? `[${top.chunk.kind}] ${top.chunk.docTitle} (${top.score.toFixed(2)})` : "no match"}`);
}
