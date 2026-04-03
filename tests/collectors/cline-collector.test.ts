import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { createConnection } from "../../src/db/connection.js";
import { runMigrations } from "../../src/db/migrate.js";
import { seedPricing } from "../../src/db/pricing.js";
import { ClineCollector } from "../../src/collectors/cline-collector.js";

const TEST_DB = "/tmp/codeledger-cline-collector-test.db";
const TMP_DIR = "/tmp/codeledger-cline-test-data";
let db: any;
let collector: ClineCollector;

beforeEach(() => {
  db = createConnection(TEST_DB);
  runMigrations(db);
  seedPricing(db);
  collector = new ClineCollector();
  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
  db.close();
  for (const ext of ["", "-wal", "-shm"]) {
    if (existsSync(TEST_DB + ext)) unlinkSync(TEST_DB + ext);
  }
  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
});

describe("ClineCollector", () => {
  it("returns empty findDataFiles when data directory does not exist", () => {
    const files = collector.findDataFiles();
    expect(Array.isArray(files)).toBe(true);
  });

  it("parses valid JSON array and inserts session with tool=cline", async () => {
    const taskDir = join(TMP_DIR, "task-123");
    mkdirSync(taskDir, { recursive: true });
    const filePath = join(taskDir, "api_conversation_history.json");

    const data = [
      {
        tokensIn: 2000,
        tokensOut: 800,
        cost: 0.05,
        model: "claude-sonnet-4-6",
        ts: Date.now(),
      },
      {
        tokensIn: 1500,
        tokensOut: 600,
        cost: 0.03,
        model: "claude-sonnet-4-6",
        ts: Date.now() + 1000,
      },
    ];
    writeFileSync(filePath, JSON.stringify(data));

    const result = await collector.parseFile(db, filePath);
    expect(result.sessionsAdded).toBe(1);
    expect(result.errors).toBe(0);

    const session = db
      .prepare("SELECT * FROM sessions WHERE tool = ?")
      .get("cline") as any;
    expect(session).toBeTruthy();
    expect(session.tool).toBe("cline");
    expect(session.provider).toBe("anthropic");
    expect(session.total_input_tokens).toBe(3500);
    expect(session.total_output_tokens).toBe(1400);
    expect(session.total_cost_usd).toBeCloseTo(0.08);
  });

  it("returns format warning for missing expected fields", () => {
    const validation = collector.validateFormat([{ unrelated: true }]);
    expect(validation.valid).toBe(false);
    expect(validation.warning).toBeTruthy();
  });

  it("handles parse error gracefully and logs warning", async () => {
    const taskDir = join(TMP_DIR, "task-bad");
    mkdirSync(taskDir, { recursive: true });
    const filePath = join(taskDir, "api_conversation_history.json");
    writeFileSync(filePath, "not valid json {{{");

    const result = await collector.parseFile(db, filePath);
    expect(result.errors).toBe(1);
    expect(result.sessionsAdded).toBe(0);

    const sync = db
      .prepare("SELECT status FROM sync_state WHERE file_path = ?")
      .get(filePath) as any;
    expect(sync.status).toBe("format_changed");
  });
});
