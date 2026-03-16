import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { z } from "zod";
import { periodToStart } from "../utils/period.js";

export function queryProjectUsage(
  db: Database.Database,
  period: string,
  sortBy: string,
  limit: number
): any[] {
  const start = periodToStart(period);

  const orderCol =
    sortBy === "tokens"
      ? "total_tokens"
      : sortBy === "sessions"
        ? "session_count"
        : "total_cost";

  return db
    .prepare(
      `
    SELECT
      p.display_name as project,
      SUM(s.total_input_tokens + s.total_output_tokens) as total_tokens,
      SUM(s.total_cost_usd) as total_cost,
      COUNT(*) as session_count,
      MAX(s.started_at) as last_active
    FROM sessions s
    JOIN projects p ON s.project_id = p.id
    WHERE s.started_at >= ?
    GROUP BY p.id
    ORDER BY ${orderCol} DESC
    LIMIT ?
  `
    )
    .all(start, limit) as any[];
}

export function registerProjectUsage(
  server: McpServer,
  db: Database.Database
): void {
  server.tool(
    "project_usage",
    "Get token usage and costs broken down by project",
    {
      period: z
        .enum(["today", "week", "month", "all"])
        .default("week"),
      sort_by: z
        .enum(["cost", "tokens", "sessions"])
        .default("cost"),
      limit: z.number().default(10),
    },
    async ({ period, sort_by, limit }) => {
      const projects = queryProjectUsage(db, period, sort_by, limit);
      const lines = [
        `## Project Usage (${period}, top ${limit} by ${sort_by})`,
        "",
        "| Project | Cost | Tokens | Sessions | Last Active |",
        "|---------|------|--------|----------|-------------|",
        ...projects.map(
          (p: any) =>
            `| ${p.project} | $${p.total_cost.toFixed(2)} | ${Number(p.total_tokens).toLocaleString()} | ${p.session_count} | ${p.last_active?.split("T")[0] ?? "\u2014"} |`
        ),
      ];
      if (projects.length === 0) lines.push("No project data for this period.");
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );
}
