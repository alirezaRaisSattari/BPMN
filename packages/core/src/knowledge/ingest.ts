import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { knowledgeKinds, type KnowledgeChunk, type KnowledgeKind } from "../schemas/knowledge.js";
import type { KnowledgeStore } from "./store.js";

export interface IngestOptions {
  chunkSize?: number; // target characters per chunk
  overlap?: number; // paragraphs of overlap between chunks
}

interface ParsedDoc {
  title: string;
  kind: KnowledgeKind;
  tags: string[];
  body: string;
}

/** Parse optional `--- key: value ---` frontmatter (title / kind / tags). */
export function parseDoc(raw: string, fallbackTitle: string): ParsedDoc {
  let title = fallbackTitle;
  let kind: KnowledgeKind = "other";
  let tags: string[] = [];
  let body = raw;

  const fm = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (fm && fm[1]) {
    body = raw.slice(fm[0].length);
    for (const line of fm[1].split("\n")) {
      const m = line.match(/^\s*([A-Za-z_]+)\s*:\s*(.+?)\s*$/);
      if (!m) continue;
      const key = m[1]!.toLowerCase();
      const value = m[2]!.trim();
      if (key === "title") title = value;
      else if (key === "kind" && (knowledgeKinds as readonly string[]).includes(value))
        kind = value as KnowledgeKind;
      else if (key === "tags")
        tags = value
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
    }
  }
  return { title, kind, tags, body };
}

export function chunkText(body: string, chunkSize = 1000, overlap = 1): string[] {
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return [];

  const chunks: string[] = [];
  let current: string[] = [];
  let size = 0;
  for (const p of paragraphs) {
    if (size > 0 && size + p.length > chunkSize) {
      chunks.push(current.join("\n\n"));
      current = current.slice(-overlap); // carry overlap paragraphs
      size = current.reduce((s, c) => s + c.length, 0);
    }
    current.push(p);
    size += p.length;
  }
  if (current.length) chunks.push(current.join("\n\n"));
  return chunks;
}

function docToChunks(docId: string, parsed: ParsedDoc, opts: IngestOptions): KnowledgeChunk[] {
  return chunkText(parsed.body, opts.chunkSize, opts.overlap).map((text, i) => ({
    id: `${docId}#${i}`,
    docId,
    docTitle: parsed.title,
    kind: parsed.kind,
    text,
    embedding: [],
    tags: parsed.tags,
  }));
}

/** Read all .md/.txt files in `dir`, chunk them and add to the store. */
export async function ingestDirectory(
  dir: string,
  store: KnowledgeStore,
  opts: IngestOptions = {},
): Promise<{ files: number; chunks: number }> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return { files: 0, chunks: 0 };
  }
  const docs = entries.filter((f) => [".md", ".txt", ".markdown"].includes(extname(f).toLowerCase()));

  let chunkCount = 0;
  for (const file of docs) {
    const raw = await readFile(join(dir, file), "utf8");
    const docId = basename(file, extname(file));
    const parsed = parseDoc(raw, docId);
    const chunks = docToChunks(docId, parsed, opts);
    await store.addChunks(chunks);
    chunkCount += chunks.length;
  }
  return { files: docs.length, chunks: chunkCount };
}
