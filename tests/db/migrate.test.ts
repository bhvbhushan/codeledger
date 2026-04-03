import { describe, it, expect, afterEach } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { createConnection } from "../../src/db/connection.js";
import { runMigrations } from "../../src/db/migrate.js";

const TEST_DB = "/tmp/codeledger-migrate-test.db";

afterEach(() => {
  for (const ext of ["", "-wal", "-shm", ".bak"]) {
    if (existsSync(TEST_DB + ext)) unlinkSync(TEST_DB + ext);
  }
});

describe("migration rollback safety", () => {
  it("deletes backup after successful migration", () => {
    const db = createConnection(TEST_DB);
    runMigrations(db, TEST_DB);
    db.close();

    expect(existsSync(TEST_DB + ".bak")).toBe(false);
    expect(existsSync(TEST_DB)).toBe(true);
  });

  it("preserves backup on migration failure", () => {
    const db = createConnection(TEST_DB);
    runMigrations(db, TEST_DB);

    // Reset to version 3 so migrations v4+ re-run
    db.prepare("DELETE FROM schema_version WHERE version >= 4").run();
    // Rename sessions table so ALTER TABLE sessions fails
    db.exec("ALTER TABLE sessions RENAME TO sessions_broken");

    expect(() => runMigrations(db, TEST_DB)).toThrow();
    expect(existsSync(TEST_DB + ".bak")).toBe(true);

    // DB should still be at version 3 (v4 failed)
    const version = db
      .prepare("SELECT MAX(version) as v FROM schema_version")
      .get() as { v: number };
    expect(version.v).toBe(3);
    db.close();
  });

  it("works without dbPath (in-memory / test mode)", () => {
    const db = createConnection(TEST_DB);
    // No dbPath passed — should still run without errors
    runMigrations(db);

    const version = db
      .prepare("SELECT MAX(version) as v FROM schema_version")
      .get() as { v: number };
    expect(version.v).toBe(6);
    db.close();
  });

  it("handles idempotent ALTER TABLE safely", () => {
    const db = createConnection(TEST_DB);
    runMigrations(db, TEST_DB);

    // Running migrations again should succeed (ALTER TABLE guarded)
    runMigrations(db, TEST_DB);

    const version = db
      .prepare("SELECT MAX(version) as v FROM schema_version")
      .get() as { v: number };
    expect(version.v).toBe(6);

    // Verify the columns exist
    const agentCols = db.pragma("table_info(agents)") as Array<{
      name: string;
    }>;
    expect(agentCols.some((c) => c.name === "source_category")).toBe(true);

    const sessionCols = db.pragma("table_info(sessions)") as Array<{
      name: string;
    }>;
    expect(sessionCols.some((c) => c.name === "category")).toBe(true);

    db.close();
  });
});
