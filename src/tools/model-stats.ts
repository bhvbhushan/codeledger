import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { z } from "zod";
import { lookupPricing } from "../db/pricing.js";

export interface ModelStatsRow {
  model: string;
  totalCost: number;
  totalInput: number;
  totalOutput: number;
  messageCount: number;
  pct: number;
  hypotheticalSonnetCost: number;
  potentialSavings: number;
}

export function queryModelStats(
  db: Database.Database,
  period: string
): ModelStatsRow[] {
  const now = new Date();
  let start: string;
  switch (period) {
    case "today":
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      break;
    case "week": {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      start = d.toISOString();
      break;
    }
    case "month": {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 1);
      start = d.toISOString();
      break;
    }
    default:
      start = "1970-01-01T00:00:00Z";
  }

  const rows = db
    .prepare(
      `
    SELECT
      model,
      SUM(input_tokens) as total_input,
      SUM(output_tokens) as total_output,
      SUM(cost_usd) as total_cost,
      COUNT(*) as message_count
    FROM token_usage
    WHERE timestamp >= ?
    GROUP BY model
    ORDER BY total_cost DESC
  `
    )
    .all(start) as Array<{
    model: string;
    total_input: number;
    total_output: number;
    total_cost: number;
    message_count: number;
  }>;

  const totalCost = rows.reduce((sum, r) => sum + r.total_cost, 0);

  const sonnetPricing = lookupPricing(db, "claude-sonnet-4-5");

  return rows.map((r) => {
    let hypotheticalCost = r.total_cost;
    if (
      sonnetPricing &&
      !r.model.includes("sonnet") &&
      !r.model.includes("haiku")
    ) {
      hypotheticalCost =
        (r.total_input * sonnetPricing.input_per_mtok) / 1_000_000 +
        (r.total_output * sonnetPricing.output_per_mtok) / 1_000_000;
    }
    return {
      model: r.model,
      totalCost: r.total_cost,
      totalInput: r.total_input,
      totalOutput: r.total_output,
      messageCount: r.message_count,
      pct: totalCost > 0 ? Math.round((r.total_cost / totalCost) * 100) : 0,
      hypotheticalSonnetCost: hypotheticalCost,
      potentialSavings: Math.max(0, r.total_cost - hypotheticalCost),
    };
  });
}

export function registerModelStats(
  server: McpServer,
  db: Database.Database
): void {
  server.tool(
    "model_stats",
    "Analyze which models are being used and potential cost savings",
    {
      period: z.enum(["today", "week", "month", "all"]).default("month"),
    },
    async ({ period }) => {
      const stats = queryModelStats(db, period);
      const totalSavings = stats.reduce((s, m) => s + m.potentialSavings, 0);

      const lines = [
        `## Model Usage (${period})`,
        "",
        "| Model | Cost | % | Messages | If Sonnet | Savings |",
        "|-------|------|---|----------|-----------|---------|",
        ...stats.map(
          (m) =>
            `| ${m.model} | $${m.totalCost.toFixed(2)} | ${m.pct}% | ${m.messageCount} | $${m.hypotheticalSonnetCost.toFixed(2)} | $${m.potentialSavings.toFixed(2)} |`
        ),
        "",
        totalSavings > 0
          ? `**Potential savings if non-Opus tasks used Sonnet: $${totalSavings.toFixed(2)}**`
          : "Model usage looks optimized.",
      ];
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );
}
