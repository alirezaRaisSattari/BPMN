import { readFile, writeFile, readdir, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { EvalCaseSchema, type EvalCase } from "../schemas/eval.js";

/** Persistence boundary for golden evaluation cases. */
export interface EvalStore {
  get(id: string): Promise<EvalCase | undefined>;
  save(evalCase: EvalCase): Promise<void>;
  list(): Promise<EvalCase[]>;
  remove(id: string): Promise<boolean>;
}

/** File-backed store: one JSON file per eval case under `dir`. */
export class FileEvalStore implements EvalStore {
  constructor(private readonly dir: string) {}

  private path(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  async get(id: string): Promise<EvalCase | undefined> {
    try {
      return EvalCaseSchema.parse(JSON.parse(await readFile(this.path(id), "utf8")));
    } catch {
      return undefined;
    }
  }

  async save(evalCase: EvalCase): Promise<void> {
    const parsed = EvalCaseSchema.parse(evalCase); // validate/strip unknown fields
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.path(parsed.id), JSON.stringify(parsed, null, 2), "utf8");
  }

  async list(): Promise<EvalCase[]> {
    let files: string[];
    try {
      files = (await readdir(this.dir)).filter((f) => f.endsWith(".json"));
    } catch {
      return [];
    }
    const items = await Promise.all(
      files.map(async (f) => {
        try {
          return EvalCaseSchema.parse(JSON.parse(await readFile(join(this.dir, f), "utf8")));
        } catch {
          return undefined;
        }
      }),
    );
    return items
      .filter((c): c is EvalCase => c !== undefined)
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
