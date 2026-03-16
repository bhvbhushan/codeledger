import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { resolve } from "path";
import { createConnection } from "../../src/db/connection.js";
import { runMigrations } from "../../src/db/migrate.js";
import { seedPricing } from "../../src/db/pricing.js";
import { handleSessionEnd } from "../../src/hooks/on-session-end.js";

const TEST_DB = "/tmp/codeledger-hook-test.db";
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

describe("on-session-end hook", () => {
  it("parses session from hook payload and writes to DB", async () => {
    const payload = {
      session_id: "hook-test-session",
      transcript_path: `${FIXTURES}/simple-session.jsonl`,
      cwd: "/Users/test/myproject",
      permission_mode: "default",
      hook_event_name: "SessionEnd",
      reason: "exit",
    };

    await handleSessionEnd(payload, TEST_DB);

    // Verify session was written (open a fresh connection to read)
    const readDb = createConnection(TEST_DB);
    const session = readDb.prepare("SELECT * FROM sessions LIMIT 1").get() as any;
    expect(session).toBeTruthy();
    expect(session.end_reason).toBe("exit");
    expect(session.total_cost_usd).toBeGreaterThan(0);
    readDb.close();
  });
});
