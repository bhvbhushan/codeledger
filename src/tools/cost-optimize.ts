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
           SUM(s.total_input_tokens) as input_tok, SUM(s.total_output_tokens) as output_tok,
           SUM(s.total_cache_create_tokens) as cache_create_tok, SUM(s.total_cache_read_tokens) as cache_read_tok
    FROM sessions s
    WHERE s.started_at >= ? AND s.category = 'exploration' AND s.primary_model LIKE '%opus%'
  `
    )
    .get(start) as any;

  if (explorationOpus.count > 0 && sonnetPricing) {
    const hypothetical =
      (explorationOpus.input_tok * sonnetPricing.input_per_mtok) / 1_000_000 +
      (explorationOpus.output_tok * sonnetPricing.output_per_mtok) / 1_000_000 +
      ((explorationOpus.cache_create_tok ?? 0) * (sonnetPricing.cache_create_per_mtok ?? 0)) / 1_000_000 +
      ((explorationOpus.cache_read_tok ?? 0) * (sonnetPricing.cache_read_per_mtok ?? 0)) / 1_000_000;
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
           SUM(s.total_input_tokens) as input_tok, SUM(s.total_output_tokens) as output_tok,
           SUM(s.total_cache_create_tokens) as cache_create_tok, SUM(s.total_cache_read_tokens) as cache_read_tok
    FROM sessions s
    WHERE s.started_at >= ? AND s.category = 'review' AND s.primary_model LIKE '%opus%'
  `
    )
    .get(start) as any;

  if (reviewOpus.count > 0 && sonnetPricing) {
    const hypothetical =
      (reviewOpus.input_tok * sonnetPricing.input_per_mtok) / 1_000_000 +
      (reviewOpus.output_tok * sonnetPricing.output_per_mtok) / 1_000_000 +
      ((reviewOpus.cache_create_tok ?? 0) * (sonnetPricing.cache_create_per_mtok ?? 0)) / 1_000_000 +
      ((reviewOpus.cache_read_tok ?? 0) * (sonnetPricing.cache_read_per_mtok ?? 0)) / 1_000_000;
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
           SUM(s.total_input_tokens) as input_tok, SUM(s.total_output_tokens) as output_tok,
           SUM(s.total_cache_create_tokens) as cache_create_tok, SUM(s.total_cache_read_tokens) as cache_read_tok
    FROM sessions s
    WHERE s.started_at >= ? AND s.category = 'devops' AND s.primary_model LIKE '%opus%'
  `
    )
    .get(start) as any;

  if (devopsOpus.count > 0 && sonnetPricing) {
    const hypothetical =
      (devopsOpus.input_tok * sonnetPricing.input_per_mtok) / 1_000_000 +
      (devopsOpus.output_tok * sonnetPricing.output_per_mtok) / 1_000_000 +
      ((devopsOpus.cache_create_tok ?? 0) * (sonnetPricing.cache_create_per_mtok ?? 0)) / 1_000_000 +
      ((devopsOpus.cache_read_tok ?? 0) * (sonnetPricing.cache_read_per_mtok ?? 0)) / 1_000_000;
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

  // Rule 5: Cache efficiency drop
  // Note: intentionally a no-op for period="all" since baseline and current are identical
  const sessionCountInPeriod = db
    .prepare(
      `
    SELECT COUNT(*) as count FROM sessions WHERE started_at >= ?
  `
    )
    .get(start) as { count: number };

  if (sessionCountInPeriod.count >= 5) {
    // Current period cache ratio
    const currentCache = db
      .prepare(
        `
      SELECT
        COALESCE(SUM(total_cache_read_tokens), 0) as cache_read,
        COALESCE(SUM(total_input_tokens), 0) as input_tokens
      FROM sessions WHERE started_at >= ?
    `
      )
      .get(start) as { cache_read: number; input_tokens: number };

    const currentTotal = currentCache.cache_read + currentCache.input_tokens;
    const currentRatio = currentTotal > 0 ? currentCache.cache_read / currentTotal : 0;

    // All-time baseline cache ratio
    const baselineCache = db
      .prepare(
        `
      SELECT
        COALESCE(SUM(total_cache_read_tokens), 0) as cache_read,
        COALESCE(SUM(total_input_tokens), 0) as input_tokens
      FROM sessions
    `
      )
      .get() as { cache_read: number; input_tokens: number };

    const baselineTotal = baselineCache.cache_read + baselineCache.input_tokens;
    const baselineRatio = baselineTotal > 0 ? baselineCache.cache_read / baselineTotal : 0;

    // Flag if current ratio dropped >50% from baseline AND baseline was meaningful (>20%)
    if (baselineRatio > 0.2 && currentRatio < baselineRatio * 0.5) {
      const baselinePct = Math.round(baselineRatio * 100);
      const currentPct = Math.round(currentRatio * 100);
      // Estimate cost increase: without cache, input tokens cost full price instead of cache_read price
      const pricingForEstimate = lookupPricing(db, "claude-opus-4-6");
      let estimatedIncrease = 0;
      if (pricingForEstimate) {
        const cacheReadPrice = pricingForEstimate.cache_read_per_mtok ?? 0;
        const inputPrice = pricingForEstimate.input_per_mtok;
        // If cache ratio were at baseline, more tokens would be cache_read (cheaper)
        const expectedCacheTokens = currentTotal * baselineRatio;
        const actualCacheTokens = currentCache.cache_read;
        const missedCacheTokens = expectedCacheTokens - actualCacheTokens;
        estimatedIncrease = (missedCacheTokens * (inputPrice - cacheReadPrice)) / 1_000_000;
      }

      if (estimatedIncrease > 0.5) {
        recommendations.push({
          what: "Prompt cache efficiency dropped significantly",
          evidence: `Cache hit ratio dropped from ${baselinePct}% (baseline) to ${currentPct}% this ${period}. ${sessionCountInPeriod.count} sessions analyzed.`,
          recommendation:
            "Investigate prompt cache settings. Cache breaks can increase costs 5-10x. Check if system prompts or tool definitions changed recently.",
          potential_savings: estimatedIncrease,
        });
      }
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
      period: z.enum(["today", "week", "month", "all"]).default("month").describe("Time period to analyze for optimization opportunities"),
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
