import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync, mkdirSync, copyFileSync, rmSync } from "fs";
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
