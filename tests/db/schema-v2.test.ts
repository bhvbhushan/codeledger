import { describe, it, expect, afterEach } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { createConnection } from "../../src/db/connection.js";
import { runMigrations } from "../../src/db/migrate.js";

const TEST_DB = "/tmp/codeledger-schema-v2-test.db";

afterEach(() => {
  for (const ext of ["", "-wal", "-shm"]) {
    if (existsSync(TEST_DB + ext)) unlinkSync(TEST_DB + ext);
  }
});

describe("schema v2 migration", () => {
  it("creates agents and skills tables", () => {
    const db = createConnection(TEST_DB);
    runMigrations(db);

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all()
      .map((r: any) => r.name);

    expect(tables).toContain("agents");
    expect(tables).toContain("skills");
    db.close();
  });

  it("agents table has correct columns", () => {
    const db = createConnection(TEST_DB);
    runMigrations(db);

    const columns = db
      .prepare("PRAGMA table_info(agents)")
      .all()
      .map((c: any) => c.name);

    expect(columns).toContain("id");
    expect(columns).toContain("session_id");
    expect(columns).toContain("agent_type");
    expect(columns).toContain("description");
    expect(columns).toContain("model");
    expect(columns).toContain("total_input_tokens");
    expect(columns).toContain("total_output_tokens");
    expect(columns).toContain("total_cache_create_tokens");
    expect(columns).toContain("total_cache_read_tokens");
    expect(columns).toContain("total_cost_usd");
    expect(columns).toContain("started_at");
    expect(columns).toContain("ended_at");
    expect(columns).toContain("message_count");
    db.close();
  });

  it("skills table has correct columns", () => {
    const db = createConnection(TEST_DB);
    runMigrations(db);

    const columns = db
      .prepare("PRAGMA table_info(skills)")
      .all()
      .map((c: any) => c.name);

    expect(columns).toContain("id");
    expect(columns).toContain("session_id");
    expect(columns).toContain("skill_name");
    expect(columns).toContain("invoked_at");
    expect(columns).toContain("est_input_tokens");
    expect(columns).toContain("est_output_tokens");
    expect(columns).toContain("est_cost_usd");
    expect(columns).toContain("is_estimated");
    db.close();
  });

  it("agents table uses composite primary key", () => {
    const db = createConnection(TEST_DB);
    runMigrations(db);

    // Insert a session first (FK requirement)
    db.prepare(
      "INSERT INTO projects (path, display_name, cwd, first_seen, last_active) VALUES (?, ?, ?, ?, ?)"
    ).run("test", "test", "/test", "2026-01-01", "2026-01-01");
    db.prepare(
      "INSERT INTO sessions (id, project_id, started_at, message_count) VALUES (?, 1, ?, 0)"
    ).run("sess-1", "2026-01-01T00:00:00Z");

    // Insert an agent
    db.prepare(
      "INSERT INTO agents (id, session_id, agent_type) VALUES (?, ?, ?)"
    ).run("agent-1", "sess-1", "general-purpose");

    // Same agent_id in a different session should work (composite PK)
    db.prepare(
      "INSERT INTO sessions (id, project_id, started_at, message_count) VALUES (?, 1, ?, 0)"
    ).run("sess-2", "2026-01-02T00:00:00Z");
    db.prepare(
      "INSERT INTO agents (id, session_id, agent_type) VALUES (?, ?, ?)"
    ).run("agent-1", "sess-2", "general-purpose");

    const count = db
      .prepare("SELECT COUNT(*) as c FROM agents")
      .get() as any;
    expect(count.c).toBe(2);

    // Duplicate (same session_id + id) should fail
    expect(() =>
      db
        .prepare(
          "INSERT INTO agents (id, session_id, agent_type) VALUES (?, ?, ?)"
        )
        .run("agent-1", "sess-1", "general-purpose")
    ).toThrow();

    db.close();
  });

  it("schema version is 3 after migration", () => {
    const db = createConnection(TEST_DB);
    runMigrations(db);

    const version = db
      .prepare("SELECT MAX(version) as v FROM schema_version")
      .get() as any;
    expect(version.v).toBe(3);
    db.close();
  });

  it("is idempotent — running migrations twice succeeds", () => {
    const db = createConnection(TEST_DB);
    runMigrations(db);
    runMigrations(db);

    const version = db
      .prepare("SELECT MAX(version) as v FROM schema_version")
      .get() as any;
    expect(version.v).toBe(3);

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all()
      .map((r: any) => r.name);
    expect(tables).toContain("agents");
    expect(tables).toContain("skills");
    db.close();
  });

  it("existing Phase A data survives migration to v2", () => {
    const db = createConnection(TEST_DB);
    // Run only v1 first by manual exec
    runMigrations(db);

    // Insert Phase A data
    db.prepare(
      "INSERT INTO projects (path, display_name, cwd, first_seen, last_active) VALUES (?, ?, ?, ?, ?)"
    ).run("test-proj", "TestProj", "/test", "2026-01-01", "2026-03-15");
    db.prepare(
      "INSERT INTO sessions (id, project_id, started_at, total_cost_usd, message_count) VALUES (?, 1, ?, ?, ?)"
    ).run("old-session", "2026-03-15T10:00:00Z", 5.50, 10);

    // Re-run migrations (should be no-op since already at v2)
    runMigrations(db);

    // Phase A data should be intact
    const session = db
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get("old-session") as any;
    expect(session).toBeTruthy();
    expect(session.total_cost_usd).toBeCloseTo(5.50);
    expect(session.message_count).toBe(10);
    db.close();
  });

  it("agents table has source_category column after v3 migration", () => {
    const db = createConnection(TEST_DB);
    runMigrations(db);

    const columns = db
      .prepare("PRAGMA table_info(agents)")
      .all()
      .map((c: any) => c.name);

    expect(columns).toContain("source_category");
    db.close();
  });

  it("creates indexes for agents and skills", () => {
    const db = createConnection(TEST_DB);
    runMigrations(db);

    const indexes = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' ORDER BY name"
      )
      .all()
      .map((r: any) => r.name);

    expect(indexes).toContain("idx_agents_session");
    expect(indexes).toContain("idx_agents_type");
    expect(indexes).toContain("idx_skills_session");
    expect(indexes).toContain("idx_skills_name");
    expect(indexes).toContain("idx_skills_invoked_at");
    expect(indexes).toContain("idx_agents_source_category");
    db.close();
  });
});
