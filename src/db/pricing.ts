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

const DEFAULT_PRICING: ModelPricing[] = [
  {
    model_pattern: "claude-opus-4",
    input_per_mtok: 15.0,
    output_per_mtok: 75.0,
    cache_create_per_mtok: 18.75,
    cache_read_per_mtok: 1.5,
  },
  {
    model_pattern: "claude-sonnet-4",
    input_per_mtok: 3.0,
    output_per_mtok: 15.0,
    cache_create_per_mtok: 3.75,
    cache_read_per_mtok: 0.3,
  },
  {
    model_pattern: "claude-haiku-4",
    input_per_mtok: 0.8,
    output_per_mtok: 4.0,
    cache_create_per_mtok: 1.0,
    cache_read_per_mtok: 0.08,
  },
];

export function seedPricing(db: Database.Database): void {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO model_pricing
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
