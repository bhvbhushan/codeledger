import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync, mkdirSync, copyFileSync, rmSync, writeFileSync } from "fs";
import { resolve } from "path";
import { createConnection } from "../../src/db/connection.js";
import { runMigrations } from "../../src/db/migrate.js";
import { seedPricing } from "../../src/db/pricing.js";
import { scanForNewSessions } from "../../src/sync/scanner.js";

const TEST_DB = "/tmp/codeledger-scanner-test.db";
const TEST_CLAUDE_DIR = "/tmp/codeledger-test-claude";
const FIXTURES = resolve(import.meta.dirname, "../fixtures");
let db: any;

beforeEach(() => {
  db = createConnection(TEST_DB);
  runMigrations(db);
  seedPricing(db);

  // Create fake ~/.claude/projects/ structure
  mkdirSync(`${TEST_CLAUDE_DIR}/projects/-tmp-myproject`, { recursive: true });
  copyFileSync(
    `${FIXTURES}/simple-session.jsonl`,
    `${TEST_CLAUDE_DIR}/projects/-tmp-myproject/test-session-001.jsonl`
  );
});

afterEach(() => {
  db.close();
  for (const ext of ["", "-wal", "-shm"]) {
    if (existsSync(TEST_DB + ext)) unlinkSync(TEST_DB + ext);
  }
  rmSync(TEST_CLAUDE_DIR, { recursive: true, force: true });
});

describe("scanner", () => {
  it("discovers and parses new session files", async () => {
    const result = await scanForNewSessions(db, TEST_CLAUDE_DIR);
    expect(result.newFiles).toBe(1);
    expect(result.errors).toBe(0);

    const sessions = db.prepare("SELECT COUNT(*) as c FROM sessions").get() as any;
    expect(sessions.c).toBe(1);
  });

  it("skips already-synced files", async () => {
    await scanForNewSessions(db, TEST_CLAUDE_DIR);
    const result2 = await scanForNewSessions(db, TEST_CLAUDE_DIR);
    expect(result2.newFiles).toBe(0);
  });
});

describe("scanner — subagent scanning", () => {
  it("discovers and parses agent JSONL in subagents/ directories", async () => {
    // Create a subagents directory with agent JSONL
    mkdirSync(
      `${TEST_CLAUDE_DIR}/projects/-tmp-myproject/test-session-001/subagents`,
      { recursive: true }
    );
    copyFileSync(
      `${FIXTURES}/agent-session.jsonl`,
      `${TEST_CLAUDE_DIR}/projects/-tmp-myproject/test-session-001/subagents/agent-scan001.jsonl`
    );
    writeFileSync(
      `${TEST_CLAUDE_DIR}/projects/-tmp-myproject/test-session-001/subagents/agent-scan001.meta.json`,
      JSON.stringify({ agentType: "general-purpose" })
    );

    const result = await scanForNewSessions(db, TEST_CLAUDE_DIR);
    // 1 session JSONL + 1 agent JSONL
    expect(result.newFiles).toBeGreaterThanOrEqual(1);

    // Check that agent was written
    const agents = db
      .prepare("SELECT COUNT(*) as c FROM agents")
      .get() as any;
    expect(agents.c).toBe(1);
  });

  it("skips already-synced agent files", async () => {
    mkdirSync(
      `${TEST_CLAUDE_DIR}/projects/-tmp-myproject/test-session-001/subagents`,
      { recursive: true }
    );
    copyFileSync(
      `${FIXTURES}/agent-session.jsonl`,
      `${TEST_CLAUDE_DIR}/projects/-tmp-myproject/test-session-001/subagents/agent-skip001.jsonl`
    );
    writeFileSync(
      `${TEST_CLAUDE_DIR}/projects/-tmp-myproject/test-session-001/subagents/agent-skip001.meta.json`,
      JSON.stringify({ agentType: "general-purpose" })
    );

    await scanForNewSessions(db, TEST_CLAUDE_DIR);
    const result2 = await scanForNewSessions(db, TEST_CLAUDE_DIR);

    // Agent files should not be re-parsed
    const agents = db
      .prepare("SELECT COUNT(*) as c FROM agents")
      .get() as any;
    expect(agents.c).toBe(1); // Still just 1
  });

  it("handles subagents directory that does not exist", async () => {
    // No subagents/ dir — should still scan session JSONL normally
    const result = await scanForNewSessions(db, TEST_CLAUDE_DIR);
    expect(result.newFiles).toBe(1); // Just the session JSONL
    expect(result.errors).toBe(0);
  });
});
