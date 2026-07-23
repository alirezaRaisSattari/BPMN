/**
 * CLI: run all golden eval cases against their stored sessions and report.
 * Usage: `npm run eval -w @bpmn-analyst/core` (from repo root: `npm run eval`).
 * Exits non-zero if any case fails — suitable for CI.
 */
import { join } from "node:path";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { FileEvalStore } from "../state/eval-store.js";
import { FileSessionStore } from "../state/store.js";
import { runEvalCase } from "./runner.js";

function findRepoRoot(start = process.cwd()): string {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "knowledge")) && existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

async function main(): Promise<void> {
  const root = findRepoRoot();
  const evalStore = new FileEvalStore(join(root, "data", "eval"));
  const sessions = new FileSessionStore(join(root, "data", "sessions"));

  const cases = await evalStore.list();
  if (cases.length === 0) {
    console.log("هیچ کیس ارزیابی ثبت نشده است (data/eval خالی است).");
    return;
  }

  let failed = 0;
  for (const c of cases) {
    const session = await sessions.get(c.sessionId);
    if (!session) {
      console.log(`✖ ${c.request || c.id}: جلسهٔ مرجع یافت نشد (${c.sessionId})`);
      failed++;
      continue;
    }
    const result = await runEvalCase(c, session);
    const mark = result.passed ? "✓" : "✖";
    console.log(`${mark} ${c.request || c.id}`);
    for (const check of result.checks) {
      const cm = check.passed ? "  ✓" : "  ✖";
      console.log(`${cm} ${check.label}${check.detail ? ` — ${check.detail}` : ""}`);
    }
    if (!result.passed) failed++;
  }

  console.log(`\n${cases.length - failed}/${cases.length} کیس موفق.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("eval failed:", err);
  process.exit(1);
});
