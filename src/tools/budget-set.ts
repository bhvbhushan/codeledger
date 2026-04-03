import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { z } from "zod";
import { queryBudgetStatus } from "./budget-status.js";

export function setBudget(
  db: Database.Database,
  limit: number,
  scope: string,
  scopeId: string | undefined,
  period: string
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO budgets (scope, scope_id, period, limit_usd, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(scope, COALESCE(scope_id, ''), period) DO UPDATE SET
       limit_usd = excluded.limit_usd,
       updated_at = excluded.updated_at`
  ).run(scope, scopeId ?? null, period, limit, now, now);
}

export function registerBudgetSet(
  server: McpServer,
  db: Database.Database
): void {
  server.tool(
    "budget_set",
    "Set a spending budget for total usage or a specific project",
    {
      limit: z
        .number()
        .describe("Budget limit in USD (must be greater than 0)"),
      scope: z
        .enum(["total", "project"])
        .default("total")
        .describe("Budget scope: 'total' for all usage, 'project' for a specific project"),
      scope_id: z
        .string()
        .optional()
        .describe("Project display name (required when scope is 'project')"),
      period: z
        .enum(["daily", "weekly", "monthly"])
        .default("monthly")
        .describe("Budget period (daily, weekly, or monthly)"),
    },
    async ({ limit, scope, scope_id, period }) => {
      if (limit <= 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: Budget limit must be greater than 0.",
            },
          ],
          isError: true,
        };
      }

      if (scope === "project" && !scope_id) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: scope_id is required when scope is 'project'.",
            },
          ],
          isError: true,
        };
      }

      setBudget(db, limit, scope, scope_id, period);

      const { rows } = queryBudgetStatus(db, period);
      const scopeLabel = scope === "total" ? "Total" : `Project: ${scope_id}`;
      const lines = [
        `Budget set: ${scopeLabel} — $${limit.toFixed(2)}/${period}`,
      ];

      if (rows.length > 0) {
        lines.push(
          "",
          "**Current status:**",
          ...rows.map(
            (r) => `- ${r.scope}: $${r.spent.toFixed(2)}/$${r.budget.toFixed(2)} (${r.pct}%) — ${r.status}`
          )
        );
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    }
  );
}
