import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { z } from "zod";
import { periodToStart } from "../utils/period.js";

interface AgentUsageRow {
  agent_id: string;
  session_id: string;
  agent_type: string | null;
  description: string | null;
  model: string | null;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_create_tokens: number;
  total_cache_read_tokens: number;
  total_cost_usd: number;
  started_at: string | null;
  ended_at: string | null;
  message_count: number;
  source_category: string;
  project: string;
}

export function queryAgentUsage(
  db: Database.Database,
  period: string,
  filters?: { sessionId?: string; project?: string; sourceCategory?: string }
): AgentUsageRow[] {
  const start = periodToStart(period);

  let whereClause = "WHERE a.started_at >= ?";
  const params: (string | number)[] = [start];

  if (filters?.sessionId) {
    whereClause += " AND a.session_id = ?";
    params.push(filters.sessionId);
  }

  if (filters?.project) {
    whereClause += " AND p.display_name = ?";
    params.push(filters.project);
  }

  if (filters?.sourceCategory) {
    whereClause += " AND a.source_category = ?";
    params.push(filters.sourceCategory);
  }

  return db
    .prepare(
      `
    SELECT
      a.id as agent_id,
      a.session_id,
      a.agent_type,
      a.description,
      a.model,
      a.total_input_tokens,
      a.total_output_tokens,
      a.total_cache_create_tokens,
      a.total_cache_read_tokens,
      a.total_cost_usd,
      a.started_at,
      a.ended_at,
      a.message_count,
      a.source_category,
      p.display_name as project
    FROM agents a
    JOIN sessions s ON a.session_id = s.id
    JOIN projects p ON s.project_id = p.id
    ${whereClause}
    ORDER BY a.total_cost_usd DESC
  `
    )
    .all(...params) as AgentUsageRow[];
}

export function registerAgentUsage(
  server: McpServer,
  db: Database.Database
): void {
  server.tool(
    "agent_usage",
    "Get token usage broken down by subagent",
    {
      session_id: z.string().optional().describe("Filter by session"),
      project: z.string().optional().describe("Filter by project"),
      period: z
        .enum(["today", "week", "month", "all"])
        .default("week")
        .describe("Time period to report on"),
      source_category: z
        .enum(["user", "overhead", "all"])
        .default("all")
        .describe("Filter: 'user' for coding work, 'overhead' for background agents"),
    },
    async ({ session_id, project, period, source_category }) => {
      const agents = queryAgentUsage(db, period, {
        sessionId: session_id,
        project,
        sourceCategory: source_category === "all" ? undefined : source_category,
      });

      if (agents.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No agent usage data found for period: ${period}`,
            },
          ],
        };
      }

      const totalCost = agents.reduce((sum, a) => sum + a.total_cost_usd, 0);
      const userCost = agents.filter(a => a.source_category === "user").reduce((s, a) => s + a.total_cost_usd, 0);
      const overheadCost = agents.filter(a => a.source_category === "overhead").reduce((s, a) => s + a.total_cost_usd, 0);

      const lines = [
        `## Agent Usage (${period})`,
        `**Total agents:** ${agents.length} | **Total cost:** $${totalCost.toFixed(2)}`,
        `**Your coding agents:** $${userCost.toFixed(2)} | **Background overhead:** $${overheadCost.toFixed(2)}`,
        "",
        "| Agent | Type | Model | Tokens (in/out) | Cost | Messages | Session | Project |",
        "|-------|------|-------|-----------------|------|----------|---------|---------|",
        ...agents.map((a) => {
          const tokens = `${Number(a.total_input_tokens).toLocaleString()}/${Number(a.total_output_tokens).toLocaleString()}`;
          return `| ${a.agent_id} | ${a.agent_type ?? "\u2014"} | ${a.model ?? "\u2014"} | ${tokens} | $${a.total_cost_usd.toFixed(2)} | ${a.message_count} | ${a.session_id.slice(0, 8)}... | ${a.project} |`;
        }),
      ];

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    }
  );
}
