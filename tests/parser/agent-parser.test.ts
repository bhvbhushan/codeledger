import { describe, it, expect, afterEach } from "vitest";
import { existsSync, unlinkSync, mkdirSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { createConnection } from "../../src/db/connection.js";
import { runMigrations } from "../../src/db/migrate.js";
import { seedPricing } from "../../src/db/pricing.js";
import { parseAgentFile, readAgentMeta } from "../../src/parser/agent-parser.js";

const TEST_DB = "/tmp/codeledger-agent-parser-test.db";
const FIXTURES = resolve(import.meta.dirname, "../fixtures");
let db: any;

afterEach(() => {
  if (db) db.close();
  for (const ext of ["", "-wal", "-shm"]) {
    if (existsSync(TEST_DB + ext)) unlinkSync(TEST_DB + ext);
  }
});

describe("agent-parser", () => {
  function setupDb() {
    db = createConnection(TEST_DB);
    runMigrations(db);
    seedPricing(db);

    // Create parent session (FK requirement)
    db.prepare(
      "INSERT INTO projects (path, display_name, cwd, first_seen, last_active) VALUES (?, ?, ?, ?, ?)"
    ).run("-tmp-myproject", "myproject", "/Users/test/myproject", "2026-03-16", "2026-03-16");
    db.prepare(
      "INSERT INTO sessions (id, project_id, started_at, message_count) VALUES (?, 1, ?, 0)"
    ).run("parent-session-001", "2026-03-16T10:00:00.000Z");

    return db;
  }

  describe("readAgentMeta", () => {
    it("reads agentType from meta.json", () => {
      const meta = readAgentMeta(`${FIXTURES}/agent-meta.json`);
      expect(meta).toEqual({ agentType: "general-purpose" });
    });

    it("returns null for missing meta.json", () => {
      const meta = readAgentMeta("/nonexistent/path/agent-xyz.meta.json");
      expect(meta).toBeNull();
    });

    it("returns null for malformed meta.json", () => {
      const tmpPath = "/tmp/codeledger-bad-meta.json";
      writeFileSync(tmpPath, "not valid json{{{");
      const meta = readAgentMeta(tmpPath);
      expect(meta).toBeNull();
      unlinkSync(tmpPath);
    });
  });

  describe("parseAgentFile", () => {
    it("parses agent JSONL and returns agent record", async () => {
      setupDb();
      const result = await parseAgentFile(
        db,
        `${FIXTURES}/agent-session.jsonl`,
        "agent-abc123",
        "parent-session-001",
        "general-purpose"
      );

      expect(result).toBeTruthy();
      expect(result!.agentId).toBe("agent-abc123");
      expect(result!.sessionId).toBe("parent-session-001");
      expect(result!.messageCount).toBe(2);
      expect(result!.totalInputTokens).toBe(1100); // 500 + 600
      expect(result!.totalOutputTokens).toBe(300); // 200 + 100
      expect(result!.totalCostUsd).toBeGreaterThan(0);
      expect(result!.model).toBe("claude-sonnet-4-5-20250514");
    });

    it("writes agent record to agents table", async () => {
      setupDb();
      await parseAgentFile(
        db,
        `${FIXTURES}/agent-session.jsonl`,
        "agent-abc123",
        "parent-session-001",
        "general-purpose"
      );

      const agent = db
        .prepare("SELECT * FROM agents WHERE id = ? AND session_id = ?")
        .get("agent-abc123", "parent-session-001") as any;

      expect(agent).toBeTruthy();
      expect(agent.agent_type).toBe("general-purpose");
      expect(agent.total_input_tokens).toBe(1100);
      expect(agent.total_output_tokens).toBe(300);
      expect(agent.total_cost_usd).toBeGreaterThan(0);
      expect(agent.message_count).toBe(2);
      expect(agent.model).toBe("claude-sonnet-4-5-20250514");
      expect(agent.started_at).toBe("2026-03-16T10:05:01.000Z");
      expect(agent.ended_at).toBe("2026-03-16T10:05:03.000Z");
    });

    it("handles INSERT OR REPLACE for re-parsing same agent", async () => {
      setupDb();
      await parseAgentFile(
        db,
        `${FIXTURES}/agent-session.jsonl`,
        "agent-abc123",
        "parent-session-001",
        "general-purpose"
      );
      // Parse again — should not throw
      await parseAgentFile(
        db,
        `${FIXTURES}/agent-session.jsonl`,
        "agent-abc123",
        "parent-session-001",
        "general-purpose"
      );

      const count = db
        .prepare("SELECT COUNT(*) as c FROM agents WHERE id = ?")
        .get("agent-abc123") as any;
      expect(count.c).toBe(1);
    });

    it("returns null for empty agent JSONL (no assistant messages)", async () => {
      setupDb();
      const tmpPath = "/tmp/codeledger-empty-agent.jsonl";
      writeFileSync(
        tmpPath,
        '{"type":"user","sessionId":"parent-session-001","agentId":"agent-empty","timestamp":"2026-03-16T10:00:00Z","message":{"role":"user","content":"hi"}}\n'
      );

      const result = await parseAgentFile(
        db,
        tmpPath,
        "agent-empty",
        "parent-session-001",
        "general-purpose"
      );

      expect(result).toBeNull();
      unlinkSync(tmpPath);
    });

    it("skips synthetic messages in agent JSONL", async () => {
      setupDb();
      const tmpPath = "/tmp/codeledger-synthetic-agent.jsonl";
      writeFileSync(
        tmpPath,
        [
          '{"type":"user","sessionId":"parent-session-001","agentId":"agent-syn","timestamp":"2026-03-16T10:00:00Z","message":{"role":"user","content":"hi"}}',
          '{"type":"assistant","sessionId":"parent-session-001","agentId":"agent-syn","timestamp":"2026-03-16T10:00:01Z","message":{"model":"<synthetic>","id":"msg_syn_001","role":"assistant","content":[{"type":"text","text":"error"}],"stop_reason":"stop_sequence","usage":{"input_tokens":0,"output_tokens":0}}}',
          '{"type":"assistant","sessionId":"parent-session-001","agentId":"agent-syn","timestamp":"2026-03-16T10:00:02Z","message":{"model":"claude-sonnet-4-5-20250514","id":"msg_syn_002","role":"assistant","content":[{"type":"text","text":"done"}],"stop_reason":"stop_sequence","usage":{"input_tokens":100,"output_tokens":50,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}',
        ].join("\n")
      );

      const result = await parseAgentFile(
        db,
        tmpPath,
        "agent-syn",
        "parent-session-001",
        "general-purpose"
      );

      expect(result).toBeTruthy();
      expect(result!.messageCount).toBe(1); // Only the non-synthetic one
      expect(result!.totalInputTokens).toBe(100);
      unlinkSync(tmpPath);
    });

    it("gracefully handles missing parent session (INSERT OR IGNORE)", async () => {
      // DB with no parent session inserted
      db = createConnection(TEST_DB);
      runMigrations(db);
      seedPricing(db);

      // This should not throw — it should skip the insert gracefully
      const result = await parseAgentFile(
        db,
        `${FIXTURES}/agent-session.jsonl`,
        "agent-abc123",
        "nonexistent-session",
        "general-purpose"
      );

      // Returns parsed data but agent is NOT in DB (FK violation handled)
      expect(result).toBeTruthy();
      const agent = db
        .prepare("SELECT * FROM agents WHERE id = ?")
        .get("agent-abc123") as any;
      expect(agent).toBeFalsy(); // Not inserted because parent session missing
    });
  });
});
