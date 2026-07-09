/** Live end-to-end run (uses real tokens). Verifies chat → model → BPMN. */
import { createProvider } from "./llm/index.js";
import { buildKnowledge } from "./knowledge/index.js";
import { Orchestrator } from "./agents/index.js";
import { validateModel } from "./bpmn/index.js";
import { newSession } from "./schemas/index.js";

const llm = createProvider();
const retriever = await buildKnowledge({
  knowledgeDir: "knowledge",
  indexPath: "data/knowledge-index.json",
});
const orch = new Orchestrator({ llm, retriever });
const session = newSession("e2e-1");

const request =
  "طراحی فرآیند درخواست مرخصی تحصیلی دانشجو. دانشجو درخواست را در سامانه ثبت می‌کند. " +
  "سیستم بدهی مالی را بررسی می‌کند؛ اگر بدهی داشته باشد رد می‌شود. سپس استاد راهنما و بعد " +
  "کارشناس آموزش بررسی و تأیید یا رد می‌کنند. آغازکننده دانشجو است. پایان‌ها: تأیید نهایی یا رد.";

console.log(`provider=${llm.name} model=${llm.model} | knowledge chunks=${retriever.size}\n`);

let res = await orch.begin(session, request);
console.log(`[${res.phase}] awaiting=${res.awaitingUser}\n${res.reply}\n---`);

for (let i = 0; i < 4 && res.phase !== "done"; i++) {
  res = await orch.respond(session, "بله تأیید می‌کنم، ادامه بده و مدل را بساز.");
  console.log(`[${res.phase}] awaiting=${res.awaitingUser}\n${res.reply}\n---`);
}

if (session.processModel) {
  const v = validateModel(session.processModel);
  console.log(
    `\nMODEL: activities=${session.processModel.activities.length} gateways=${session.processModel.gateways.length} roles=${session.roles.length}`,
  );
  console.log(`VALID: ${v.valid} | errors=${v.errors.length} warnings=${v.warnings.length}`);
  console.log(`BPMN has DI: ${session.outputs.bpmnXml?.includes("BPMNShape")}`);
  console.log(`document chars: ${session.outputs.document?.length ?? 0}`);
} else {
  console.log("\nNo process model produced (still in interview).");
}
