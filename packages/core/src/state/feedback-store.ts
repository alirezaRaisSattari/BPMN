import { readFile, writeFile, readdir, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { AdminFeedbackSchema, type AdminFeedback } from "../schemas/feedback.js";

/** Persistence boundary for admin feedback — swappable for a DB later. */
export interface FeedbackStore {
  get(id: string): Promise<AdminFeedback | undefined>;
  save(feedback: AdminFeedback): Promise<void>;
  /** All feedback, newest first. Items are small, so lists return full objects. */
  list(): Promise<AdminFeedback[]>;
  remove(id: string): Promise<boolean>;
}

/** File-backed store: one JSON file per feedback under `dir`. */
export class FileFeedbackStore implements FeedbackStore {
  constructor(private readonly dir: string) {}

  private path(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  async get(id: string): Promise<AdminFeedback | undefined> {
    try {
      const raw = await readFile(this.path(id), "utf8");
      return AdminFeedbackSchema.parse(JSON.parse(raw));
    } catch {
      return undefined;
    }
  }

  async save(feedback: AdminFeedback): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.path(feedback.id), JSON.stringify(feedback, null, 2), "utf8");
  }

  async list(): Promise<AdminFeedback[]> {
    let files: string[];
    try {
      files = (await readdir(this.dir)).filter((f) => f.endsWith(".json"));
    } catch {
      return [];
    }
    const items = await Promise.all(
      files.map(async (f) => {
        try {
          const raw = await readFile(join(this.dir, f), "utf8");
          return AdminFeedbackSchema.parse(JSON.parse(raw));
        } catch {
          return undefined;
        }
      }),
    );
    return items
      .filter((i): i is AdminFeedback => i !== undefined)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
