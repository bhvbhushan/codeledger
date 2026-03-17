import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { createConnection } from "../../src/db/connection.js";
import { runMigrations } from "../../src/db/migrate.js";
import { seedPricing, calculateCost, lookupPricing } from "../../src/db/pricing.js";

const TEST_DB = "/tmp/codeledger-pricing-test.db";
let db: any;

beforeEach(() => {
  db = createConnection(TEST_DB);
  runMigrations(db);
  seedPricing(db);
});

afterEach(() => {
  db.close();
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  if (existsSync(TEST_DB + "-wal")) unlinkSync(TEST_DB + "-wal");
  if (existsSync(TEST_DB + "-shm")) unlinkSync(TEST_DB + "-shm");
});

describe("pricing", () => {
  it("seeds default model pricing", () => {
    const rows = db.prepare("SELECT COUNT(*) as c FROM model_pricing").get() as any;
    expect(rows.c).toBeGreaterThanOrEqual(3); // opus, sonnet, haiku
  });

  it("looks up opus 4.6 pricing by model string", () => {
    const pricing = lookupPricing(db, "claude-opus-4-6");
    expect(pricing).toBeTruthy();
    expect(pricing!.input_per_mtok).toBe(5.0);
    expect(pricing!.output_per_mtok).toBe(25.0);
    expect(pricing!.cache_create_per_mtok).toBe(6.25);
    expect(pricing!.cache_read_per_mtok).toBe(0.5);
  });

  it("looks up legacy opus 4.0 pricing (different rate)", () => {
    const pricing = lookupPricing(db, "claude-opus-4-0-20250514");
    expect(pricing).toBeTruthy();
    expect(pricing!.input_per_mtok).toBe(15.0);
    expect(pricing!.output_per_mtok).toBe(75.0);
  });

  it("looks up sonnet pricing with version suffix", () => {
    const pricing = lookupPricing(db, "claude-sonnet-4-5-20250514");
    expect(pricing).toBeTruthy();
    expect(pricing!.input_per_mtok).toBe(3.0);
  });

  it("returns null for unknown model", () => {
    const pricing = lookupPricing(db, "gpt-4o-unknown");
    expect(pricing).toBeNull();
  });

  it("calculates cost correctly for opus 4.6", () => {
    const cost = calculateCost(db, "claude-opus-4-6", {
      input_tokens: 1000,
      output_tokens: 500,
      cache_create_tokens: 200,
      cache_read_tokens: 100,
    });
    // (1000 * 5 / 1M) + (500 * 25 / 1M) + (200 * 6.25 / 1M) + (100 * 0.5 / 1M)
    // = 0.005 + 0.0125 + 0.00125 + 0.00005 = 0.0188
    expect(cost).toBeCloseTo(0.0188, 4);
  });

  it("returns 0 cost for unknown model", () => {
    const cost = calculateCost(db, "unknown-model", {
      input_tokens: 1000,
      output_tokens: 500,
      cache_create_tokens: 0,
      cache_read_tokens: 0,
    });
    expect(cost).toBe(0);
  });
});
