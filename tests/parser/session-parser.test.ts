import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { resolve } from "path";
import { createConnection } from "../../src/db/connection.js";
import { runMigrations } from "../../src/db/migrate.js";
import { seedPricing } from "../../src/db/pricing.js";
import { parseSessionFile } from "../../src/parser/session-parser.js";

const TEST_DB = "/tmp/codeledger-session-test.db";
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

describe("session-parser", () => {
  it("parses a simple session into DB records", async () => {
    const result = await parseSessionFile(
      db,
      `${FIXTURES}/simple-session.jsonl`,
      "-Users-test-myproject",
      "/Users/test/myproject"
    );

    expect(result.sessionId).toBeTruthy();
    expect(result.messageCount).toBe(2); // 2 assistant messages

    // Check project was created
    const project = db
      .prepare("SELECT * FROM projects WHERE path = ?")
      .get("-Users-test-myproject");
    expect(project).toBeTruthy();
    expect(project.display_name).toBe("myproject");

    // Check session was created
    const session = db
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get(result.sessionId);
    expect(session).toBeTruthy();
    expect(session.total_cost_usd).toBeGreaterThan(0);

    // Check token_usage rows
    const usageRows = db
      .prepare("SELECT COUNT(*) as c FROM token_usage WHERE session_id = ?")
      .get(result.sessionId) as any;
    expect(usageRows.c).toBe(2);
  });

  it("handles streaming dedup correctly", async () => {
    const result = await parseSessionFile(
      db,
      `${FIXTURES}/streaming-session.jsonl`,
      "-Users-test-myproject",
      "/Users/test/myproject"
    );

    // streaming-session has 3 lines for msg_stream_001 + 1 for msg_stream_002 = 2 unique messages
    expect(result.messageCount).toBe(2);
  });

  it("skips synthetic error messages", async () => {
    const result = await parseSessionFile(
      db,
      `${FIXTURES}/error-session.jsonl`,
      "-Users-test-myproject",
      "/Users/test/myproject"
    );

    // error-session has 1 real assistant + 1 synthetic = 1 counted
    expect(result.messageCount).toBe(1);
  });
});
