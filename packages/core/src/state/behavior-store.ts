import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import {
  BehaviorEntrySchema,
  type BehaviorAgent,
  type BehaviorEntry,
} from "../schemas/behavior.js";
import type { LearnedSource } from "../schemas/feedback.js";
import { normalizeStatement } from "../knowledge/learned.js";

/** Read-side contract the agents use to fetch their behavioral instructions. */
export interface BehaviorLookup {
  instructionsFor(agent: BehaviorAgent): string[];
}

/** How many instructions to inject per agent (highest-weight first). */
const MAX_PER_AGENT = 8;

/**
 * Behavioral instructions store — accepted feedback about *how an agent should
 * behave*, kept per-agent in one JSON file. Each agent appends its top entries
 * to its system prompt, so a behavior rule applies on every run (unlike RAG
 * knowledge, which only helps when retrieval hits). Reinforce-on-duplicate
 * mirrors the learned-knowledge store.
 */
export class BehaviorStore implements BehaviorLookup {
  private entries: BehaviorEntry[] = [];

  constructor(private readonly path: string) {}

  static async load(path: string): Promise<BehaviorStore> {
    const store = new BehaviorStore(path);
    if (existsSync(path)) {
      try {
        const data = JSON.parse(await readFile(path, "utf8")) as { entries?: unknown[] };
        store.entries = (data.entries ?? []).map((e) => BehaviorEntrySchema.parse(e));
      } catch {
        store.entries = [];
      }
    }
    return store;
  }

  list(): BehaviorEntry[] {
    return [...this.entries].sort(
      (a, b) =>
        a.agent.localeCompare(b.agent) ||
        b.weight - a.weight ||
        b.createdAt.localeCompare(a.createdAt),
    );
  }

  get(id: string): BehaviorEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }

  /** Instruction texts for one agent, highest-weight first, capped. */
  instructionsFor(agent: BehaviorAgent): string[] {
    return this.entries
      .filter((e) => e.agent === agent)
      .sort((a, b) => b.weight - a.weight || b.createdAt.localeCompare(a.createdAt))
      .slice(0, MAX_PER_AGENT)
      .map((e) => e.instruction);
  }

  /** Find an entry for the same agent whose instruction is (normalized) identical. */
  findByText(agent: BehaviorAgent, instruction: string): BehaviorEntry | undefined {
    const key = normalizeStatement(instruction);
    return this.entries.find(
      (e) => e.agent === agent && normalizeStatement(e.instruction) === key,
    );
  }

  async add(entry: BehaviorEntry): Promise<void> {
    this.entries.push(BehaviorEntrySchema.parse(entry));
    await this.persist();
  }

  async reinforce(id: string, source: LearnedSource): Promise<BehaviorEntry | undefined> {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return undefined;
    entry.weight += 1;
    entry.sources.push(source);
    await this.persist();
    return entry;
  }

  async update(
    id: string,
    patch: { instruction?: string; agent?: BehaviorAgent },
  ): Promise<BehaviorEntry | undefined> {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return undefined;
    if (patch.instruction !== undefined) entry.instruction = patch.instruction;
    if (patch.agent !== undefined) entry.agent = patch.agent;
    await this.persist();
    return entry;
  }

  async remove(id: string): Promise<boolean> {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.id !== id);
    if (this.entries.length === before) return false;
    await this.persist();
    return true;
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify({ entries: this.entries }, null, 2), "utf8");
  }
}
