import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { resolve } from "path";
import { createConnection } from "../../src/db/connection.js";
import { runMigrations } from "../../src/db/migrate.js";
import { seedPricing } from "../../src/db/pricing.js";
import { handleSubagentStop } from "../../src/hooks/on-subagent-stop.js";

const TEST_DB = "/tmp/codeledger-subagent-hook-test.db";
const FIXTURES = resolve(import.meta.dirname, "../fixtures");
let db: any;

beforeEach(() => {
  db = createConnection(TEST_DB);
  runMigrations(db);
  seedPricing(db);

  // Create parent session (FK requirement)
  db.prepare(
    "INSERT INTO projects (path, display_name, cwd, first_seen, last_active) VALUES (?, ?, ?, ?, ?)"
  ).run("-tmp-myproject", "myproject", "/Users/test/myproject", "2026-03-16", "2026-03-16");
  db.prepare(
    "INSERT INTO sessions (id, project_id, started_at, message_count) VALUES (?, 1, ?, 0)"
  ).run("parent-session-001", "2026-03-16T10:00:00.000Z");
});

afterEach(() => {
  db.close();
  for (const ext of ["", "-wal", "-shm"]) {
    if (existsSync(TEST_DB + ext)) unlinkSync(TEST_DB + ext);
  }
});

describe("on-subagent-stop hook", () => {
  it("parses agent JSONL and writes to agents table", async () => {
    const payload = {
      session_id: "parent-session-001",
      agent_id: "agent-abc123",
      agent_type: "general-purpose",
      agent_transcript_path: `${FIXTURES}/agent-session.jsonl`,
      last_assistant_message: "Done.",
      stop_hook_active: true,
      transcript_path: "/Users/test/.claude/projects/-tmp-myproject/parent-session-001.jsonl",
      cwd: "/Users/test/myproject",
      permission_mode: "default",
      hook_event_name: "SubagentStop",
    };

    await handleSubagentStop(payload, TEST_DB);

    const readDb = createConnection(TEST_DB);
    const agent = readDb
      .prepare("SELECT * FROM agents WHERE id = ? AND session_id = ?")
      .get("agent-abc123", "parent-session-001") as any;

    expect(agent).toBeTruthy();
    expect(agent.agent_type).toBe("general-purpose");
    expect(agent.total_input_tokens).toBe(1100);
    expect(agent.total_output_tokens).toBe(300);
    expect(agent.total_cost_usd).toBeGreaterThan(0);
    expect(agent.message_count).toBe(2);
    readDb.close();
  });

  it("reads agent_type from meta.json when agent_type not in payload", async () => {
    // Create a temp agent JSONL with companion meta.json
    const { mkdirSync, writeFileSync, copyFileSync, rmSync } = await import("fs");
    const tmpDir = "/tmp/codeledger-subagent-test";
    mkdirSync(tmpDir, { recursive: true });
    copyFileSync(
      `${FIXTURES}/agent-session.jsonl`,
      `${tmpDir}/agent-meta-test.jsonl`
    );
    writeFileSync(
      `${tmpDir}/agent-meta-test.meta.json`,
      JSON.stringify({ agentType: "code-reviewer" })
    );

    const payload = {
      session_id: "parent-session-001",
      agent_id: "agent-meta-test",
      agent_type: undefined as any,
      agent_transcript_path: `${tmpDir}/agent-meta-test.jsonl`,
      cwd: "/Users/test/myproject",
      permission_mode: "default",
      hook_event_name: "SubagentStop",
    };

    await handleSubagentStop(payload, TEST_DB);

    const readDb = createConnection(TEST_DB);
    const agent = readDb
      .prepare("SELECT * FROM agents WHERE id = ?")
      .get("agent-meta-test") as any;

    expect(agent).toBeTruthy();
    expect(agent.agent_type).toBe("code-reviewer");
    readDb.close();

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("handles missing parent session gracefully (no throw)", async () => {
    // Delete the parent session
    db.prepare("DELETE FROM sessions").run();

    const payload = {
      session_id: "nonexistent-session",
      agent_id: "agent-orphan",
      agent_type: "general-purpose",
      agent_transcript_path: `${FIXTURES}/agent-session.jsonl`,
      cwd: "/Users/test/myproject",
      permission_mode: "default",
      hook_event_name: "SubagentStop",
    };

    // Should NOT throw — hooks must always exit 0
    await expect(
      handleSubagentStop(payload, TEST_DB)
    ).resolves.not.toThrow();
  });

  it("handles missing agent JSONL file gracefully", async () => {
    const payload = {
      session_id: "parent-session-001",
      agent_id: "agent-missing",
      agent_type: "general-purpose",
      agent_transcript_path: "/nonexistent/path/agent-missing.jsonl",
      cwd: "/Users/test/myproject",
      permission_mode: "default",
      hook_event_name: "SubagentStop",
    };

    // Should NOT throw
    await expect(
      handleSubagentStop(payload, TEST_DB)
    ).resolves.not.toThrow();
  });
});
