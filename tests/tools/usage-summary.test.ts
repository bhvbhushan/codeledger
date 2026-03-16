import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { createConnection } from "../../src/db/connection.js";
import { runMigrations } from "../../src/db/migrate.js";
import { seedPricing } from "../../src/db/pricing.js";
import { queryUsageSummary } from "../../src/tools/usage-summary.js";

const TEST_DB = "/tmp/codeledger-usage-test.db";
let db: any;

beforeEach(() => {
  db = createConnection(TEST_DB);
  runMigrations(db);
  seedPricing(db);

  // Seed test data
  const today = new Date().toISOString().split("T")[0];
  db.prepare("INSERT INTO projects (path, display_name, cwd, first_seen, last_active, total_cost_usd) VALUES (?, ?, ?, ?, ?, ?)").run("-tmp-proj1", "proj1", "/tmp/proj1", today, today, 5.50);
  db.prepare("INSERT INTO sessions (id, project_id, started_at, primary_model, total_input_tokens, total_output_tokens, total_cost_usd, message_count) VALUES (?, 1, ?, ?, ?, ?, ?, ?)").run("sess-1", today + "T10:00:00Z", "claude-opus-4-6", 1000, 500, 5.50, 10);
  db.prepare("INSERT INTO daily_summaries (date, project_id, model, total_input_tokens, total_output_tokens, total_cost_usd, session_count) VALUES (?, 1, ?, ?, ?, ?, ?)").run(today, "claude-opus-4-6", 1000, 500, 5.50, 1);
});

afterEach(() => {
  db.close();
  for (const ext of ["", "-wal", "-shm"]) {
    if (existsSync(TEST_DB + ext)) unlinkSync(TEST_DB + ext);
  }
});

describe("usage_summary tool", () => {
  it("returns summary for today", () => {
    const result = queryUsageSummary(db, "today");
    expect(result.totalCostUsd).toBeCloseTo(5.50);
    expect(result.sessionCount).toBe(1);
    expect(result.topProject).toBe("proj1");
  });

  it("returns empty summary when no data", () => {
    db.prepare("DELETE FROM sessions").run();
    db.prepare("DELETE FROM daily_summaries").run();
    const result = queryUsageSummary(db, "today");
    expect(result.totalCostUsd).toBe(0);
    expect(result.sessionCount).toBe(0);
  });

  it("returns model distribution", () => {
    const result = queryUsageSummary(db, "today");
    expect(result.modelDistribution).toHaveLength(1);
    expect(result.modelDistribution[0].model).toBe("claude-opus-4-6");
    expect(result.modelDistribution[0].pct).toBe(100);
  });

  it("filters by project name", () => {
    const today = new Date().toISOString().split("T")[0];
    db.prepare("INSERT INTO projects (path, display_name, cwd, first_seen, last_active, total_cost_usd) VALUES (?, ?, ?, ?, ?, ?)").run("-tmp-proj2", "proj2", "/tmp/proj2", today, today, 3.00);
    db.prepare("INSERT INTO sessions (id, project_id, started_at, primary_model, total_input_tokens, total_output_tokens, total_cost_usd, message_count) VALUES (?, 2, ?, ?, ?, ?, ?, ?)").run("sess-2", today + "T11:00:00Z", "claude-sonnet-4-6", 2000, 800, 3.00, 5);

    const result = queryUsageSummary(db, "today", "proj1");
    expect(result.totalCostUsd).toBeCloseTo(5.50);
    expect(result.sessionCount).toBe(1);
    expect(result.topProject).toBe("proj1");
  });

  it("returns all-time summary", () => {
    const result = queryUsageSummary(db, "all");
    expect(result.totalCostUsd).toBeCloseTo(5.50);
    expect(result.sessionCount).toBe(1);
  });

  it("returns token counts", () => {
    const result = queryUsageSummary(db, "today");
    expect(result.totalInputTokens).toBe(1000);
    expect(result.totalOutputTokens).toBe(500);
  });
});
