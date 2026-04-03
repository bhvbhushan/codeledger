import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { resolve } from "path";
import { createConnection } from "../../src/db/connection.js";
import { runMigrations } from "../../src/db/migrate.js";
import { seedPricing } from "../../src/db/pricing.js";
import { handleSessionEnd } from "../../src/hooks/on-session-end.js";
import { checkBudgetAlerts } from "../../src/hooks/budget-alert.js";

const TEST_DB = "/tmp/codeledger-hook-test.db";
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

describe("on-session-end hook", () => {
  it("parses session from hook payload and writes to DB", async () => {
    const payload = {
      session_id: "hook-test-session",
      transcript_path: `${FIXTURES}/simple-session.jsonl`,
      cwd: "/Users/test/myproject",
      permission_mode: "default",
      hook_event_name: "SessionEnd",
      reason: "exit",
    };

    await handleSessionEnd(payload, TEST_DB);

    // Verify session was written (open a fresh connection to read)
    const readDb = createConnection(TEST_DB);
    const session = readDb.prepare("SELECT * FROM sessions LIMIT 1").get() as any;
    expect(session).toBeTruthy();
    expect(session.end_reason).toBe("exit");
    expect(session.total_cost_usd).toBeGreaterThan(0);
    readDb.close();
  });
});

describe("budget alerts", () => {
  it("does not write to stderr when no budgets exist", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    checkBudgetAlerts(db);
    const budgetCalls = stderrSpy.mock.calls.filter(
      (c) => typeof c[0] === "string" && c[0].includes("Budget alert")
    );
    expect(budgetCalls).toHaveLength(0);
    stderrSpy.mockRestore();
  });

  it("writes stderr warning when budget exceeds 75%", () => {
    const now = new Date();
    const today =
      now.getFullYear() +
      "-" +
      String(now.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(now.getDate()).padStart(2, "0");

    db.prepare(
      "INSERT INTO projects (path, display_name, cwd, first_seen, last_active) VALUES (?, ?, ?, ?, ?)"
    ).run("/tmp/proj", "proj", "/tmp/proj", today, today);
    db.prepare(
      "INSERT INTO sessions (id, project_id, started_at, primary_model, total_cost_usd, message_count) VALUES (?, 1, ?, ?, ?, ?)"
    ).run("s-budget", today + "T10:00:00Z", "claude-opus-4-6", 160.0, 5);

    const budgetNow = new Date().toISOString();
    db.prepare(
      "INSERT INTO budgets (scope, scope_id, period, limit_usd, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("total", null, "monthly", 200, budgetNow, budgetNow);

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    checkBudgetAlerts(db);
    const budgetCalls = stderrSpy.mock.calls.filter(
      (c) => typeof c[0] === "string" && c[0].includes("Budget alert")
    );
    expect(budgetCalls.length).toBeGreaterThanOrEqual(1);
    expect(String(budgetCalls[0][0])).toContain("80%");
    stderrSpy.mockRestore();
  });
});
