import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { z } from "zod";

function periodToDateRange(period: string): { start: string; end: string } {
  const now = new Date();
  const end = now.toISOString();
  let start: string;

  switch (period) {
    case "today":
      // Use local midnight (not UTC midnight) so "today" matches the user's timezone
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
  return { start, end };
}

interface UsageSummary {
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  sessionCount: number;
  topProject: string | null;
  modelDistribution: { model: string; cost: number; pct: number }[];
}

export function queryUsageSummary(
  db: Database.Database,
  period: string,
  project?: string
): UsageSummary {
  const { start } = periodToDateRange(period);

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
    sessionCount: totals?.session_count ?? 0,
    topProject: topProj?.display_name ?? null,
    modelDistribution,
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

      const lines = [
        `## Usage Summary (${period})`,
        `**Total Cost:** $${s.totalCostUsd.toFixed(2)}`,
        `**Sessions:** ${s.sessionCount}`,
        `**Tokens:** ${s.totalInputTokens.toLocaleString()} input, ${s.totalOutputTokens.toLocaleString()} output`,
        s.topProject ? `**Top Project:** ${s.topProject}` : "",
        "",
        "**Model Distribution:**",
        ...s.modelDistribution.map(
          (m) => `- ${m.model}: $${m.cost.toFixed(2)} (${m.pct}%)`
        ),
      ];

      return {
        content: [{ type: "text" as const, text: lines.filter(Boolean).join("\n") }],
      };
    }
  );
}
