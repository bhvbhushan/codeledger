import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { createConnection } from "../../src/db/connection.js";
import { runMigrations } from "../../src/db/migrate.js";
import { seedPricing } from "../../src/db/pricing.js";
import {
  categorizeSession,
  getSessionToolProfile,
  classifyAndUpdateSession,
  classifyAllSessions,
} from "../../src/classifier/categorize-session.js";

const TEST_DB = "/tmp/codeledger-classify-test.db";
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

describe("categorizeSession", () => {
  it("classifies generation sessions (Write + Edit heavy)", () => {
    expect(
      categorizeSession({ Write: 15, Edit: 10, Read: 3, Bash: 2 })
    ).toBe("generation");
  });

  it("classifies exploration sessions (Read + Grep + Glob heavy)", () => {
    expect(
      categorizeSession({ Read: 20, Grep: 15, Glob: 10, Edit: 2 })
    ).toBe("exploration");
  });

  it("classifies debugging sessions (Bash + Edit combos)", () => {
    expect(
      categorizeSession({ Bash: 8, Edit: 5, Read: 3, Write: 2 })
    ).toBe("debugging");
  });

  it("classifies review sessions (Read-heavy, no Write/Edit)", () => {
    expect(categorizeSession({ Read: 20, Grep: 5, Glob: 3 })).toBe("review");
  });

  it("classifies planning sessions (Agent-heavy, low gen)", () => {
    expect(categorizeSession({ Agent: 10, Read: 3, Bash: 1 })).toBe(
      "planning"
    );
  });

  it("classifies devops sessions (Bash-heavy, no editing)", () => {
    expect(categorizeSession({ Bash: 20, Read: 3, Grep: 1 })).toBe("devops");
  });

  it("classifies mixed sessions (no dominant pattern)", () => {
    expect(
      categorizeSession({ Read: 5, Write: 3, Bash: 2, Agent: 3, Grep: 2 })
    ).toBe("mixed");
  });

  it("returns mixed for empty tool profile", () => {
    expect(categorizeSession({})).toBe("mixed");
  });

  it("ignores framework noise tools in classification", () => {
    // Real scenario: Bash-heavy session diluted by TaskUpdate, Skill, ToolSearch
    expect(categorizeSession({
      Bash: 1107, Read: 419, Edit: 204, Write: 107, Agent: 166,
      TaskUpdate: 260, Skill: 50, ToolSearch: 13, TaskCreate: 13, TaskList: 13,
    })).toBe("debugging"); // Bash > 20% of signal tools + gen > 0

    // Exploration diluted by mcp__ tools
    expect(categorizeSession({
      Read: 35, Grep: 3, Glob: 7,
      "mcp__supabase-readonly__execute_sql": 56, TaskUpdate: 9, TaskCreate: 9,
    })).toBe("review"); // Read-heavy with no Write/Edit
  });

  it("returns mixed when only noise tools exist (no signal)", () => {
    expect(categorizeSession({
      TaskUpdate: 100, TaskCreate: 20, Skill: 10,
    })).toBe("mixed");
  });
});

