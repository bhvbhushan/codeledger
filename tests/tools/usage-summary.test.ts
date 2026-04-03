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
  const now = new Date(); const today = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
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
    const now = new Date(); const today = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
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

  it("returns spend velocity for multi-day data", () => {
    // Add a second session 2 days ago
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000);
    const twoDaysAgoStr = twoDaysAgo.toISOString().split('T')[0];
    db.prepare("INSERT INTO sessions (id, project_id, started_at, primary_model, total_cost_usd, message_count) VALUES (?, 1, ?, ?, ?, ?)")
      .run("sess-old", twoDaysAgoStr + "T10:00:00Z", "claude-opus-4-6", 10.00, 5);

    const result = queryUsageSummary(db, "all");
    expect(result.velocityPerDay).not.toBeNull();
    expect(result.velocityPerDay!).toBeGreaterThan(0);
    expect(result.projectedMonthly).not.toBeNull();
    expect(result.projectedMonthly!).toBeCloseTo(result.velocityPerDay! * 30);
  });

  it("returns null velocity when no sessions", () => {
    db.prepare("DELETE FROM sessions").run();
    const result = queryUsageSummary(db, "today");
    expect(result.velocityPerDay).toBeNull();
    expect(result.projectedMonthly).toBeNull();
  });

  it("returns velocity for single day", () => {
    const result = queryUsageSummary(db, "today");
    // Single day: days_elapsed < 1, velocity should be null OR equal to day's total
    // Guard: if less than 1 day elapsed, velocity is null
    expect(result.velocityPerDay).toBeNull();
  });

  it("returns velocity for period=all with long range", () => {
    // Add session from 30 days ago
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
    const dateStr = thirtyDaysAgo.toISOString().split('T')[0];
    db.prepare("INSERT INTO sessions (id, project_id, started_at, primary_model, total_cost_usd, message_count) VALUES (?, 1, ?, ?, ?, ?)")
      .run("sess-month-ago", dateStr + "T10:00:00Z", "claude-opus-4-6", 30.00, 10);

    const result = queryUsageSummary(db, "all");
    expect(result.velocityPerDay).not.toBeNull();
    // Total: 5.50 + 30.00 = 35.50 over ~30 days ≈ ~1.18/day
    expect(result.velocityPerDay!).toBeGreaterThan(1);
    expect(result.velocityPerDay!).toBeLessThan(2);
  });

  it("returns costliest session", () => {
    // Add a more expensive session
    const now = new Date();
    const today = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
    db.prepare("INSERT INTO sessions (id, project_id, started_at, primary_model, total_cost_usd, message_count) VALUES (?, 1, ?, ?, ?, ?)")
      .run("sess-expensive", today + "T12:00:00Z", "claude-opus-4-6", 25.00, 20);

    const result = queryUsageSummary(db, "today");
    expect(result.costliestSession).not.toBeNull();
    expect(result.costliestSession!.cost).toBe(25.00);
    expect(result.costliestSession!.project).toBe("proj1");
  });

  it("returns null costliest session when no data", () => {
    db.prepare("DELETE FROM sessions").run();
    const result = queryUsageSummary(db, "today");
    expect(result.costliestSession).toBeNull();
  });
});
