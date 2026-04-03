import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { z } from "zod";
import {
  calendarPeriodStart,
  calendarPeriodEnd,
  daysInPeriod,
} from "../utils/period.js";

interface Budget {
  id: number;
  scope: string;
  scope_id: string | null;
  period: string;
  limit_usd: number;
}

interface BudgetRow {
  scope: string;
  budget: number;
  spent: number;
  pct: number;
  projected: number;
  status: string;
}

export function queryBudgetStatus(
  db: Database.Database,
  period: string
): { rows: BudgetRow[]; periodStart: string; periodEnd: string } {
  const periodStart = calendarPeriodStart(period);
  const periodEnd = calendarPeriodEnd(period);
  const totalDays = daysInPeriod(period);
  const daysElapsed = Math.max(
    (Date.now() - new Date(periodStart).getTime()) / (1000 * 60 * 60 * 24),
    0.01
  );

  const budgets = db
    .prepare("SELECT id, scope, scope_id, period, limit_usd FROM budgets WHERE period = ?")
    .all(period) as Budget[];

  if (budgets.length === 0) {
    return { rows: [], periodStart, periodEnd };
  }

  const rows: BudgetRow[] = [];

  for (const b of budgets) {
    let spent: number;
    if (b.scope === "total") {
      const row = db
        .prepare(
          `SELECT COALESCE(SUM(total_cost_usd), 0) as cost
           FROM sessions WHERE started_at >= ? AND tool = 'claude-code'`
        )
        .get(periodStart) as { cost: number };
      spent = row.cost;
    } else {
      const row = db
        .prepare(
          `SELECT COALESCE(SUM(s.total_cost_usd), 0) as cost
           FROM sessions s
           JOIN projects p ON s.project_id = p.id
           WHERE s.started_at >= ? AND s.tool = 'claude-code' AND p.display_name = ?`
        )
        .get(periodStart, b.scope_id) as { cost: number };
      spent = row.cost;
    }

    const pct = b.limit_usd > 0 ? Math.round((spent / b.limit_usd) * 100) : 0;
    const velocity = spent / daysElapsed;
    const projected = velocity * totalDays;

    let status = "On track";
    if (pct >= 100) {
      status = "EXCEEDED";
    } else if (projected > b.limit_usd) {
      status = "Overshoot warning";
    } else if (pct >= 75) {
      status = "Caution";
    }

    const scopeLabel = b.scope === "total" ? "Total" : `Project: ${b.scope_id}`;
    rows.push({
      scope: scopeLabel,
      budget: b.limit_usd,
      spent,
      pct,
      projected,
      status,
    });
  }

  return { rows, periodStart, periodEnd };
}

export function registerBudgetStatus(
  server: McpServer,
  db: Database.Database
): void {
  server.tool(
    "budget_status",
    "View current budget utilization and projected spend",
    {
      period: z
        .enum(["daily", "weekly", "monthly"])
        .default("monthly")
        .describe("Budget period to check (daily, weekly, or monthly)"),
    },
    async ({ period }) => {
      const { rows, periodStart, periodEnd } = queryBudgetStatus(db, period);

      if (rows.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No budgets configured. Use `budget_set` to create one.",
            },
          ],
        };
      }

      const startDate = periodStart.split("T")[0];
      const endDate = periodEnd.split("T")[0];
      const lines = [
        `## Budget Status (${period}: ${startDate} to ${endDate})`,
        "",
        "| Scope | Budget | Spent | % | Projected | Status |",
        "|-------|--------|-------|---|-----------|--------|",
        ...rows.map(
          (r) =>
            `| ${r.scope} | $${r.budget.toFixed(2)} | $${r.spent.toFixed(2)} | ${r.pct}% | $${r.projected.toFixed(2)} | ${r.status} |`
        ),
      ];

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    }
  );
}
