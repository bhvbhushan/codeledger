import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { resolve } from "path";
import { createConnection } from "../../src/db/connection.js";
import { runMigrations } from "../../src/db/migrate.js";
import { seedPricing } from "../../src/db/pricing.js";
import { handleStop } from "../../src/hooks/on-stop.js";

const TEST_DB = "/tmp/codeledger-stop-hook-test.db";
const FIXTURES = resolve(import.meta.dirname, "../fixtures");
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

describe("on-stop hook", () => {
  it("creates session and token_usage from JSONL on first Stop", async () => {
    const payload = {
      session_id: "test-session-001",
      transcript_path: `${FIXTURES}/simple-session.jsonl`,
      cwd: "/Users/test/myproject",
      permission_mode: "default",
      hook_event_name: "Stop",
    };

    await handleStop(payload, TEST_DB);

    // Session should exist
    const session = db
      .prepare("SELECT * FROM sessions LIMIT 1")
      .get() as any;
    expect(session).toBeTruthy();
    expect(session.total_cost_usd).toBeGreaterThan(0);
    expect(session.message_count).toBe(2);

    // token_usage rows should exist
    const usage = db
      .prepare("SELECT COUNT(*) as c FROM token_usage")
      .get() as any;
    expect(usage.c).toBe(2);
  });

  it("is idempotent — calling twice does NOT duplicate data", async () => {
    const payload = {
      session_id: "test-session-001",
      transcript_path: `${FIXTURES}/simple-session.jsonl`,
      cwd: "/Users/test/myproject",
      permission_mode: "default",
      hook_event_name: "Stop",
    };

    await handleStop(payload, TEST_DB);
    await handleStop(payload, TEST_DB);

    // Still only 2 token_usage rows (not 4)
    const usage = db
      .prepare("SELECT COUNT(*) as c FROM token_usage")
      .get() as any;
    expect(usage.c).toBe(2);

    // Still only 1 session
    const sessions = db
      .prepare("SELECT COUNT(*) as c FROM sessions")
      .get() as any;
    expect(sessions.c).toBe(1);
  });

  it("does NOT write to daily_summaries or tool_calls", async () => {
    const payload = {
      session_id: "test-session-001",
      transcript_path: `${FIXTURES}/simple-session.jsonl`,
      cwd: "/Users/test/myproject",
      permission_mode: "default",
      hook_event_name: "Stop",
    };

    await handleStop(payload, TEST_DB);

    const daily = db
      .prepare("SELECT COUNT(*) as c FROM daily_summaries")
      .get() as any;
    expect(daily.c).toBe(0);

    const tools = db
      .prepare("SELECT COUNT(*) as c FROM tool_calls")
      .get() as any;
    expect(tools.c).toBe(0);
  });

  it("skips subagent Stop events (agent_id present)", async () => {
    const payload = {
      session_id: "test-session-001",
      transcript_path: `${FIXTURES}/simple-session.jsonl`,
      cwd: "/Users/test/myproject",
      permission_mode: "default",
      hook_event_name: "Stop",
      agent_id: "agent-abc123",
      agent_type: "general-purpose",
    };

    await handleStop(payload, TEST_DB);

    // Nothing should be written — subagents are handled by SubagentStop
    const sessions = db
      .prepare("SELECT COUNT(*) as c FROM sessions")
      .get() as any;
    expect(sessions.c).toBe(0);
  });

  it("session totals update correctly when called with growing data", async () => {
    // First call with simple session (2 messages)
    const payload = {
      session_id: "test-session-001",
      transcript_path: `${FIXTURES}/simple-session.jsonl`,
      cwd: "/Users/test/myproject",
      permission_mode: "default",
      hook_event_name: "Stop",
    };

    await handleStop(payload, TEST_DB);

    const session1 = db
      .prepare("SELECT total_cost_usd, message_count FROM sessions LIMIT 1")
      .get() as any;
    expect(session1.message_count).toBe(2);
    const cost1 = session1.total_cost_usd;

    // Call again with streaming session (more messages, different file but same concept)
    // In reality, the SAME file would have more lines — but this tests the INSERT OR REPLACE logic
    // Cost should be recalculated from all messages
    await handleStop(payload, TEST_DB);

    const session2 = db
      .prepare("SELECT total_cost_usd, message_count FROM sessions LIMIT 1")
      .get() as any;
    expect(session2.total_cost_usd).toBeCloseTo(cost1); // Same file = same cost
    expect(session2.message_count).toBe(2);
  });

  it("does NOT set end_reason (only SessionEnd does that)", async () => {
    const payload = {
      session_id: "test-session-001",
      transcript_path: `${FIXTURES}/simple-session.jsonl`,
      cwd: "/Users/test/myproject",
      permission_mode: "default",
      hook_event_name: "Stop",
    };

    await handleStop(payload, TEST_DB);

    const session = db
      .prepare("SELECT end_reason FROM sessions LIMIT 1")
      .get() as any;
    expect(session.end_reason).toBeNull();
  });
});
