import { readFile, writeFile, readdir, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { SessionStateSchema, type SessionState } from "../schemas/session.js";

/** Lightweight session info for list views (no messages/analysis payload). */
export interface SessionSummary {
  id: string;
  request: string;
  phase: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

function summarize(session: SessionState): SessionSummary {
  return {
    id: session.id,
    request: session.request,
    phase: session.phase,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
  };
}

/** Persistence boundary for sessions — swappable for a DB later. */
export interface SessionStore {
  get(id: string): Promise<SessionState | undefined>;
  save(session: SessionState): Promise<void>;
  list(): Promise<SessionSummary[]>;
  /** Remove a session. Resolves to `false` if no such session existed. */
  remove(id: string): Promise<boolean>;
}

/** In-memory store (tests / ephemeral use). */
export class MemorySessionStore implements SessionStore {
  private readonly map = new Map<string, SessionState>();
  async get(id: string): Promise<SessionState | undefined> {
    return this.map.get(id);
  }
  async save(session: SessionState): Promise<void> {
    this.map.set(session.id, session);
  }
  async list(): Promise<SessionSummary[]> {
    return [...this.map.values()]
      .map(summarize)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async remove(id: string): Promise<boolean> {
    return this.map.delete(id);
  }
}

/** File-backed store: one JSON file per session under `dir`. */
export class FileSessionStore implements SessionStore {
  constructor(private readonly dir: string) {}

  private path(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  async get(id: string): Promise<SessionState | undefined> {
    try {
      const raw = await readFile(this.path(id), "utf8");
      return SessionStateSchema.parse(JSON.parse(raw));
    } catch {
      return undefined;
    }
  }

  async save(session: SessionState): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.path(session.id), JSON.stringify(session, null, 2), "utf8");
  }

  async list(): Promise<SessionSummary[]> {
    let files: string[];
    try {
      files = (await readdir(this.dir)).filter((f) => f.endsWith(".json"));
    } catch {
      return [];
    }
    const summaries = await Promise.all(
      files.map(async (f) => {
        try {
          const raw = await readFile(join(this.dir, f), "utf8");
          return summarize(SessionStateSchema.parse(JSON.parse(raw)));
        } catch {
          return undefined;
        }
      }),
    );
    return summaries
      .filter((s): s is SessionSummary => s !== undefined)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async remove(id: string): Promise<boolean> {
    try {
      await rm(this.path(id));
      return true;
    } catch {
      return false;
    }
  }
}
