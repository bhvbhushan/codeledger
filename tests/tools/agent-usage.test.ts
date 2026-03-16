import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { createConnection } from "../../src/db/connection.js";
import { runMigrations } from "../../src/db/migrate.js";
import { seedPricing } from "../../src/db/pricing.js";
import { queryAgentUsage } from "../../src/tools/agent-usage.js";

const TEST_DB = "/tmp/codeledger-agent-usage-test.db";
let db: any;

beforeEach(() => {
  db = createConnection(TEST_DB);
  runMigrations(db);
  seedPricing(db);

  const today = new Date().toISOString().split("T")[0];

  // Seed test data
  db.prepare(
    "INSERT INTO projects (path, display_name, cwd, first_seen, last_active) VALUES (?, ?, ?, ?, ?)"
  ).run("-tmp-proj1", "proj1", "/tmp/proj1", today, today);

  db.prepare(
    "INSERT INTO sessions (id, project_id, started_at, primary_model, total_cost_usd, message_count) VALUES (?, 1, ?, ?, ?, ?)"
  ).run("sess-1", today + "T10:00:00Z", "claude-sonnet-4-5-20250514", 5.50, 10);

  db.prepare(
    "INSERT INTO agents (id, session_id, agent_type, model, total_input_tokens, total_output_tokens, total_cache_create_tokens, total_cache_read_tokens, total_cost_usd, started_at, ended_at, message_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run("agent-001", "sess-1", "general-purpose", "claude-sonnet-4-5-20250514", 1100, 300, 100, 50, 0.15, today + "T10:01:00Z", today + "T10:05:00Z", 5);

  db.prepare(
    "INSERT INTO agents (id, session_id, agent_type, model, total_input_tokens, total_output_tokens, total_cache_create_tokens, total_cache_read_tokens, total_cost_usd, started_at, ended_at, message_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run("agent-002", "sess-1", "code-reviewer", "claude-opus-4-6-20250514", 2000, 500, 200, 100, 0.85, today + "T10:02:00Z", today + "T10:06:00Z", 3);
});

afterEach(() => {
  db.close();
  for (const ext of ["", "-wal", "-shm"]) {
    if (existsSync(TEST_DB + ext)) unlinkSync(TEST_DB + ext);
  }
});

describe("agent_usage tool", () => {
  it("returns all agents for the period", () => {
    const result = queryAgentUsage(db, "today");
    expect(result).toHaveLength(2);
  });

  it("returns agent data with correct fields", () => {
    const result = queryAgentUsage(db, "today");
    const agent = result.find((a: any) => a.agent_id === "agent-001");
    expect(agent).toBeTruthy();
    expect(agent.agent_type).toBe("general-purpose");
    expect(agent.model).toBe("claude-sonnet-4-5-20250514");
    expect(agent.total_input_tokens).toBe(1100);
    expect(agent.total_output_tokens).toBe(300);
    expect(agent.total_cost_usd).toBeCloseTo(0.15);
    expect(agent.message_count).toBe(5);
    expect(agent.session_id).toBe("sess-1");
    expect(agent.project).toBe("proj1");
  });

  it("filters by session_id", () => {
    const today = new Date().toISOString().split("T")[0];
    db.prepare(
      "INSERT INTO sessions (id, project_id, started_at, primary_model, total_cost_usd, message_count) VALUES (?, 1, ?, ?, ?, ?)"
    ).run("sess-2", today + "T11:00:00Z", "claude-sonnet-4-5-20250514", 2.00, 5);

    db.prepare(
      "INSERT INTO agents (id, session_id, agent_type, model, total_input_tokens, total_output_tokens, total_cost_usd, started_at, ended_at, message_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("agent-003", "sess-2", "general-purpose", "claude-sonnet-4-5-20250514", 500, 100, 0.05, today + "T11:01:00Z", today + "T11:02:00Z", 2);

    const result = queryAgentUsage(db, "today", { sessionId: "sess-1" });
    expect(result).toHaveLength(2); // Only agents from sess-1
    expect(result.every((a: any) => a.session_id === "sess-1")).toBe(true);
  });

  it("filters by project name", () => {
    const today = new Date().toISOString().split("T")[0];
    db.prepare(
      "INSERT INTO projects (path, display_name, cwd, first_seen, last_active) VALUES (?, ?, ?, ?, ?)"
    ).run("-tmp-proj2", "proj2", "/tmp/proj2", today, today);
    db.prepare(
      "INSERT INTO sessions (id, project_id, started_at, primary_model, total_cost_usd, message_count) VALUES (?, 2, ?, ?, ?, ?)"
    ).run("sess-other", today + "T12:00:00Z", "claude-sonnet-4-5-20250514", 1.00, 3);
    db.prepare(
      "INSERT INTO agents (id, session_id, agent_type, model, total_input_tokens, total_output_tokens, total_cost_usd, started_at, ended_at, message_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("agent-other", "sess-other", "general-purpose", "claude-sonnet-4-5-20250514", 200, 50, 0.02, today + "T12:01:00Z", today + "T12:02:00Z", 1);

    const result = queryAgentUsage(db, "today", { project: "proj1" });
    expect(result).toHaveLength(2); // Only proj1 agents
  });

  it("returns empty array when no agents exist", () => {
    db.prepare("DELETE FROM agents").run();
    const result = queryAgentUsage(db, "today");
    expect(result).toHaveLength(0);
  });

  it("sorts by cost descending", () => {
    const result = queryAgentUsage(db, "today");
    expect(result[0].agent_id).toBe("agent-002"); // Higher cost
    expect(result[1].agent_id).toBe("agent-001"); // Lower cost
  });

  it("returns all-time data", () => {
    const result = queryAgentUsage(db, "all");
    expect(result).toHaveLength(2);
  });
});
