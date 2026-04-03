import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { createConnection } from "../../src/db/connection.js";
import { runMigrations } from "../../src/db/migrate.js";
import { seedPricing } from "../../src/db/pricing.js";
import { GeminiCollector } from "../../src/collectors/gemini-collector.js";

const TEST_DB = "/tmp/codeledger-gemini-collector-test.db";
const TMP_DIR = "/tmp/codeledger-gemini-test-data";
let db: any;
let collector: GeminiCollector;

beforeEach(() => {
  db = createConnection(TEST_DB);
  runMigrations(db);
  seedPricing(db);
  collector = new GeminiCollector();
  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
  db.close();
  for (const ext of ["", "-wal", "-shm"]) {
    if (existsSync(TEST_DB + ext)) unlinkSync(TEST_DB + ext);
  }
  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
});

describe("GeminiCollector", () => {
  it("returns empty findDataFiles when data directory does not exist", () => {
    const files = collector.findDataFiles();
    expect(Array.isArray(files)).toBe(true);
  });

  it("parses valid state.json and inserts session with tool=gemini-cli", async () => {
    const sessionDir = join(TMP_DIR, "session-abc");
    mkdirSync(sessionDir, { recursive: true });
    const filePath = join(sessionDir, "state.json");

    const data = {
      messages: [
        {
          model: "gemini-2.5-pro",
          created_at: "2026-04-01T10:00:00Z",
          usage_metadata: {
            prompt_token_count: 3000,
            candidates_token_count: 1200,
            cached_content_token_count: 500,
          },
        },
        {
          model: "gemini-2.5-pro",
          created_at: "2026-04-01T10:05:00Z",
          usage_metadata: {
            prompt_token_count: 2000,
            candidates_token_count: 800,
            cached_content_token_count: 200,
          },
        },
      ],
    };
    writeFileSync(filePath, JSON.stringify(data));

    const result = await collector.parseFile(db, filePath);
    expect(result.sessionsAdded).toBe(1);
    expect(result.errors).toBe(0);

    const session = db
      .prepare("SELECT * FROM sessions WHERE tool = ?")
      .get("gemini-cli") as any;
    expect(session).toBeTruthy();
    expect(session.tool).toBe("gemini-cli");
    expect(session.provider).toBe("google");
    expect(session.total_input_tokens).toBe(5000);
    expect(session.total_output_tokens).toBe(2000);
    expect(session.total_cache_read_tokens).toBe(700);
    expect(session.primary_model).toBe("gemini-2.5-pro");
    expect(session.total_cost_usd).toBeGreaterThan(0);
  });

  it("returns format warning for missing messages array", () => {
    const validation = collector.validateFormat({ noMessages: true });
    expect(validation.valid).toBe(false);
    expect(validation.warning).toContain("Missing messages array");
  });

  it("handles parse error gracefully and logs warning", async () => {
    const sessionDir = join(TMP_DIR, "session-bad");
    mkdirSync(sessionDir, { recursive: true });
    const filePath = join(sessionDir, "state.json");
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