describe("classifyAndUpdateSession", () => {
  function seedSession(id: string, tools: Record<string, number>) {
    db.prepare(
      "INSERT INTO projects (path, display_name, cwd, first_seen, last_active) VALUES (?, ?, ?, ?, ?)"
    ).run("test", "test", "/test", "2026-01-01", "2026-01-01");
    db.prepare(
      "INSERT INTO sessions (id, project_id, started_at, message_count) VALUES (?, 1, ?, 0)"
    ).run(id, "2026-03-16T10:00:00Z");
    for (const [name, count] of Object.entries(tools)) {
      db.prepare(
        "INSERT INTO tool_calls (session_id, tool_name, call_count) VALUES (?, ?, ?)"
      ).run(id, name, count);
    }
  }

  it("classifies and updates session in DB", () => {
    seedSession("sess-gen", { Write: 15, Edit: 10, Read: 3 });
    const category = classifyAndUpdateSession(db, "sess-gen");
    expect(category).toBe("generation");

    const row = db
      .prepare("SELECT category FROM sessions WHERE id = ?")
      .get("sess-gen") as any;
    expect(row.category).toBe("generation");
  });

  it("handles session with no tool calls (mixed)", () => {
    db.prepare(
      "INSERT INTO projects (path, display_name, cwd, first_seen, last_active) VALUES (?, ?, ?, ?, ?)"
    ).run("test2", "test2", "/test2", "2026-01-01", "2026-01-01");
    db.prepare(
      "INSERT INTO sessions (id, project_id, started_at, message_count) VALUES (?, 1, ?, 0)"
    ).run("sess-empty", "2026-03-16T10:00:00Z");
    const category = classifyAndUpdateSession(db, "sess-empty");
    expect(category).toBe("mixed");
  });
});

describe("classifyAllSessions", () => {
  it("retroactively classifies all sessions with tool data", () => {
    db.prepare(
      "INSERT INTO projects (path, display_name, cwd, first_seen, last_active) VALUES (?, ?, ?, ?, ?)"
    ).run("test", "test", "/test", "2026-01-01", "2026-01-01");

    db.prepare(
      "INSERT INTO sessions (id, project_id, started_at, message_count) VALUES (?, 1, ?, 0)"
    ).run("s1", "2026-03-16T10:00:00Z");
    db.prepare(
      "INSERT INTO sessions (id, project_id, started_at, message_count) VALUES (?, 1, ?, 0)"
    ).run("s2", "2026-03-16T11:00:00Z");
    db.prepare(
      "INSERT INTO sessions (id, project_id, started_at, message_count) VALUES (?, 1, ?, 0)"
    ).run("s3", "2026-03-16T12:00:00Z");

    db.prepare(
      "INSERT INTO tool_calls (session_id, tool_name, call_count) VALUES (?, ?, ?)"
    ).run("s1", "Write", 20);
    db.prepare(
      "INSERT INTO tool_calls (session_id, tool_name, call_count) VALUES (?, ?, ?)"
    ).run("s1", "Edit", 10);
    db.prepare(
      "INSERT INTO tool_calls (session_id, tool_name, call_count) VALUES (?, ?, ?)"
    ).run("s2", "Read", 30);
    db.prepare(
      "INSERT INTO tool_calls (session_id, tool_name, call_count) VALUES (?, ?, ?)"
    ).run("s2", "Grep", 15);
    db.prepare(
      "INSERT INTO tool_calls (session_id, tool_name, call_count) VALUES (?, ?, ?)"
    ).run("s2", "Edit", 2);
    // s3 has no tool_calls — should not be classified

    const count = classifyAllSessions(db);
    expect(count).toBe(2); // Only s1 and s2

    const s1 = db
      .prepare("SELECT category FROM sessions WHERE id = ?")
      .get("s1") as any;
    const s2 = db
      .prepare("SELECT category FROM sessions WHERE id = ?")
      .get("s2") as any;
    const s3 = db
      .prepare("SELECT category FROM sessions WHERE id = ?")
      .get("s3") as any;

    expect(s1.category).toBe("generation");
    expect(s2.category).toBe("exploration"); // Read(30)+Grep(15)=45/47 > 0.6, gen=Edit(2) so not review
    expect(s3.category).toBe("mixed"); // unchanged default
  });
});

describe("schema v4", () => {
  it("sessions table has category column", () => {
    const columns = db
      .prepare("PRAGMA table_info(sessions)")
      .all()
      .map((c: any) => c.name);
    expect(columns).toContain("category");
  });

  it("schema version is 4", () => {
    const v = db
      .prepare("SELECT MAX(version) as v FROM schema_version")
      .get() as any;
    expect(v.v).toBe(4);
  });
});
