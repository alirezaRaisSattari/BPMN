import { describe, it, expect } from "vitest";
import { z } from "zod";
import { extractJson } from "./provider.js";
import { MockProvider, synthesize } from "./mock.js";
import { ProcessModelSchema } from "../schemas/process-model.js";
import { newSession, SessionStateSchema } from "../schemas/session.js";

describe("extractJson", () => {
  it("parses a bare object", () => {
    expect(JSON.parse(extractJson('{"a":1}'))).toEqual({ a: 1 });
  });
  it("strips ```json fences", () => {
    expect(JSON.parse(extractJson('```json\n{"a":1}\n```'))).toEqual({ a: 1 });
  });
  it("ignores leading reasoning/prose", () => {
    const raw = 'Here is the answer:\n{"a": {"b": 2}} — done';
    expect(JSON.parse(extractJson(raw))).toEqual({ a: { b: 2 } });
  });
  it("handles braces inside strings", () => {
    const raw = '{"note":"a } bracket"}';
    expect(JSON.parse(extractJson(raw))).toEqual({ note: "a } bracket" });
  });
  it("parses arrays", () => {
    expect(JSON.parse(extractJson("[1,2,3]"))).toEqual([1, 2, 3]);
  });
});

describe("MockProvider", () => {
  it("returns schema-valid structured output", async () => {
    const llm = new MockProvider();
    const schema = z.object({ name: z.string(), tags: z.array(z.string()) });
    const out = await llm.completeStructured({
      schema,
      schemaName: "Thing",
      messages: [{ role: "user", content: "x" }],
    });
    expect(schema.safeParse(out).success).toBe(true);
  });
  it("honors fixtures", async () => {
    const llm = new MockProvider({ Thing: { name: "fixed", tags: ["a"] } });
    const schema = z.object({ name: z.string(), tags: z.array(z.string()) });
    const out = await llm.completeStructured({
      schema,
      schemaName: "Thing",
      messages: [{ role: "user", content: "x" }],
    });
    expect(out).toEqual({ name: "fixed", tags: ["a"] });
  });
});

describe("synthesize", () => {
  it("produces a value that satisfies the ProcessModel schema", () => {
    const sample = synthesize(ProcessModelSchema);
    expect(ProcessModelSchema.safeParse(sample).success).toBe(true);
  });
});

describe("session", () => {
  it("newSession is valid", () => {
    const s = newSession("s1", "design an order process");
    expect(SessionStateSchema.safeParse(s).success).toBe(true);
    expect(s.phase).toBe("intake");
  });
});
