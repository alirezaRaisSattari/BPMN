import { appendFile, readFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { RetrievalLogEntrySchema, type RetrievalLogEntry } from "../schemas/knowledge.js";

/**
 * Append-only JSONL log of every grounding retrieval. Unlike session citations
 * (which record only *hits*), this captures the query and top score of every
 * lookup — so low-score lines reveal what the knowledge base fails to answer.
 * JSONL keeps writes O(1) and never rebuilds an index.
 */
export class RetrievalLog {
  constructor(private readonly path: string) {}

  async append(entry: RetrievalLogEntry): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, JSON.stringify(entry) + "\n", "utf8");
  }

  /** Read the log newest-first, tolerating partial/corrupt lines. */
  async read(): Promise<RetrievalLogEntry[]> {
    let raw: string;
    try {
      raw = await readFile(this.path, "utf8");
    } catch {
      return [];
    }
    const entries: RetrievalLogEntry[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        entries.push(RetrievalLogEntrySchema.parse(JSON.parse(line)));
      } catch {
        /* skip malformed line */
      }
    }
    return entries.reverse();
  }
}

/** One knowledge gap: a query the base could not ground, with how often it recurred. */
export interface KnowledgeGap {
  query: string;
  count: number;
  worstScore: number;
  lastAt: string;
  phases: string[];
}

/**
 * Collapse low-score retrievals into distinct gaps. A line is a gap when it
 * returned nothing or its best match scored below `threshold`. Grouped by
 * normalized query text so the same recurring question surfaces once with a
 * count rather than flooding the list.
 */
export function computeGaps(entries: RetrievalLogEntry[], threshold = 1): KnowledgeGap[] {
  const norm = (q: string) => q.replace(/\s+/g, " ").trim().toLowerCase();
  const gaps = new Map<string, KnowledgeGap>();
  for (const e of entries) {
    if (e.chunkIds.length > 0 && e.topScore >= threshold) continue;
    const key = norm(e.query);
    if (!key) continue;
    const g = gaps.get(key);
    if (g) {
      g.count += 1;
      g.worstScore = Math.min(g.worstScore, e.topScore);
      if (e.at > g.lastAt) g.lastAt = e.at;
      if (!g.phases.includes(e.phase)) g.phases.push(e.phase);
    } else {
      gaps.set(key, {
        query: e.query,
        count: 1,
        worstScore: e.topScore,
        lastAt: e.at,
        phases: [e.phase],
      });
    }
  }
  // Most-recurring first, then most recent.
  return [...gaps.values()].sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt));
}
