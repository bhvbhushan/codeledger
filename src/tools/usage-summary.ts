import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { z } from "zod";
import { periodToStart } from "../utils/period.js";
import { calendarPeriodStart, daysInPeriod } from "../utils/period.js";
import { lookupPricing } from "../db/pricing.js";
import { fmtTokens } from "../utils/format.js";

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
  velocityPerDay: number | null;
  projectedMonthly: number | null;
  costliestSession: { cost: number; project: string } | null;
}

export function queryUsageSummary(
  db: Database.Database,
  period: string,
  project?: string
): UsageSummary {
  const start = periodToStart(period);

  let sessionFilter = "WHERE s.started_at >= ? AND s.tool = 'claude-code'";
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

  let agentFilter = "WHERE a.started_at >= ? AND s.tool = 'claude-code'";
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
  const sessionCount = totals?.session_count ?? 0;
  const modelDistribution = models.map((m) => ({
    model: m.model ?? "unknown",
    cost: m.cost,
    pct: totalCost > 0 ? Math.round((m.cost / totalCost) * 100) : 0,
  }));

  // Spend velocity + monthly projection
  let velocityPerDay: number | null = null;
  let projectedMonthly: number | null = null;

  if (sessionCount > 0) {
    let earliestFilter = "WHERE s.started_at >= ? AND s.tool = 'claude-code'";
    const earliestParams: (string | number)[] = [start];
    if (project) {
      earliestFilter += " AND p.display_name = ?";
      earliestParams.push(project);
    }

    const earliestRow = db
      .prepare(
        `
      SELECT MIN(s.started_at) as earliest
      FROM sessions s
      LEFT JOIN projects p ON s.project_id = p.id
      ${earliestFilter}
    `
      )
      .get(...earliestParams) as { earliest: string | null } | undefined;

    if (earliestRow?.earliest) {
      // Calendar-based velocity: earliest session to now (conservative for budgeting)
      const daysElapsed =
        (Date.now() - new Date(earliestRow.earliest).getTime()) /
        (1000 * 60 * 60 * 24);

      if (daysElapsed >= 1) {
        velocityPerDay = totalCost / daysElapsed;
        projectedMonthly = velocityPerDay * 30;
      }
    }
  }

  // Costliest session
  let costliestFilter = "WHERE s.started_at >= ? AND s.tool = 'claude-code'";
  const costliestParams: (string | number)[] = [start];
  if (project) {
    costliestFilter += " AND p.display_name = ?";
    costliestParams.push(project);
  }

  const costliestRow = db
    .prepare(
      `
    SELECT s.total_cost_usd as cost, p.display_name as project
    FROM sessions s
    JOIN projects p ON s.project_id = p.id
    ${costliestFilter}
    ORDER BY s.total_cost_usd DESC LIMIT 1
  `
    )
    .get(...costliestParams) as
    | { cost: number; project: string }
    | undefined;

  const costliestSession = costliestRow
    ? { cost: costliestRow.cost, project: costliestRow.project }
    : null;

  return {
    totalCostUsd: totalCost,
    totalInputTokens: totals?.input_tok ?? 0,
    totalOutputTokens: totals?.output_tok ?? 0,
    totalCacheCreateTokens: totals?.cache_create_tok ?? 0,
    totalCacheReadTokens: totals?.cache_read_tok ?? 0,
    sessionCount,
    topProject: topProj?.display_name ?? null,
    modelDistribution,
    overheadCostUsd: overheadRow?.overhead_cost ?? 0,
    velocityPerDay,
    projectedMonthly,
    costliestSession,
  };
}

export function queryMonthlyBudgetLine(db: Database.Database): string | null {
  const budget = db
    .prepare(
      "SELECT limit_usd FROM budgets WHERE scope = 'total' AND period = 'monthly' LIMIT 1"
    )
    .get() as { limit_usd: number } | undefined;

  if (!budget) return null;

  const monthStart = calendarPeriodStart("monthly");
  const row = db
    .prepare(
      "SELECT COALESCE(SUM(total_cost_usd), 0) as cost FROM sessions WHERE started_at >= ? AND tool = 'claude-code'"
    )
    .get(monthStart) as { cost: number };

  const spent = row.cost;
  const pct = Math.round((spent / budget.limit_usd) * 100);
  const totalDays = daysInPeriod("monthly");
  const daysElapsed = Math.max(
    (Date.now() - new Date(monthStart).getTime()) / (1000 * 60 * 60 * 24),
    0.01
  );
  const projected = (spent / daysElapsed) * totalDays;

  const overshoot = projected > budget.limit_usd ? " overshoot" : "";
  return `**Monthly Budget:** $${spent.toFixed(0)}/$${budget.limit_usd.toFixed(0)} (${pct}%) — projected $${projected.toFixed(0)}${overshoot}`;
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
        .default("today")
        .describe("Time period to summarize"),
      project: z.string().optional().describe("Filter by project name"),
    },
    async ({ period, project }) => {
      const s = queryUsageSummary(db, period, project);



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

      if (s.velocityPerDay !== null) {
        lines.push(
          `**Spend Velocity:** $${s.velocityPerDay.toFixed(2)}/day | Projected monthly: $${s.projectedMonthly!.toFixed(2)}`
        );
      }

      const budgetLine = queryMonthlyBudgetLine(db);
      if (budgetLine) {
        lines.push(budgetLine);
      }

      if (s.costliestSession) {
        lines.push(
          `**Costliest session:** $${s.costliestSession.cost.toFixed(2)} (${s.costliestSession.project})`
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
