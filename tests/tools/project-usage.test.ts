import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { createConnection } from "../../src/db/connection.js";
import { runMigrations } from "../../src/db/migrate.js";
import { upsertProject, insertSession } from "../../src/db/queries.js";
import { queryProjectUsage } from "../../src/tools/project-usage.js";
import type Database from "better-sqlite3";

const TEST_DB = "/tmp/codeledger-project-usage-test.db";

function cleanup() {
  for (const suffix of ["", "-wal", "-shm"]) {
    const f = TEST_DB + suffix;
    if (existsSync(f)) unlinkSync(f);
  }
}

function makeSession(overrides: Partial<Parameters<typeof insertSession>[1]>) {
  return {
    id: "sess-" + Math.random().toString(36).slice(2, 10),
    projectId: 1,
    startedAt: new Date().toISOString(),
    endedAt: null,
    endReason: null,
    primaryModel: "claude-sonnet-4-20250514",
    claudeVersion: null,
    gitBranch: null,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheCreateTokens: 0,
    totalCacheReadTokens: 0,
    totalCostUsd: 0,
    messageCount: 1,
    toolUseCount: 0,
    agentCount: 0,
    ...overrides,
  };
}

describe("queryProjectUsage", () => {
  let db: Database.Database;

  beforeEach(() => {
    cleanup();
    db = createConnection(TEST_DB);
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
    cleanup();
  });

  it("returns projects sorted by cost descending", () => {
    const now = new Date().toISOString();

    const p1 = upsertProject(db, "/projects/alpha", "alpha", "/tmp/alpha", now);
    const p2 = upsertProject(db, "/projects/beta", "beta", "/tmp/beta", now);
    const p3 = upsertProject(db, "/projects/gamma", "gamma", "/tmp/gamma", now);

    insertSession(db, makeSession({ projectId: p1, totalInputTokens: 1000, totalOutputTokens: 500, totalCostUsd: 0.50 }));
    insertSession(db, makeSession({ projectId: p2, totalInputTokens: 5000, totalOutputTokens: 2000, totalCostUsd: 2.00 }));
    insertSession(db, makeSession({ projectId: p3, totalInputTokens: 3000, totalOutputTokens: 1000, totalCostUsd: 1.25 }));

    const results = queryProjectUsage(db, "today", "cost", 10);

    expect(results).toHaveLength(3);
    expect(results[0].project).toBe("beta");
    expect(results[0].total_cost).toBeCloseTo(2.0);
    expect(results[1].project).toBe("gamma");
    expect(results[1].total_cost).toBeCloseTo(1.25);
    expect(results[2].project).toBe("alpha");
    expect(results[2].total_cost).toBeCloseTo(0.5);
  });

  it("sorts by tokens when requested", () => {
    const now = new Date().toISOString();

    const p1 = upsertProject(db, "/projects/alpha", "alpha", "/tmp/alpha", now);
    const p2 = upsertProject(db, "/projects/beta", "beta", "/tmp/beta", now);

    insertSession(db, makeSession({ projectId: p1, totalInputTokens: 10000, totalOutputTokens: 5000, totalCostUsd: 0.10 }));
    insertSession(db, makeSession({ projectId: p2, totalInputTokens: 1000, totalOutputTokens: 500, totalCostUsd: 5.00 }));

    const results = queryProjectUsage(db, "today", "tokens", 10);

    expect(results).toHaveLength(2);
    expect(results[0].project).toBe("alpha");
    expect(results[0].total_tokens).toBe(15000);
    expect(results[1].project).toBe("beta");
    expect(results[1].total_tokens).toBe(1500);
  });

  it("respects the limit parameter", () => {
    const now = new Date().toISOString();

    const p1 = upsertProject(db, "/projects/alpha", "alpha", "/tmp/alpha", now);
    const p2 = upsertProject(db, "/projects/beta", "beta", "/tmp/beta", now);
    const p3 = upsertProject(db, "/projects/gamma", "gamma", "/tmp/gamma", now);

    insertSession(db, makeSession({ projectId: p1, totalCostUsd: 1.00 }));
    insertSession(db, makeSession({ projectId: p2, totalCostUsd: 2.00 }));
    insertSession(db, makeSession({ projectId: p3, totalCostUsd: 3.00 }));

    const results = queryProjectUsage(db, "today", "cost", 2);

    expect(results).toHaveLength(2);
    expect(results[0].project).toBe("gamma");
    expect(results[1].project).toBe("beta");
  });

  it("returns empty array when no data for period", () => {
    // Insert data with a past date that won't match "today"
    const pastDate = "2020-01-01T00:00:00Z";

    const p1 = upsertProject(db, "/projects/alpha", "alpha", "/tmp/alpha", pastDate);
    insertSession(db, makeSession({ projectId: p1, startedAt: pastDate, totalCostUsd: 5.00 }));

    const results = queryProjectUsage(db, "today", "cost", 10);

    expect(results).toHaveLength(0);
  });

  it("aggregates multiple sessions per project", () => {
    const now = new Date().toISOString();

    const p1 = upsertProject(db, "/projects/alpha", "alpha", "/tmp/alpha", now);

    insertSession(db, makeSession({ projectId: p1, totalInputTokens: 1000, totalOutputTokens: 500, totalCostUsd: 0.50 }));
    insertSession(db, makeSession({ projectId: p1, totalInputTokens: 2000, totalOutputTokens: 1000, totalCostUsd: 1.00 }));

    const results = queryProjectUsage(db, "today", "cost", 10);

    expect(results).toHaveLength(1);
    expect(results[0].project).toBe("alpha");
    expect(results[0].total_cost).toBeCloseTo(1.50);
    expect(results[0].total_tokens).toBe(4500);
    expect(results[0].session_count).toBe(2);
  });

  it("sorts by sessions when requested", () => {
    const now = new Date().toISOString();

    const p1 = upsertProject(db, "/projects/alpha", "alpha", "/tmp/alpha", now);
    const p2 = upsertProject(db, "/projects/beta", "beta", "/tmp/beta", now);

    // alpha: 3 sessions
    insertSession(db, makeSession({ projectId: p1, totalCostUsd: 0.10 }));
    insertSession(db, makeSession({ projectId: p1, totalCostUsd: 0.10 }));
    insertSession(db, makeSession({ projectId: p1, totalCostUsd: 0.10 }));

    // beta: 1 session but higher cost
    insertSession(db, makeSession({ projectId: p2, totalCostUsd: 5.00 }));

    const results = queryProjectUsage(db, "today", "sessions", 10);

    expect(results).toHaveLength(2);
    expect(results[0].project).toBe("alpha");
    expect(results[0].session_count).toBe(3);
    expect(results[1].project).toBe("beta");
    expect(results[1].session_count).toBe(1);
  });
});
