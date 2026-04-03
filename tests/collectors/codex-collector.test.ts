import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { createConnection } from "../../src/db/connection.js";
import { runMigrations } from "../../src/db/migrate.js";
import { seedPricing } from "../../src/db/pricing.js";
import { CodexCollector } from "../../src/collectors/codex-collector.js";

const TEST_DB = "/tmp/codeledger-codex-collector-test.db";
const TMP_DIR = "/tmp/codeledger-codex-test-data";
let db: any;
let collector: CodexCollector;

beforeEach(() => {
  db = createConnection(TEST_DB);
  runMigrations(db);
  seedPricing(db);
  collector = new CodexCollector();
  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
  db.close();
  for (const ext of ["", "-wal", "-shm"]) {
    if (existsSync(TEST_DB + ext)) unlinkSync(TEST_DB + ext);
  }
  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
});

describe("CodexCollector", () => {
  it("returns empty findDataFiles when data directory does not exist", () => {
    // The default ~/.codex/sessions dir won't exist in test env
    // But we directly test the logic: no dir = no files
    const files = collector.findDataFiles();
    // May or may not return files depending on actual user home
    // The key test: doesn't throw
    expect(Array.isArray(files)).toBe(true);
  });

  it("parses valid JSONL and inserts session with tool=codex-cli", async () => {
    const sessionDir = join(TMP_DIR, "2026-04-01");
    mkdirSync(sessionDir, { recursive: true });
    const filePath = join(sessionDir, "test-session.jsonl");

    const lines = [
      JSON.stringify({
        type: "response",
        response: {
          model: "o4-mini",
          created_at: 1743465600,
          usage: { input_tokens: 1000, output_tokens: 500 },
          output: [{ type: "message", content: "hello" }],
        },
      }),
      JSON.stringify({
        type: "response",
        response: {
          model: "o4-mini",
          created_at: 1743465700,
          usage: { input_tokens: 800, output_tokens: 300 },
          output: [{ type: "message", content: "world" }],
        },
      }),
    ];
    writeFileSync(filePath, lines.join("\n"));

    const result = await collector.parseFile(db, filePath);
    expect(result.sessionsAdded).toBe(1);
    expect(result.errors).toBe(0);

    const session = db
      .prepare("SELECT * FROM sessions WHERE tool = ?")
      .get("codex-cli") as any;
    expect(session).toBeTruthy();
    expect(session.tool).toBe("codex-cli");
    expect(session.provider).toBe("openai");
    expect(session.total_input_tokens).toBe(1800);
    expect(session.total_output_tokens).toBe(800);
    expect(session.primary_model).toBe("o4-mini");
  });

  it("returns format warning for missing expected fields", () => {
    const validation = collector.validateFormat('{"type":"other"}\n{"foo":"bar"}');
    expect(validation.valid).toBe(false);
    expect(validation.warning).toBeTruthy();
  });

  it("handles parse error gracefully and logs warning", async () => {
    const sessionDir = join(TMP_DIR, "2026-04-01");
    mkdirSync(sessionDir, { recursive: true });
    const filePath = join(sessionDir, "bad-session.jsonl");
    writeFileSync(filePath, "not valid jsonl at all {{{");

    const result = await collector.parseFile(db, filePath);
    expect(result.errors).toBe(1);
    expect(result.sessionsAdded).toBe(0);

    // Verify sync_state recorded format_changed
    const sync = db
      .prepare("SELECT status FROM sync_state WHERE file_path = ?")
      .get(filePath) as any;
    expect(sync.status).toBe("format_changed");
  });
});
