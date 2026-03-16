import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { createConnection } from "../../src/db/connection.js";
import { runMigrations } from "../../src/db/migrate.js";
import { seedPricing } from "../../src/db/pricing.js";
import { generateRecommendations } from "../../src/tools/cost-optimize.js";

const TEST_DB = "/tmp/codeledger-optimize-test.db";
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

function seedProject() {
  db.prepare(
    "INSERT INTO projects (path, display_name, cwd, first_seen, last_active) VALUES (?, ?, ?, ?, ?)"
  ).run("test", "test", "/test", "2026-01-01", "2026-03-16");
}

describe("cost_optimize", () => {
  it("returns no recommendations when no data", () => {
    const recs = generateRecommendations(db, "all");
    expect(recs).toHaveLength(0);
  });

  it("recommends Sonnet for Opus exploration sessions", () => {
    seedProject();
    db.prepare(
      "INSERT INTO sessions (id, project_id, started_at, primary_model, category, total_cost_usd, total_input_tokens, total_output_tokens, message_count) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)"
    ).run("s1", "2026-03-16T10:00:00Z", "claude-opus-4-6", "exploration", 15.00, 100000, 50000, 10);

    const recs = generateRecommendations(db, "all");
    const explorationRec = recs.find(r => r.what.includes("exploration"));
    expect(explorationRec).toBeTruthy();
    expect(explorationRec!.potential_savings).toBeGreaterThan(0);
    expect(explorationRec!.evidence).toContain("1 sessions");
  });

  it("recommends reducing overhead when > 15%", () => {
    seedProject();
    db.prepare(
      "INSERT INTO sessions (id, project_id, started_at, primary_model, total_cost_usd, message_count) VALUES (?, 1, ?, ?, ?, ?)"
    ).run("s1", "2026-03-16T10:00:00Z", "claude-opus-4-6", 10.00, 5);

    // User agent
    db.prepare(
      "INSERT INTO agents (id, session_id, agent_type, total_cost_usd, started_at, message_count, source_category) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("agent-user1", "s1", "general-purpose", 5.00, "2026-03-16T10:01:00Z", 3, "user");

    // Overhead agent (>15% of total)
    db.prepare(
      "INSERT INTO agents (id, session_id, agent_type, total_cost_usd, started_at, message_count, source_category) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("agent-overhead1", "s1", "general-purpose", 3.00, "2026-03-16T10:02:00Z", 2, "overhead");

    const recs = generateRecommendations(db, "all");
    const overheadRec = recs.find(r => r.what.includes("overhead"));
    expect(overheadRec).toBeTruthy();
    expect(overheadRec!.evidence).toContain("$3.00");
  });

  it("does NOT recommend if savings are minimal (<$0.50)", () => {
    seedProject();
    // Tiny exploration session on Opus
    db.prepare(
      "INSERT INTO sessions (id, project_id, started_at, primary_model, category, total_cost_usd, total_input_tokens, total_output_tokens, message_count) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)"
    ).run("s1", "2026-03-16T10:00:00Z", "claude-opus-4-6", "exploration", 0.10, 1000, 500, 1);

    const recs = generateRecommendations(db, "all");
    // Savings too small, should not recommend
    const explorationRec = recs.find(r => r.what.includes("exploration"));
    expect(explorationRec).toBeFalsy();
  });

  it("sorts recommendations by potential savings descending", () => {
    seedProject();
    // Big exploration session
    db.prepare(
      "INSERT INTO sessions (id, project_id, started_at, primary_model, category, total_cost_usd, total_input_tokens, total_output_tokens, message_count) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)"
    ).run("s1", "2026-03-16T10:00:00Z", "claude-opus-4-6", "exploration", 50.00, 500000, 200000, 20);

    // Smaller devops session
    db.prepare(
      "INSERT INTO sessions (id, project_id, started_at, primary_model, category, total_cost_usd, total_input_tokens, total_output_tokens, message_count) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)"
    ).run("s2", "2026-03-16T11:00:00Z", "claude-opus-4-6", "devops", 5.00, 50000, 20000, 5);

    const recs = generateRecommendations(db, "all");
    if (recs.length >= 2) {
      expect(recs[0].potential_savings).toBeGreaterThanOrEqual(recs[1].potential_savings);
    }
  });

  it("returns no recommendation for Sonnet exploration (already optimal)", () => {
    seedProject();
    db.prepare(
      "INSERT INTO sessions (id, project_id, started_at, primary_model, category, total_cost_usd, total_input_tokens, total_output_tokens, message_count) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)"
    ).run("s1", "2026-03-16T10:00:00Z", "claude-sonnet-4-5-20250514", "exploration", 3.00, 100000, 50000, 10);

    const recs = generateRecommendations(db, "all");
    const explorationRec = recs.find(r => r.what.includes("exploration"));
    expect(explorationRec).toBeFalsy();
  });
});
