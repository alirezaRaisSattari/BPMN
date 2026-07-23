import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Persistent set of base-corpus chunk ids the admin has disabled. The BM25
 * index is a *cache* rebuilt from the markdown corpus, so a disable can't live
 * inside it — it would vanish on the next rebuild. This file is the durable
 * record; the server re-applies it to the retriever at startup (after the base
 * index and learned chunks load), mirroring how learned knowledge is injected.
 */
export class KnowledgeOverridesStore {
  private disabled = new Set<string>();

  constructor(private readonly path: string) {}

  static async load(path: string): Promise<KnowledgeOverridesStore> {
    const store = new KnowledgeOverridesStore(path);
    if (existsSync(path)) {
      try {
        const data = JSON.parse(await readFile(path, "utf8")) as { disabled?: string[] };
        store.disabled = new Set(data.disabled ?? []);
      } catch {
        store.disabled = new Set();
      }
    }
    return store;
  }

  list(): string[] {
    return [...this.disabled];
  }

  has(id: string): boolean {
    return this.disabled.has(id);
  }

  async disable(id: string): Promise<void> {
    this.disabled.add(id);
    await this.persist();
  }

  async enable(id: string): Promise<void> {
    this.disabled.delete(id);
    await this.persist();
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify({ disabled: [...this.disabled] }, null, 2), "utf8");
  }
}
