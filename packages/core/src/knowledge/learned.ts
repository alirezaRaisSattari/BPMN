import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import {
  LearnedEntrySchema,
  type LearnedEntry,
  type LearnedSource,
} from "../schemas/feedback.js";
import type { KnowledgeChunk } from "../schemas/knowledge.js";

/** Normalize text for duplicate detection (whitespace + trailing punctuation). */
export function normalizeStatement(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/[.。،؛!?…\s]+$/u, "")
    .trim()
    .toLowerCase();
}

export const LEARNED_DOC_ID = "learned-from-feedback";
export const LEARNED_DOC_TITLE = "دانش آموخته از بازخورد ادمین";

/** Map a learned entry to a retrievable chunk (entry id doubles as chunk id). */
export function learnedToChunk(entry: LearnedEntry): KnowledgeChunk {
  return {
    id: entry.id,
    docId: LEARNED_DOC_ID,
    docTitle: LEARNED_DOC_TITLE,
    kind: entry.kind,
    text: entry.text,
    embedding: [],
    tags: entry.tags,
  };
}

/**
 * Source of truth for admin-approved knowledge, kept separate from the
 * markdown corpus so entries carry provenance and can be removed individually.
 * The server injects these chunks into the retriever at startup and on accept.
 */
export class LearnedKnowledgeStore {
  private entries: LearnedEntry[] = [];

  constructor(private readonly path: string) {}

  static async load(path: string): Promise<LearnedKnowledgeStore> {
    const store = new LearnedKnowledgeStore(path);
    if (existsSync(path)) {
      try {
        const raw = await readFile(path, "utf8");
        const data = JSON.parse(raw) as { entries?: unknown[] };
        store.entries = (data.entries ?? []).map((e) => LearnedEntrySchema.parse(e));
      } catch {
        store.entries = [];
      }
    }
    return store;
  }

  list(): LearnedEntry[] {
    // Most-reinforced first, then most recent.
    return [...this.entries].sort(
      (a, b) => b.weight - a.weight || b.createdAt.localeCompare(a.createdAt),
    );
  }

  get(id: string): LearnedEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }

  async add(entry: LearnedEntry): Promise<void> {
    this.entries.push(LearnedEntrySchema.parse(entry));
    await this.persist();
  }

  /** Find an existing entry whose text is (normalized) identical to `text`. */
  findByText(text: string): LearnedEntry | undefined {
    const key = normalizeStatement(text);
    return this.entries.find((e) => normalizeStatement(e.text) === key);
  }

  /**
   * Reinforce an existing entry with another confirming source: increments its
   * weight and appends provenance. Returns the updated entry.
   */
  async reinforce(id: string, source: LearnedSource): Promise<LearnedEntry | undefined> {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return undefined;
    entry.weight += 1;
    entry.sources.push(source);
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

  /** Persist after mutating an entry in place (e.g. an admin edit via `get`). */
  async save(): Promise<void> {
    await this.persist();
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify({ entries: this.entries }, null, 2), "utf8");
  }
}
