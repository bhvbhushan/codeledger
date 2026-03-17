import type Database from "better-sqlite3";

interface ModelPricing {
  model_pattern: string;
  input_per_mtok: number;
  output_per_mtok: number;
  cache_create_per_mtok: number | null;
  cache_read_per_mtok: number | null;
}

interface TokenCounts {
  input_tokens: number;
  output_tokens: number;
  cache_create_tokens: number;
  cache_read_tokens: number;
}

// Pricing as of March 2026 from platform.claude.com/docs/en/about-claude/pricing
// Cache write = 5-minute ephemeral (1.25x input), which is what Claude Code uses
// Cache read = 0.1x input price (all tiers)
// More specific patterns listed first — lookupPricing matches longest pattern first
const DEFAULT_PRICING: ModelPricing[] = [
  // Opus 4.5 / 4.6 — $5/$25 (new pricing since Opus 4.5)
  {
    model_pattern: "claude-opus-4-5",
    input_per_mtok: 5.0,
    output_per_mtok: 25.0,
    cache_create_per_mtok: 6.25,
    cache_read_per_mtok: 0.5,
  },
  {
    model_pattern: "claude-opus-4-6",
    input_per_mtok: 5.0,
    output_per_mtok: 25.0,
    cache_create_per_mtok: 6.25,
    cache_read_per_mtok: 0.5,
  },
  // Opus 4.0 / 4.1 — $15/$75 (legacy pricing)
  {
    model_pattern: "claude-opus-4",
    input_per_mtok: 15.0,
    output_per_mtok: 75.0,
    cache_create_per_mtok: 18.75,
    cache_read_per_mtok: 1.5,
  },
  // Sonnet 4.x — $3/$15 (all versions same pricing)
  {
    model_pattern: "claude-sonnet-4",
    input_per_mtok: 3.0,
    output_per_mtok: 15.0,
    cache_create_per_mtok: 3.75,
    cache_read_per_mtok: 0.3,
  },
  // Haiku 4.5 — $1/$5
  {
    model_pattern: "claude-haiku-4",
    input_per_mtok: 1.0,
    output_per_mtok: 5.0,
    cache_create_per_mtok: 1.25,
    cache_read_per_mtok: 0.1,
  },
];

export function seedPricing(db: Database.Database): void {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO model_pricing
    (model_pattern, input_per_mtok, output_per_mtok, cache_create_per_mtok, cache_read_per_mtok, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const now = new Date().toISOString();
  for (const p of DEFAULT_PRICING) {
    insert.run(
      p.model_pattern,
      p.input_per_mtok,
      p.output_per_mtok,
      p.cache_create_per_mtok,
      p.cache_read_per_mtok,
      now
    );
  }
}

export function lookupPricing(
  db: Database.Database,
  model: string
): ModelPricing | null {
  const rows = db
    .prepare("SELECT * FROM model_pricing ORDER BY length(model_pattern) DESC")
    .all() as ModelPricing[];

  for (const row of rows) {
    if (model.startsWith(row.model_pattern)) {
      return row;
    }
  }
  return null;
}

export function calculateCost(
  db: Database.Database,
  model: string,
  tokens: TokenCounts
): number {
  const pricing = lookupPricing(db, model);
  if (!pricing) return 0;

  return (
    (tokens.input_tokens * pricing.input_per_mtok) / 1_000_000 +
    (tokens.output_tokens * pricing.output_per_mtok) / 1_000_000 +
    (tokens.cache_create_tokens * (pricing.cache_create_per_mtok ?? 0)) /
      1_000_000 +
    (tokens.cache_read_tokens * (pricing.cache_read_per_mtok ?? 0)) /
      1_000_000
  );
}
