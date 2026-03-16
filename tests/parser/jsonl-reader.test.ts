import { describe, it, expect } from "vitest";
import { resolve } from "path";
import { readJsonlLines } from "../../src/parser/jsonl-reader.js";

const FIXTURES = resolve(import.meta.dirname, "../fixtures");

describe("jsonl-reader", () => {
  it("reads all lines from a simple session", async () => {
    const lines = await readJsonlLines(`${FIXTURES}/simple-session.jsonl`);
    expect(lines.length).toBe(5); // 2 user + 2 assistant + 1 last-prompt
  });

  it("filters by type", async () => {
    const lines = await readJsonlLines(`${FIXTURES}/simple-session.jsonl`, {
      types: ["assistant"],
    });
    expect(lines.every((l) => l.type === "assistant")).toBe(true);
  });

  it("skips malformed lines without crashing", async () => {
    const { writeFileSync, unlinkSync } = await import("fs");
    const tmp = "/tmp/codeledger-bad.jsonl";
    writeFileSync(tmp, '{"type":"assistant"}\n{INVALID JSON}\n{"type":"user"}\n');
    const lines = await readJsonlLines(tmp);
    expect(lines.length).toBe(2); // skipped the bad line
    unlinkSync(tmp);
  });

  it("handles empty file", async () => {
    const { writeFileSync, unlinkSync } = await import("fs");
    const tmp = "/tmp/codeledger-empty.jsonl";
    writeFileSync(tmp, "");
    const lines = await readJsonlLines(tmp);
    expect(lines.length).toBe(0);
    unlinkSync(tmp);
  });
});
