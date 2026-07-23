import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** Walk up from cwd to the repo root (the dir containing `knowledge/`). */
export function findRepoRoot(start = process.cwd()): string {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "knowledge")) && existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

export function repoPaths(root = findRepoRoot()) {
  return {
    root,
    knowledgeDir: join(root, "knowledge"),
    indexPath: join(root, "data", "knowledge-index.json"),
    sessionsDir: join(root, "data", "sessions"),
    feedbackDir: join(root, "data", "feedback"),
    learnedPath: join(root, "data", "learned-knowledge.json"),
    evalDir: join(root, "data", "eval"),
    retrievalLogPath: join(root, "data", "retrieval-log.jsonl"),
    overridesPath: join(root, "data", "knowledge-overrides.json"),
    examplesPath: join(root, "data", "examples.json"),
    behaviorPath: join(root, "data", "behavior.json"),
  };
}
