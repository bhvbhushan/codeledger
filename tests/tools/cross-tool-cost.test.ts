import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { createConnection } from "../../src/db/connection.js";
import { runMigrations } from "../../src/db/migrate.js";
import { seedPricing } from "../../src/db/pricing.js";
import { queryCrossToolCost } from "../../src/tools/cross-tool-cost.js";

const TEST_DB = "/tmp/codeledger-cross-tool-cost-test.db";
let db: any;

beforeEach(() => {
  db = createConnection(TEST_DB);
  runMigrations(db);
  seedPricing(db);
});

afterEach(() => {
  db.close();
  for (const ext of ["", "-wal", "-shm"]) {
    if (existsSync(TEST_DB + ext)) unlinkSync(TEST_DB + ext);
  }
});

function seedProject(name = "proj1") {
  const now = new Date();
  const today =
    now.getFullYear() +
    "-" +
    String(now.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(now.getDate()).padStart(2, "0");
  db.prepare(
    "INSERT OR IGNORE INTO projects (path, display_name, cwd, first_seen, last_active) VALUES (?, ?, ?, ?, ?)",
  ).run(`/tmp/${name}`, name, `/tmp/${name}`, today, today);
}

function seedSession(
  id: string,
  cost: number,
  tool: string,
  provider: string,
  projectId = 1,
  inputTokens = 1000,
  outputTokens = 500,
) {
  const now = new Date();
  const today =
    now.getFullYear() +
    "-" +
    String(now.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(now.getDate()).padStart(2, "0");
  db.prepare(
    `INSERT INTO sessions (id, project_id, started_at, primary_model, total_cost_usd,
     total_input_tokens, total_output_tokens, message_count, tool, provider)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    projectId,
    today + "T10:00:00Z",
    "claude-opus-4-6",
    cost,
    inputTokens,
    outputTokens,
    5,
    tool,
    provider,
  );
}

describe("cross_tool_cost", () => {
  it("returns single row for claude-only data", () => {
    seedProject();
    seedSession("s1", 5.0, "claude-code", "anthropic");
    seedSession("s2", 3.0, "claude-code", "anthropic");

    const rows = queryCrossToolCost(db, "today");
    expect(rows).toHaveLength(1);
    expect(rows[0].tool).toBe("claude-code");
    expect(rows[0].sessions).toBe(2);
    expect(rows[0].cost).toBeCloseTo(8.0);
  });

  it("returns grouped breakdown for multi-tool data", () => {
    seedProject();
    seedSession("s1", 5.0, "claude-code", "anthropic");
    seedSession("s2", 2.0, "codex-cli", "openai");
    seedSession("s3", 1.5, "gemini-cli", "google");

    const rows = queryCrossToolCost(db, "today");
    expect(rows).toHaveLength(3);

    const claude = rows.find((r) => r.tool === "claude-code");
    const codex = rows.find((r) => r.tool === "codex-cli");
    const gemini = rows.find((r) => r.tool === "gemini-cli");

    expect(claude).toBeTruthy();
    expect(codex).toBeTruthy();
    expect(gemini).toBeTruthy();

    expect(claude!.cost).toBeCloseTo(5.0);
    expect(codex!.cost).toBeCloseTo(2.0);
    expect(gemini!.cost).toBeCloseTo(1.5);
  });

  it("returns filtered result when tool param is provided", () => {
    seedProject();
    seedSession("s1", 5.0, "claude-code", "anthropic");
    seedSession("s2", 2.0, "codex-cli", "openai");
    seedSession("s3", 1.5, "gemini-cli", "google");

    const rows = queryCrossToolCost(db, "today", "codex-cli");
    expect(rows).toHaveLength(1);
    expect(rows[0].tool).toBe("codex-cli");
    expect(rows[0].cost).toBeCloseTo(2.0);
  });
});
