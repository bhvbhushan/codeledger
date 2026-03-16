import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { z } from "zod";
import { lookupPricing } from "../db/pricing.js";
import { periodToStart } from "../utils/period.js";

interface Recommendation {
  what: string;
  evidence: string;
  recommendation: string;
  potential_savings: number;
}

export function generateRecommendations(
  db: Database.Database,
  period: string
): Recommendation[] {
  const start = periodToStart(period);
  const recommendations: Recommendation[] = [];
  const sonnetPricing = lookupPricing(db, "claude-sonnet-4-5");

  // Rule 1: Opus used for exploration sessions
  const explorationOpus = db
    .prepare(
      `
    SELECT COUNT(*) as count, SUM(s.total_cost_usd) as cost,
           SUM(s.total_input_tokens) as input_tok, SUM(s.total_output_tokens) as output_tok
    FROM sessions s
    WHERE s.started_at >= ? AND s.category = 'exploration' AND s.primary_model LIKE '%opus%'
  `
    )
    .get(start) as any;

  if (explorationOpus.count > 0 && sonnetPricing) {
    const hypothetical =
      (explorationOpus.input_tok * sonnetPricing.input_per_mtok) / 1_000_000 +
      (explorationOpus.output_tok * sonnetPricing.output_per_mtok) / 1_000_000;
    const savings = explorationOpus.cost - hypothetical;
    if (savings > 0.5) {
      recommendations.push({
        what: "Opus used for exploration-only sessions",
        evidence: `${explorationOpus.count} sessions spent $${explorationOpus.cost.toFixed(2)} using Opus just for Read/Grep/Glob`,
        recommendation:
          "Use Sonnet for code exploration — same quality for search tasks at 1/5 the price",
        potential_savings: savings,
      });
    }
  }

  // Rule 2: Opus used for review sessions
  const reviewOpus = db
    .prepare(
      `
    SELECT COUNT(*) as count, SUM(s.total_cost_usd) as cost,
           SUM(s.total_input_tokens) as input_tok, SUM(s.total_output_tokens) as output_tok
    FROM sessions s
    WHERE s.started_at >= ? AND s.category = 'review' AND s.primary_model LIKE '%opus%'
  `
    )
    .get(start) as any;

  if (reviewOpus.count > 0 && sonnetPricing) {
    const hypothetical =
      (reviewOpus.input_tok * sonnetPricing.input_per_mtok) / 1_000_000 +
      (reviewOpus.output_tok * sonnetPricing.output_per_mtok) / 1_000_000;
    const savings = reviewOpus.cost - hypothetical;
    if (savings > 0.5) {
      recommendations.push({
        what: "Opus used for code review sessions",
        evidence: `${reviewOpus.count} review sessions cost $${reviewOpus.cost.toFixed(2)} on Opus`,
        recommendation:
          "Use Sonnet for code reviews — reads and summarizes just as well",
        potential_savings: savings,
      });
    }
  }

  // Rule 3: High overhead ratio
  const totalAgentCost = db
    .prepare(
      `
    SELECT COALESCE(SUM(total_cost_usd), 0) as cost FROM agents WHERE started_at >= ?
  `
    )
    .get(start) as any;

  const overheadCost = db
    .prepare(
      `
    SELECT COALESCE(SUM(total_cost_usd), 0) as cost FROM agents WHERE started_at >= ? AND source_category = 'overhead'
  `
    )
    .get(start) as any;

  if (totalAgentCost.cost > 0 && overheadCost.cost / totalAgentCost.cost > 0.15) {
    const pct = Math.round((overheadCost.cost / totalAgentCost.cost) * 100);
    recommendations.push({
      what: "Background plugin overhead exceeds 15% of agent costs",
      evidence: `$${overheadCost.cost.toFixed(2)} spent on overhead agents (${pct}% of $${totalAgentCost.cost.toFixed(2)} total agent spend)`,
      recommendation:
        "Review active plugins — disable or configure plugins that run expensive background observers",
      potential_savings: overheadCost.cost * 0.5, // Assume 50% reducible
    });
  }

  // Rule 4: Opus for devops/simple bash sessions
  const devopsOpus = db
    .prepare(
      `
    SELECT COUNT(*) as count, SUM(s.total_cost_usd) as cost,
           SUM(s.total_input_tokens) as input_tok, SUM(s.total_output_tokens) as output_tok
    FROM sessions s
    WHERE s.started_at >= ? AND s.category = 'devops' AND s.primary_model LIKE '%opus%'
  `
    )
    .get(start) as any;

  if (devopsOpus.count > 0 && sonnetPricing) {
    const hypothetical =
      (devopsOpus.input_tok * sonnetPricing.input_per_mtok) / 1_000_000 +
      (devopsOpus.output_tok * sonnetPricing.output_per_mtok) / 1_000_000;
    const savings = devopsOpus.cost - hypothetical;
    if (savings > 0.5) {
      recommendations.push({
        what: "Opus used for DevOps/shell-heavy sessions",
        evidence: `${devopsOpus.count} sessions spent $${devopsOpus.cost.toFixed(2)} on Opus for mostly Bash commands`,
        recommendation:
          "Use Sonnet for DevOps tasks — shell commands don't need the most powerful model",
        potential_savings: savings,
      });
    }
  }

  // Sort by potential savings descending
  recommendations.sort((a, b) => b.potential_savings - a.potential_savings);
  return recommendations;
}

export function registerCostOptimize(
  server: McpServer,
  db: Database.Database
): void {
  server.tool(
    "cost_optimize",
    "Get specific, evidence-based recommendations to reduce costs",
    {
      period: z.enum(["week", "month", "all"]).default("month"),
    },
    async ({ period }) => {
      const recs = generateRecommendations(db, period);

      if (recs.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No optimization recommendations for this period. Your model usage looks efficient.`,
            },
          ],
        };
      }

      const totalSavings = recs.reduce((s, r) => s + r.potential_savings, 0);
      const lines = [
        `## Cost Optimization (${period})`,
        `**Potential savings: ~$${totalSavings.toFixed(2)}**`,
        "",
        ...recs.map((r, i) =>
          [
            `### ${i + 1}. ${r.what}`,
            `**Evidence:** ${r.evidence}`,
            `**Recommendation:** ${r.recommendation}`,
            `**Potential savings:** ~$${r.potential_savings.toFixed(2)}`,
            "",
          ].join("\n")
        ),
        "---",
        "*Recommendations are auto-generated from usage patterns. Savings are estimates.*",
      ];

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    }
  );
}
