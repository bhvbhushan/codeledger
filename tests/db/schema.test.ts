import { describe, it, expect, afterEach } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { createConnection } from "../../src/db/connection.js";
import { runMigrations } from "../../src/db/migrate.js";

const TEST_DB = "/tmp/codeledger-test.db";

afterEach(() => {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  if (existsSync(TEST_DB + "-wal")) unlinkSync(TEST_DB + "-wal");
  if (existsSync(TEST_DB + "-shm")) unlinkSync(TEST_DB + "-shm");
});

describe("schema", () => {
  it("creates all Phase A tables", () => {
    const db = createConnection(TEST_DB);
    runMigrations(db);

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all()
      .map((r: any) => r.name);

    expect(tables).toContain("projects");
    expect(tables).toContain("sessions");
    expect(tables).toContain("token_usage");
    expect(tables).toContain("tool_calls");
    expect(tables).toContain("daily_summaries");
    expect(tables).toContain("sync_state");
    expect(tables).toContain("model_pricing");
    expect(tables).toContain("schema_version");
    db.close();
  });

  it("sets WAL mode and pragmas", () => {
    const db = createConnection(TEST_DB);
    const journalMode = db.pragma("journal_mode", { simple: true });
    expect(journalMode).toBe("wal");
    const fk = db.pragma("foreign_keys", { simple: true });
    expect(fk).toBe(1);
    db.close();
  });

  it("is idempotent — running migrations twice succeeds", () => {
    const db = createConnection(TEST_DB);
    runMigrations(db);
    runMigrations(db);

    const version = db
      .prepare("SELECT MAX(version) as v FROM schema_version")
      .get() as any;
    expect(version.v).toBe(4);
    db.close();
  });
});
