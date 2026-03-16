import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { createConnection } from "../../src/db/connection.js";
import { runMigrations } from "../../src/db/migrate.js";
import { seedPricing } from "../../src/db/pricing.js";
import { querySkillUsage } from "../../src/tools/skill-usage.js";

const TEST_DB = "/tmp/codeledger-skill-usage-test.db";
let db: any;

beforeEach(() => {
  db = createConnection(TEST_DB);
  runMigrations(db);
  seedPricing(db);

  const today = new Date().toISOString().split("T")[0];

  // Seed project + session
  db.prepare(
    "INSERT INTO projects (path, display_name, cwd, first_seen, last_active) VALUES (?, ?, ?, ?, ?)"
  ).run("-tmp-proj1", "proj1", "/tmp/proj1", today, today);
  db.prepare(
    "INSERT INTO sessions (id, project_id, started_at, ended_at, primary_model, total_cost_usd, message_count) VALUES (?, 1, ?, ?, ?, ?, ?)"
  ).run("sess-1", today + "T10:00:00Z", today + "T10:30:00Z", "claude-sonnet-4-5-20250514", 5.50, 10);

  // Seed skill invocations
  db.prepare(
    "INSERT INTO skills (session_id, skill_name, invoked_at, is_estimated) VALUES (?, ?, ?, TRUE)"
  ).run("sess-1", "superpowers:brainstorming", today + "T10:05:00Z");
  db.prepare(
    "INSERT INTO skills (session_id, skill_name, invoked_at, is_estimated) VALUES (?, ?, ?, TRUE)"
  ).run("sess-1", "superpowers:code-review", today + "T10:15:00Z");
  db.prepare(
    "INSERT INTO skills (session_id, skill_name, invoked_at, is_estimated) VALUES (?, ?, ?, TRUE)"
  ).run("sess-1", "superpowers:brainstorming", today + "T10:25:00Z");

  // Seed token_usage rows (for estimation)
  // After brainstorming #1 (10:05 - 10:15): 2 messages
  db.prepare(
    "INSERT INTO token_usage (session_id, message_id, model, input_tokens, output_tokens, cost_usd, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run("sess-1", "msg-a", "claude-sonnet-4-5-20250514", 500, 200, 0.05, today + "T10:06:00Z");
  db.prepare(
    "INSERT INTO token_usage (session_id, message_id, model, input_tokens, output_tokens, cost_usd, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run("sess-1", "msg-b", "claude-sonnet-4-5-20250514", 600, 300, 0.08, today + "T10:10:00Z");

  // After code-review (10:15 - 10:25): 1 message
  db.prepare(
    "INSERT INTO token_usage (session_id, message_id, model, input_tokens, output_tokens, cost_usd, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run("sess-1", "msg-c", "claude-sonnet-4-5-20250514", 800, 400, 0.12, today + "T10:20:00Z");

  // After brainstorming #2 (10:25 - session end 10:30): 1 message
  db.prepare(
    "INSERT INTO token_usage (session_id, message_id, model, input_tokens, output_tokens, cost_usd, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run("sess-1", "msg-d", "claude-sonnet-4-5-20250514", 300, 100, 0.03, today + "T10:27:00Z");
});

afterEach(() => {
  db.close();
  for (const ext of ["", "-wal", "-shm"]) {
    if (existsSync(TEST_DB + ext)) unlinkSync(TEST_DB + ext);
  }
});

describe("skill_usage tool", () => {
  it("returns aggregated skill usage data", () => {
    const result = querySkillUsage(db, "today");
    expect(result.length).toBeGreaterThanOrEqual(2); // brainstorming + code-review
  });

  it("groups by skill_name and sums invocations", () => {
    const result = querySkillUsage(db, "today");
    const brainstorming = result.find((s: any) => s.skill_name === "superpowers:brainstorming");
    expect(brainstorming).toBeTruthy();
    expect(brainstorming!.invocation_count).toBe(2);
  });

  it("estimates tokens between skill invocations", () => {
    const result = querySkillUsage(db, "today");
    const brainstorming = result.find((s: any) => s.skill_name === "superpowers:brainstorming");
    const codeReview = result.find((s: any) => s.skill_name === "superpowers:code-review");

    // brainstorming: window 1 (msg-a + msg-b) + window 2 (msg-d)
    expect(brainstorming!.est_input_tokens).toBe(500 + 600 + 300); // 1400
    expect(brainstorming!.est_output_tokens).toBe(200 + 300 + 100); // 600

    // code-review: window (msg-c)
    expect(codeReview!.est_input_tokens).toBe(800);
    expect(codeReview!.est_output_tokens).toBe(400);
  });

  it("estimates cost between skill invocations", () => {
    const result = querySkillUsage(db, "today");
    const brainstorming = result.find((s: any) => s.skill_name === "superpowers:brainstorming");
    const codeReview = result.find((s: any) => s.skill_name === "superpowers:code-review");

    expect(brainstorming!.est_cost_usd).toBeCloseTo(0.05 + 0.08 + 0.03); // 0.16
    expect(codeReview!.est_cost_usd).toBeCloseTo(0.12);
  });

  it("marks all values as estimated", () => {
    const result = querySkillUsage(db, "today");
    expect(result.every((s: any) => s.is_estimated === true)).toBe(true);
  });

  it("filters by project name", () => {
    const today = new Date().toISOString().split("T")[0];
    db.prepare(
      "INSERT INTO projects (path, display_name, cwd, first_seen, last_active) VALUES (?, ?, ?, ?, ?)"
    ).run("-tmp-proj2", "proj2", "/tmp/proj2", today, today);
    db.prepare(
      "INSERT INTO sessions (id, project_id, started_at, ended_at, primary_model, total_cost_usd, message_count) VALUES (?, 2, ?, ?, ?, ?, ?)"
    ).run("sess-2", today + "T11:00:00Z", today + "T11:30:00Z", "claude-sonnet-4-5-20250514", 2.00, 5);
    db.prepare(
      "INSERT INTO skills (session_id, skill_name, invoked_at, is_estimated) VALUES (?, ?, ?, TRUE)"
    ).run("sess-2", "superpowers:debugging", today + "T11:05:00Z");

    const result = querySkillUsage(db, "today", "proj1");
    expect(result.every((s: any) => s.skill_name !== "superpowers:debugging")).toBe(true);
  });

  it("returns empty array when no skills exist", () => {
    db.prepare("DELETE FROM skills").run();
    const result = querySkillUsage(db, "today");
    expect(result).toHaveLength(0);
  });

  it("sorts by estimated cost descending", () => {
    const result = querySkillUsage(db, "today");
    if (result.length >= 2) {
      expect(result[0].est_cost_usd).toBeGreaterThanOrEqual(result[1].est_cost_usd);
    }
  });
});
