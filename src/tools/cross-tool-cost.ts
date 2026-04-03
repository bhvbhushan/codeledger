import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { z } from "zod";
import { periodToStart } from "../utils/period.js";
import { fmtTokens } from "../utils/format.js";

interface ToolCostRow {
  tool: string;
  sessions: number;
  cost: number;
  input_tok: number;
  output_tok: number;
}

export function queryCrossToolCost(
  db: Database.Database,
  period: string,
  tool?: string,
): ToolCostRow[] {
  const start = periodToStart(period);

  let query = `
    SELECT
      tool,
      COUNT(*) as sessions,
      COALESCE(SUM(total_cost_usd), 0) as cost,
      COALESCE(SUM(total_input_tokens), 0) as input_tok,
      COALESCE(SUM(total_output_tokens), 0) as output_tok
    FROM sessions
    WHERE started_at >= ?
  `;
  const params: (string | number)[] = [start];

  if (tool) {
    query += " AND tool = ?";
    params.push(tool);
  }

  query += " GROUP BY tool ORDER BY cost DESC";

  return db.prepare(query).all(...params) as ToolCostRow[];
}

export function registerCrossToolCost(
  server: McpServer,
  db: Database.Database,
): void {
  server.tool(
    "cross_tool_cost",
    "Compare costs across coding tools (Claude Code, Codex CLI, Cline, Gemini CLI)",
    {
      period: z
        .enum(["today", "week", "month", "all"])
        .default("month")
        .describe("Time period to analyze"),
      tool: z
        .string()
        .optional()
        .describe("Filter by tool name (e.g. claude-code, codex-cli, cline, gemini-cli)"),
    },
    async ({ period, tool }) => {
      const rows = queryCrossToolCost(db, period, tool);

      if (rows.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No usage data found for period: ${period}${tool ? ` (tool: ${tool})` : ""}`,
            },
          ],
        };
      }

      const totalCost = rows.reduce((sum, r) => sum + r.cost, 0);
      const totalSessions = rows.reduce((sum, r) => sum + r.sessions, 0);
      const totalInput = rows.reduce((sum, r) => sum + r.input_tok, 0);
      const totalOutput = rows.reduce((sum, r) => sum + r.output_tok, 0);

      const lines = [
        `## Cross-Tool Cost Comparison (${period})`,
        "",
        "| Tool | Sessions | Cost | Input Tokens | Output Tokens |",
        "|------|----------|------|--------------|---------------|",
        ...rows.map(
          (r) =>
            `| ${r.tool} | ${r.sessions} | $${r.cost.toFixed(2)} | ${fmtTokens(r.input_tok)} | ${fmtTokens(r.output_tok)} |`,
        ),
        `| **Total** | **${totalSessions}** | **$${totalCost.toFixed(2)}** | **${fmtTokens(totalInput)}** | **${fmtTokens(totalOutput)}** |`,
      ];

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    },
  );
}
