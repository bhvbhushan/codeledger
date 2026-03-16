import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { createConnection } from "../../src/db/connection.js";
import { runMigrations } from "../../src/db/migrate.js";
import { seedPricing } from "../../src/db/pricing.js";
import { upsertProject, insertSession, insertTokenUsage } from "../../src/db/queries.js";
import { queryModelStats } from "../../src/tools/model-stats.js";

const TEST_DB = "/tmp/codeledger-model-stats-test.db";
let db: any;

function cleanup() {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  if (existsSync(TEST_DB + "-wal")) unlinkSync(TEST_DB + "-wal");
  if (existsSync(TEST_DB + "-shm")) unlinkSync(TEST_DB + "-shm");
}

beforeEach(() => {
  cleanup();
  db = createConnection(TEST_DB);
  runMigrations(db);
  seedPricing(db);
});

afterEach(() => {
  db.close();
  cleanup();
});

function seedTestData() {
  const now = new Date().toISOString();
  const projectId = upsertProject(db, "/test/project", "test-project", "/test/project", now);

  insertSession(db, {
    id: "sess-model-stats-1",
    projectId,
    startedAt: now,
    endedAt: now,
    endReason: "user_exit",
    primaryModel: "claude-opus-4-6",
    claudeVersion: "1.0.0",
    gitBranch: "main",
    totalInputTokens: 15000,
    totalOutputTokens: 5000,
    totalCacheCreateTokens: 0,
    totalCacheReadTokens: 0,
    totalCostUsd: 0.6,
    messageCount: 10,
    toolUseCount: 5,
    agentCount: 1,
  });

  // Opus token usage rows
  insertTokenUsage(db, {
    sessionId: "sess-model-stats-1",
    messageId: "msg-opus-1",
    model: "claude-opus-4-6",
    inputTokens: 10000,
    outputTokens: 3000,
    cacheCreateTokens: 0,
    cacheReadTokens: 0,
    costUsd: 0.375, // (10000*15 + 3000*75) / 1M = 0.15 + 0.225 = 0.375
    timestamp: now,
  });

  insertTokenUsage(db, {
    sessionId: "sess-model-stats-1",
    messageId: "msg-opus-2",
    model: "claude-opus-4-6",
    inputTokens: 5000,
    outputTokens: 2000,
    cacheCreateTokens: 0,
    cacheReadTokens: 0,
    costUsd: 0.225, // (5000*15 + 2000*75) / 1M = 0.075 + 0.15 = 0.225
    timestamp: now,
  });

  // Sonnet token usage rows
  insertTokenUsage(db, {
    sessionId: "sess-model-stats-1",
    messageId: "msg-sonnet-1",
    model: "claude-sonnet-4-5-20250514",
    inputTokens: 8000,
    outputTokens: 4000,
    cacheCreateTokens: 0,
    cacheReadTokens: 0,
    costUsd: 0.084, // (8000*3 + 4000*15) / 1M = 0.024 + 0.06 = 0.084
    timestamp: now,
  });
}

describe("queryModelStats", () => {
  it("returns empty array when no data exists", () => {
    const result = queryModelStats(db, "today");
    expect(result).toEqual([]);
  });

  it("groups token usage by model", () => {
    seedTestData();
    const result = queryModelStats(db, "today");

    expect(result).toHaveLength(2);

    // Opus should be first (highest cost)
    const opus = result.find((r: any) => r.model === "claude-opus-4-6");
    expect(opus).toBeTruthy();
    expect(opus.totalInput).toBe(15000); // 10000 + 5000
    expect(opus.totalOutput).toBe(5000); // 3000 + 2000
    expect(opus.totalCost).toBeCloseTo(0.6, 4); // 0.375 + 0.225
    expect(opus.messageCount).toBe(2);

    const sonnet = result.find((r: any) => r.model === "claude-sonnet-4-5-20250514");
    expect(sonnet).toBeTruthy();
    expect(sonnet.totalInput).toBe(8000);
    expect(sonnet.totalOutput).toBe(4000);
    expect(sonnet.totalCost).toBeCloseTo(0.084, 4);
    expect(sonnet.messageCount).toBe(1);
  });

  it("calculates percentage of total cost", () => {
    seedTestData();
    const result = queryModelStats(db, "today");

    const opus = result.find((r: any) => r.model === "claude-opus-4-6");
    const sonnet = result.find((r: any) => r.model === "claude-sonnet-4-5-20250514");

    // Total cost = 0.6 + 0.084 = 0.684
    // Opus pct = 0.6 / 0.684 * 100 = ~87.7 -> 88
    // Sonnet pct = 0.084 / 0.684 * 100 = ~12.3 -> 12
    expect(opus.pct).toBe(88);
    expect(sonnet.pct).toBe(12);
  });

  it("calculates potential savings for opus if downgraded to sonnet", () => {
    seedTestData();
    const result = queryModelStats(db, "today");

    const opus = result.find((r: any) => r.model === "claude-opus-4-6");

    // Hypothetical sonnet cost for opus tokens:
    // (15000 * 3 / 1M) + (5000 * 15 / 1M) = 0.045 + 0.075 = 0.12
    expect(opus.hypotheticalSonnetCost).toBeCloseTo(0.12, 4);
    // Savings = 0.6 - 0.12 = 0.48
    expect(opus.potentialSavings).toBeCloseTo(0.48, 4);
  });

  it("shows zero savings for sonnet rows (already sonnet)", () => {
    seedTestData();
    const result = queryModelStats(db, "today");

    const sonnet = result.find((r: any) => r.model === "claude-sonnet-4-5-20250514");
    // Sonnet is already sonnet, so hypothetical cost equals actual cost
    expect(sonnet.hypotheticalSonnetCost).toBeCloseTo(sonnet.totalCost, 4);
    expect(sonnet.potentialSavings).toBe(0);
  });

  it("respects period filter", () => {
    seedTestData();

    // "all" should include everything
    const allResult = queryModelStats(db, "all");
    expect(allResult).toHaveLength(2);

    // "today" should include data seeded with today's timestamp
    const todayResult = queryModelStats(db, "today");
    expect(todayResult).toHaveLength(2);
  });

  it("filters out data outside the period", () => {
    const now = new Date().toISOString();
    const projectId = upsertProject(db, "/test/old", "old-project", "/test/old", now);

    // Insert a session with an old timestamp
    const oldDate = "2020-01-01T00:00:00Z";
    insertSession(db, {
      id: "sess-old",
      projectId,
      startedAt: oldDate,
      endedAt: oldDate,
      endReason: "user_exit",
      primaryModel: "claude-opus-4-6",
      claudeVersion: "1.0.0",
      gitBranch: "main",
      totalInputTokens: 1000,
      totalOutputTokens: 500,
      totalCacheCreateTokens: 0,
      totalCacheReadTokens: 0,
      totalCostUsd: 0.05,
      messageCount: 1,
      toolUseCount: 0,
      agentCount: 0,
    });

    insertTokenUsage(db, {
      sessionId: "sess-old",
      messageId: "msg-old-1",
      model: "claude-opus-4-6",
      inputTokens: 1000,
      outputTokens: 500,
      cacheCreateTokens: 0,
      cacheReadTokens: 0,
      costUsd: 0.05,
      timestamp: oldDate,
    });

    // "today" should not include old data
    const todayResult = queryModelStats(db, "today");
    expect(todayResult).toHaveLength(0);

    // "all" should include old data
    const allResult = queryModelStats(db, "all");
    expect(allResult).toHaveLength(1);
    expect(allResult[0].model).toBe("claude-opus-4-6");
  });
});
