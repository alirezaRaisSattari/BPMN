import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { SessionStateSchema, type SessionState } from "../schemas/session.js";

/** Persistence boundary for sessions — swappable for a DB later. */
export interface SessionStore {
  get(id: string): Promise<SessionState | undefined>;
  save(session: SessionState): Promise<void>;
  list(): Promise<string[]>;
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
  async list(): Promise<string[]> {
    return [...this.map.keys()];
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

  async list(): Promise<string[]> {
    try {
      const files = await readdir(this.dir);
      return files.filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
    } catch {
      return [];
    }
  }
}
