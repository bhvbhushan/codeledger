import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { z } from "zod";
import { periodToStart } from "../utils/period.js";

interface SkillInvocation {
  session_id: string;
  skill_name: string;
  invoked_at: string;
}

interface SkillUsageRow {
  skill_name: string;
  invocation_count: number;
  est_input_tokens: number;
  est_output_tokens: number;
  est_cost_usd: number;
  is_estimated: boolean;
}

export function querySkillUsage(
  db: Database.Database,
  period: string,
  project?: string
): SkillUsageRow[] {
  const start = periodToStart(period);

  // Step 1: Get all skill invocations in the period, ordered by session + time
  let invocationQuery = `
    SELECT sk.session_id, sk.skill_name, sk.invoked_at
    FROM skills sk
    JOIN sessions s ON sk.session_id = s.id
    JOIN projects p ON s.project_id = p.id
    WHERE sk.invoked_at >= ?
  `;
  const params: (string | number)[] = [start];

  if (project) {
    invocationQuery += " AND p.display_name = ?";
    params.push(project);
  }

  invocationQuery += " ORDER BY sk.session_id, sk.invoked_at";

  const invocations = db
    .prepare(invocationQuery)
    .all(...params) as SkillInvocation[];

  if (invocations.length === 0) {
    return [];
  }

  // Step 2: Group invocations by session
  const bySession = new Map<string, SkillInvocation[]>();
  for (const inv of invocations) {
    const list = bySession.get(inv.session_id) ?? [];
    list.push(inv);
    bySession.set(inv.session_id, list);
  }

  // Step 3: For each session, compute token windows
  // A skill's token window = tokens between invoked_at and next invocation (or session end)
  const skillTotals = new Map<
    string,
    { count: number; input: number; output: number; cost: number }
  >();

  for (const [sessionId, sessionInvocations] of bySession) {
    // Get session end time
    const session = db
      .prepare("SELECT ended_at FROM sessions WHERE id = ?")
      .get(sessionId) as { ended_at: string | null } | undefined;

    for (let i = 0; i < sessionInvocations.length; i++) {
      const inv = sessionInvocations[i];
      const windowStart = inv.invoked_at;
      const windowEnd =
        i + 1 < sessionInvocations.length
          ? sessionInvocations[i + 1].invoked_at
          : session?.ended_at ?? "9999-12-31T23:59:59Z";

      // Sum token_usage rows in this window
      const usage = db
        .prepare(
          `
        SELECT
          COALESCE(SUM(input_tokens), 0) as input_tokens,
          COALESCE(SUM(output_tokens), 0) as output_tokens,
          COALESCE(SUM(cost_usd), 0) as cost_usd
        FROM token_usage
        WHERE session_id = ?
          AND timestamp >= ?
          AND timestamp < ?
      `
        )
        .get(sessionId, windowStart, windowEnd) as {
        input_tokens: number;
        output_tokens: number;
        cost_usd: number;
      };

      // Accumulate into skill totals
      const existing = skillTotals.get(inv.skill_name) ?? {
        count: 0,
        input: 0,
        output: 0,
        cost: 0,
      };
      existing.count += 1;
      existing.input += usage.input_tokens;
      existing.output += usage.output_tokens;
      existing.cost += usage.cost_usd;
      skillTotals.set(inv.skill_name, existing);
    }
  }

  // Step 4: Convert to result array, sorted by cost desc
  const result: SkillUsageRow[] = [];
  for (const [skillName, totals] of skillTotals) {
    result.push({
      skill_name: skillName,
      invocation_count: totals.count,
      est_input_tokens: totals.input,
      est_output_tokens: totals.output,
      est_cost_usd: totals.cost,
      is_estimated: true,
    });
  }

  result.sort((a, b) => b.est_cost_usd - a.est_cost_usd);
  return result;
}

export function registerSkillUsage(
  server: McpServer,
  db: Database.Database
): void {
  server.tool(
    "skill_usage",
    "Get estimated token usage per skill (marked as ~estimated)",
    {
      period: z
        .enum(["today", "week", "month", "all"])
        .default("week")
        .describe("Time period to report on"),
      project: z.string().optional().describe("Filter by project"),
    },
    async ({ period, project }) => {
      const skills = querySkillUsage(db, period, project);

      if (skills.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No skill usage data found for period: ${period}`,
            },
          ],
        };
      }

      const totalCost = skills.reduce((sum, s) => sum + s.est_cost_usd, 0);
      const totalInvocations = skills.reduce(
        (sum, s) => sum + s.invocation_count,
        0
      );

      const lines = [
        `## Skill Usage (${period}) ~estimated`,
        `**Total invocations:** ${totalInvocations} | **Total est. cost:** ~$${totalCost.toFixed(2)}`,
        "",
        "| Skill | Invocations | ~Est. Tokens (in/out) | ~Est. Cost |",
        "|-------|-------------|----------------------|------------|",
        ...skills.map((s) => {
          const tokens = `${Number(s.est_input_tokens).toLocaleString()}/${Number(s.est_output_tokens).toLocaleString()}`;
          return `| ${s.skill_name} | ${s.invocation_count} | ~${tokens} | ~$${s.est_cost_usd.toFixed(2)} |`;
        }),
        "",
        "*All skill token values are estimates based on JSONL sequence analysis.*",
      ];

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    }
  );
}
