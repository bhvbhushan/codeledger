import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { z } from "zod";
import { periodToStart } from "../utils/period.js";

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}

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
      SUM(s.total_input_tokens) as input_tokens,
      SUM(s.total_output_tokens) as output_tokens,
      SUM(s.total_cache_create_tokens) as cache_create_tokens,
      SUM(s.total_cache_read_tokens) as cache_read_tokens,
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
        "| Project | Cost | Input | Output | Cache Write | Cache Read | Sessions |",
        "|---------|------|-------|--------|-------------|------------|----------|",
        ...projects.map(
          (p: any) =>
            `| ${p.project} | $${p.total_cost.toFixed(2)} | ${fmtTokens(Number(p.input_tokens))} | ${fmtTokens(Number(p.output_tokens))} | ${fmtTokens(Number(p.cache_create_tokens))} | ${fmtTokens(Number(p.cache_read_tokens))} | ${p.session_count} |`
        ),
      ];
      if (projects.length === 0) lines.push("No project data for this period.");
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );
}
