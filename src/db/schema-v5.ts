export const PHASE_E_BUDGET_SCHEMA = `
CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  scope_id TEXT,
  period TEXT NOT NULL,
  limit_usd REAL NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_budgets_scope ON budgets(scope, COALESCE(scope_id, ''), period);
`;
