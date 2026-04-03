import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { createConnection } from "../../src/db/connection.js";
import { runMigrations } from "../../src/db/migrate.js";
import { seedPricing } from "../../src/db/pricing.js";
import { setBudget } from "../../src/tools/budget-set.js";

const TEST_DB = "/tmp/codeledger-budget-set-test.db";
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

describe("budget_set", () => {
  it("creates a new budget", () => {
    setBudget(db, 200, "total", undefined, "monthly");

    const row = db
      .prepare("SELECT * FROM budgets WHERE scope = 'total' AND period = 'monthly'")
      .get() as any;
    expect(row).toBeTruthy();
    expect(row.limit_usd).toBe(200);
  });

  it("updates an existing budget via upsert", () => {
    setBudget(db, 200, "total", undefined, "monthly");
    setBudget(db, 300, "total", undefined, "monthly");

    const rows = db
      .prepare("SELECT * FROM budgets WHERE scope = 'total' AND period = 'monthly'")
      .all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].limit_usd).toBe(300);
  });

  it("creates project-scoped budget with scope_id", () => {
    setBudget(db, 50, "project", "my-project", "weekly");

    const row = db
      .prepare("SELECT * FROM budgets WHERE scope = 'project' AND scope_id = ?")
      .get("my-project") as any;
    expect(row).toBeTruthy();
    expect(row.limit_usd).toBe(50);
    expect(row.period).toBe("weekly");
  });

  it("allows multiple budgets with different periods", () => {
    setBudget(db, 200, "total", undefined, "monthly");
    setBudget(db, 10, "total", undefined, "daily");

    const rows = db.prepare("SELECT * FROM budgets WHERE scope = 'total'").all() as any[];
    expect(rows).toHaveLength(2);
  });
});
