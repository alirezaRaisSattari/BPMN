import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { Bm25Index } from "../knowledge/bm25.js";
import { ExampleEntrySchema, type ExampleEntry } from "../schemas/example.js";

/** Read-side contract the logical-model agent uses to fetch worked examples. */
export interface ExampleBank {
  findSimilar(request: string, k: number, excludeSessionId?: string): ExampleEntry[];
}

/**
 * Golden example bank — reviewed sessions promoted to worked examples, kept in
 * one JSON file (same shape as the learned-knowledge store). `findSimilar`
 * ranks stored examples by request-text overlap (BM25) so the logical-model
 * agent can be shown the closest admin-approved solution as a few-shot guide.
 */
export class ExampleStore implements ExampleBank {
  private entries: ExampleEntry[] = [];

  constructor(private readonly path: string) {}

  static async load(path: string): Promise<ExampleStore> {
    const store = new ExampleStore(path);
    if (existsSync(path)) {
      try {
        const data = JSON.parse(await readFile(path, "utf8")) as { entries?: unknown[] };
        store.entries = (data.entries ?? []).map((e) => ExampleEntrySchema.parse(e));
      } catch {
        store.entries = [];
      }
    }
    return store;
  }

  list(): ExampleEntry[] {
    return [...this.entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): ExampleEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }

  async add(entry: ExampleEntry): Promise<void> {
    this.entries.push(ExampleEntrySchema.parse(entry));
    await this.persist();
  }

  async remove(id: string): Promise<boolean> {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.id !== id);
    if (this.entries.length === before) return false;
    await this.persist();
    return true;
  }

  findSimilar(request: string, k = 1, excludeSessionId?: string): ExampleEntry[] {
    const pool = this.entries.filter((e) => e.sessionId !== excludeSessionId);
    if (pool.length === 0) return [];
    const index = new Bm25Index();
    for (const e of pool) index.add(e.id, e.request);
    const hits = index.search(request, k);
    const byId = new Map(pool.map((e) => [e.id, e]));
    return hits.map((h) => byId.get(h.id)).filter((e): e is ExampleEntry => e !== undefined);
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify({ entries: this.entries }, null, 2), "utf8");
  }
}
