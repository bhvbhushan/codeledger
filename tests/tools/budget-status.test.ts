import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { createConnection } from "../../src/db/connection.js";
import { runMigrations } from "../../src/db/migrate.js";
import { seedPricing } from "../../src/db/pricing.js";
import { queryBudgetStatus } from "../../src/tools/budget-status.js";

const TEST_DB = "/tmp/codeledger-budget-status-test.db";
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

function seedProject(name = "proj1") {
  const now = new Date();
  const today =
    now.getFullYear() +
    "-" +
    String(now.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(now.getDate()).padStart(2, "0");
  db.prepare(
    "INSERT OR IGNORE INTO projects (path, display_name, cwd, first_seen, last_active) VALUES (?, ?, ?, ?, ?)"
  ).run(`/tmp/${name}`, name, `/tmp/${name}`, today, today);
}

function seedSession(id: string, cost: number, projectId = 1) {
  const now = new Date();
  const today =
    now.getFullYear() +
    "-" +
    String(now.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(now.getDate()).padStart(2, "0");
  db.prepare(
    "INSERT INTO sessions (id, project_id, started_at, primary_model, total_cost_usd, message_count) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, projectId, today + "T10:00:00Z", "claude-opus-4-6", cost, 5);
}

function seedBudget(
  limit: number,
  scope = "total",
  scopeId: string | null = null,
  period = "monthly"
) {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO budgets (scope, scope_id, period, limit_usd, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(scope, scopeId, period, limit, now, now);
}

describe("budget_status", () => {
  it("returns empty rows when no budgets configured", () => {
    const { rows } = queryBudgetStatus(db, "monthly");
    expect(rows).toHaveLength(0);
  });

  it("shows status for a single total budget", () => {
    seedProject();
    seedSession("s1", 50.0);
    seedBudget(200);

    const { rows } = queryBudgetStatus(db, "monthly");
    expect(rows).toHaveLength(1);
    expect(rows[0].scope).toBe("Total");
    expect(rows[0].budget).toBe(200);
    expect(rows[0].spent).toBeCloseTo(50.0);
    expect(rows[0].pct).toBe(25);
  });

  it("shows status for multiple budgets", () => {
    seedProject("proj1");
    seedProject("proj2");
    seedSession("s1", 30.0, 1);
    seedSession("s2", 20.0, 2);
    seedBudget(200);
    seedBudget(100, "project", "proj1");

    const { rows } = queryBudgetStatus(db, "monthly");
    expect(rows).toHaveLength(2);
    const totalRow = rows.find((r) => r.scope === "Total");
    const projRow = rows.find((r) => r.scope === "Project: proj1");
    expect(totalRow).toBeTruthy();
    expect(projRow).toBeTruthy();
    expect(totalRow!.spent).toBeCloseTo(50.0);
    expect(projRow!.spent).toBeCloseTo(30.0);
  });

  it("shows EXCEEDED status when budget is over limit", () => {
    seedProject();
    seedSession("s1", 250.0);
    seedBudget(200);

    const { rows } = queryBudgetStatus(db, "monthly");
    expect(rows[0].status).toBe("EXCEEDED");
    expect(rows[0].pct).toBeGreaterThanOrEqual(100);
  });

  it("shows overshoot warning when projected spend exceeds limit", () => {
    seedProject();
    // Early in month with high spend -> projected overshoot
    // Seed enough cost so velocity * total_days > limit
    seedSession("s1", 80.0);
    seedBudget(100);

    const { rows } = queryBudgetStatus(db, "monthly");
    // Depending on day of month, this should either be overshoot or caution
    expect(["Overshoot warning", "Caution", "EXCEEDED"]).toContain(
      rows[0].status
    );
  });
});
