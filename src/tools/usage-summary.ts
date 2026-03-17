import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { z } from "zod";
import { periodToStart } from "../utils/period.js";
import { lookupPricing } from "../db/pricing.js";

interface UsageSummary {
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreateTokens: number;
  totalCacheReadTokens: number;
  sessionCount: number;
  topProject: string | null;
  modelDistribution: { model: string; cost: number; pct: number }[];
  overheadCostUsd: number;
}

export function queryUsageSummary(
  db: Database.Database,
  period: string,
  project?: string
): UsageSummary {
  const start = periodToStart(period);

  let sessionFilter = "WHERE s.started_at >= ?";
  const params: (string | number)[] = [start];

  if (project) {
    sessionFilter += " AND p.display_name = ?";
    params.push(project);
  }

  const totals = db
    .prepare(
      `
    SELECT
      COALESCE(SUM(s.total_cost_usd), 0) as cost,
      COALESCE(SUM(s.total_input_tokens), 0) as input_tok,
      COALESCE(SUM(s.total_output_tokens), 0) as output_tok,
      COALESCE(SUM(s.total_cache_create_tokens), 0) as cache_create_tok,
      COALESCE(SUM(s.total_cache_read_tokens), 0) as cache_read_tok,
      COUNT(*) as session_count
    FROM sessions s
    LEFT JOIN projects p ON s.project_id = p.id
    ${sessionFilter}
  `
    )
    .get(...params) as {
    cost: number;
    input_tok: number;
    output_tok: number;
    cache_create_tok: number;
    cache_read_tok: number;
    session_count: number;
  } | undefined;

  const topProj = db
    .prepare(
      `
    SELECT p.display_name, SUM(s.total_cost_usd) as cost
    FROM sessions s
    JOIN projects p ON s.project_id = p.id
    ${sessionFilter}
    GROUP BY p.id ORDER BY cost DESC LIMIT 1
  `
    )
    .get(...params) as { display_name: string; cost: number } | undefined;

  const models = db
    .prepare(
      `
    SELECT s.primary_model as model, SUM(s.total_cost_usd) as cost
    FROM sessions s
    LEFT JOIN projects p ON s.project_id = p.id
    ${sessionFilter}
    GROUP BY s.primary_model ORDER BY cost DESC
  `
    )
    .all(...params) as { model: string | null; cost: number }[];

  let agentFilter = "WHERE a.started_at >= ?";
  const agentParams: (string | number)[] = [start];
  if (project) {
    agentFilter += " AND p.display_name = ?";
    agentParams.push(project);
  }

  const overheadRow = db
    .prepare(
      `
    SELECT COALESCE(SUM(a.total_cost_usd), 0) as overhead_cost
    FROM agents a
    JOIN sessions s ON a.session_id = s.id
    LEFT JOIN projects p ON s.project_id = p.id
    ${agentFilter}
    AND a.source_category = 'overhead'
  `
    )
    .get(...agentParams) as { overhead_cost: number } | undefined;

  const totalCost = totals?.cost ?? 0;
  const modelDistribution = models.map((m) => ({
    model: m.model ?? "unknown",
    cost: m.cost,
    pct: totalCost > 0 ? Math.round((m.cost / totalCost) * 100) : 0,
  }));

  return {
    totalCostUsd: totalCost,
    totalInputTokens: totals?.input_tok ?? 0,
    totalOutputTokens: totals?.output_tok ?? 0,
    totalCacheCreateTokens: totals?.cache_create_tok ?? 0,
    totalCacheReadTokens: totals?.cache_read_tok ?? 0,
    sessionCount: totals?.session_count ?? 0,
    topProject: topProj?.display_name ?? null,
    modelDistribution,
    overheadCostUsd: overheadRow?.overhead_cost ?? 0,
  };
}

export function registerUsageSummary(
  server: McpServer,
  db: Database.Database
): void {
  server.tool(
    "usage_summary",
    "Get a smart summary of Claude Code usage and costs",
    {
      period: z
        .enum(["today", "week", "month", "all"])
        .default("today"),
      project: z.string().optional().describe("Filter by project name"),
    },
    async ({ period, project }) => {
      const s = queryUsageSummary(db, period, project);

      const fmtTokens = (n: number): string => {
        if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
        if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
        return n.toString();
      };

      const lines = [
        `## Usage Summary (${period})`,
        `**Total Cost:** $${s.totalCostUsd.toFixed(2)} | **Sessions:** ${s.sessionCount}`,
        s.topProject ? `**Top Project:** ${s.topProject}` : "",
        s.overheadCostUsd > 0 ? `**Background overhead:** $${s.overheadCostUsd.toFixed(2)} (plugin observers, system agents)` : "",
      ];

      // Cost breakdown by token type
      const dominantModel = s.modelDistribution[0]?.model ?? "claude-opus-4-6";
      const pricing = lookupPricing(db, dominantModel);
      if (pricing) {
        const inputCost = s.totalInputTokens * pricing.input_per_mtok / 1_000_000;
        const outputCost = s.totalOutputTokens * pricing.output_per_mtok / 1_000_000;
        const cacheCreateCost = s.totalCacheCreateTokens * (pricing.cache_create_per_mtok ?? 0) / 1_000_000;
        const cacheReadCost = s.totalCacheReadTokens * (pricing.cache_read_per_mtok ?? 0) / 1_000_000;

        const breakdown = [
          { label: "Cache read", tokens: s.totalCacheReadTokens, cost: cacheReadCost },
          { label: "Cache write", tokens: s.totalCacheCreateTokens, cost: cacheCreateCost },
          { label: "Output", tokens: s.totalOutputTokens, cost: outputCost },
          { label: "Input", tokens: s.totalInputTokens, cost: inputCost },
        ]
          .sort((a, b) => b.cost - a.cost)
          .filter((b) => b.tokens > 0);

        const computedTotal = breakdown.reduce((sum, b) => sum + b.cost, 0) || 1;

        lines.push("", "**Cost Breakdown:**");
        for (const b of breakdown) {
          const pct = Math.round((b.cost / computedTotal) * 100);
          const pctStr = pct < 1 ? "<1" : String(pct);
          lines.push(`- ${b.label}: ${fmtTokens(b.tokens)} tokens — ~$${b.cost.toFixed(2)} (${pctStr}%)`);
        }
      } else {
        lines.push(
          "",
          `**Tokens:** ${fmtTokens(s.totalInputTokens)} input, ${fmtTokens(s.totalOutputTokens)} output, ${fmtTokens(s.totalCacheCreateTokens)} cache write, ${fmtTokens(s.totalCacheReadTokens)} cache read`
        );
      }

      lines.push(
        "",
        "**Model Distribution:**",
        ...s.modelDistribution.map(
          (m) => `- ${m.model}: $${m.cost.toFixed(2)} (${m.pct}%)`
        )
      );

      return {
        content: [{ type: "text" as const, text: lines.filter(Boolean).join("\n") }],
      };
    }
  );
}
