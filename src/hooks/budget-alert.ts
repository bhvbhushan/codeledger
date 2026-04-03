import type Database from "better-sqlite3";
import { calendarPeriodStart } from "../utils/period.js";

interface Budget {
  scope: string;
  scope_id: string | null;
  period: string;
  limit_usd: number;
}

export function checkBudgetAlerts(db: Database.Database): void {
  const budgets = db
    .prepare("SELECT scope, scope_id, period, limit_usd FROM budgets")
    .all() as Budget[];

  for (const b of budgets) {
    const periodStart = calendarPeriodStart(b.period);
    let spent: number;

    if (b.scope === "total") {
      const row = db
        .prepare(
          "SELECT COALESCE(SUM(total_cost_usd), 0) as cost FROM sessions WHERE started_at >= ?"
        )
        .get(periodStart) as { cost: number };
      spent = row.cost;
    } else {
      const row = db
        .prepare(
          `SELECT COALESCE(SUM(s.total_cost_usd), 0) as cost
           FROM sessions s
           JOIN projects p ON s.project_id = p.id
           WHERE s.started_at >= ? AND p.display_name = ?`
        )
        .get(periodStart, b.scope_id) as { cost: number };
      spent = row.cost;
    }

    const pct = b.limit_usd > 0 ? Math.round((spent / b.limit_usd) * 100) : 0;
    if (pct >= 75) {
      process.stderr.write(
        `[codeledger] Budget alert: $${spent.toFixed(2)}/$${b.limit_usd.toFixed(2)} ${b.period} budget (${pct}%)\n`
      );
    }
  }
}
