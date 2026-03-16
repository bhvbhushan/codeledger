import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { createConnection } from "../../src/db/connection.js";
import { runMigrations } from "../../src/db/migrate.js";
import { seedPricing } from "../../src/db/pricing.js";
import { handleSkillUse } from "../../src/hooks/on-skill-use.js";

const TEST_DB = "/tmp/codeledger-skill-hook-test.db";
let db: any;

beforeEach(() => {
  db = createConnection(TEST_DB);
  runMigrations(db);
  seedPricing(db);

  // Create parent session
  db.prepare(
    "INSERT INTO projects (path, display_name, cwd, first_seen, last_active) VALUES (?, ?, ?, ?, ?)"
  ).run("-tmp-myproject", "myproject", "/tmp/myproject", "2026-03-16", "2026-03-16");
  db.prepare(
    "INSERT INTO sessions (id, project_id, started_at, message_count) VALUES (?, 1, ?, 0)"
  ).run("sess-skill-001", "2026-03-16T10:00:00.000Z");
});

afterEach(() => {
  db.close();
  for (const ext of ["", "-wal", "-shm"]) {
    if (existsSync(TEST_DB + ext)) unlinkSync(TEST_DB + ext);
  }
});

describe("on-skill-use hook", () => {
  it("logs skill invocation to skills table", async () => {
    const payload = {
      session_id: "sess-skill-001",
      tool_name: "Skill",
      tool_input: {
        skill: "superpowers:brainstorming",
        args: "",
      },
      tool_response: "Skill invoked successfully",
      transcript_path: "/Users/test/.claude/projects/-tmp-myproject/sess-skill-001.jsonl",
      cwd: "/tmp/myproject",
      permission_mode: "default",
      hook_event_name: "PostToolUse",
    };

    await handleSkillUse(payload, TEST_DB);

    const readDb = createConnection(TEST_DB);
    const skill = readDb
      .prepare("SELECT * FROM skills WHERE session_id = ?")
      .get("sess-skill-001") as any;

    expect(skill).toBeTruthy();
    expect(skill.skill_name).toBe("superpowers:brainstorming");
    expect(skill.invoked_at).toBeTruthy();
    expect(skill.is_estimated).toBe(1); // SQLite boolean
    readDb.close();
  });

  it("handles multiple skill invocations in same session", async () => {
    const basePayload = {
      session_id: "sess-skill-001",
      tool_name: "Skill",
      tool_response: "ok",
      transcript_path: "/Users/test/.claude/projects/-tmp-myproject/sess-skill-001.jsonl",
      cwd: "/tmp/myproject",
      permission_mode: "default",
      hook_event_name: "PostToolUse",
    };

    await handleSkillUse(
      { ...basePayload, tool_input: { skill: "superpowers:brainstorming", args: "" } },
      TEST_DB
    );
    await handleSkillUse(
      { ...basePayload, tool_input: { skill: "superpowers:code-review", args: "" } },
      TEST_DB
    );
    await handleSkillUse(
      { ...basePayload, tool_input: { skill: "superpowers:brainstorming", args: "plan" } },
      TEST_DB
    );

    const readDb = createConnection(TEST_DB);
    const skills = readDb
      .prepare("SELECT * FROM skills WHERE session_id = ? ORDER BY id")
      .all("sess-skill-001") as any[];

    expect(skills).toHaveLength(3);
    expect(skills[0].skill_name).toBe("superpowers:brainstorming");
    expect(skills[1].skill_name).toBe("superpowers:code-review");
    expect(skills[2].skill_name).toBe("superpowers:brainstorming");
    readDb.close();
  });

  it("handles missing tool_input.skill gracefully (no throw)", async () => {
    const payload = {
      session_id: "sess-skill-001",
      tool_name: "Skill",
      tool_input: {}, // No skill field
      tool_response: "ok",
      cwd: "/tmp/myproject",
      permission_mode: "default",
      hook_event_name: "PostToolUse",
    };

    // Should not throw — just log warning and exit
    await expect(
      handleSkillUse(payload, TEST_DB)
    ).resolves.not.toThrow();

    const readDb = createConnection(TEST_DB);
    const count = readDb
      .prepare("SELECT COUNT(*) as c FROM skills")
      .get() as any;
    expect(count.c).toBe(0); // Nothing inserted
    readDb.close();
  });

  it("handles missing tool_input entirely (no throw)", async () => {
    const payload = {
      session_id: "sess-skill-001",
      tool_name: "Skill",
      // No tool_input at all
      tool_response: "ok",
      cwd: "/tmp/myproject",
      permission_mode: "default",
      hook_event_name: "PostToolUse",
    };

    await expect(
      handleSkillUse(payload, TEST_DB)
    ).resolves.not.toThrow();
  });

  it("handles missing parent session gracefully (FK)", async () => {
    db.prepare("DELETE FROM sessions").run();

    const payload = {
      session_id: "nonexistent-session",
      tool_name: "Skill",
      tool_input: { skill: "superpowers:brainstorming", args: "" },
      tool_response: "ok",
      cwd: "/tmp/myproject",
      permission_mode: "default",
      hook_event_name: "PostToolUse",
    };

    // Should not throw — FK violation handled
    await expect(
      handleSkillUse(payload, TEST_DB)
    ).resolves.not.toThrow();
  });
});
