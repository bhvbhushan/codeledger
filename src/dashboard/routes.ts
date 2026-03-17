import type { Hono } from "hono";
import type Database from "better-sqlite3";
import { generateRecommendations } from "../tools/cost-optimize.js";
import { querySkillUsage } from "../tools/skill-usage.js";
import { periodToStart } from "../utils/period.js";

export function registerApiRoutes(app: Hono, db: Database.Database): void {
  // Summary
  app.get("/api/summary", (c) => {
    const period = c.req.query("period") ?? "week";
    const start = periodToStart(period);

    const totals = db
      .prepare(
        `
      SELECT
        COALESCE(SUM(s.total_cost_usd), 0) as total_cost,
        COALESCE(SUM(s.total_input_tokens), 0) as total_input,
        COALESCE(SUM(s.total_output_tokens), 0) as total_output,
        COALESCE(SUM(s.total_cache_create_tokens), 0) as cache_create,
        COALESCE(SUM(s.total_cache_read_tokens), 0) as cache_read,
        COUNT(*) as session_count
      FROM sessions s
      WHERE s.started_at >= ?
    `,
      )
      .get(start) as Record<string, number>;

    const overhead = db
      .prepare(
        `
      SELECT COALESCE(SUM(a.total_cost_usd), 0) as overhead_cost
      FROM agents a
      WHERE a.started_at >= ? AND a.source_category = 'overhead'
    `,
      )
      .get(start) as Record<string, number>;

    return c.json({
      totalCost: totals.total_cost,
      totalInput: totals.total_input,
      totalOutput: totals.total_output,
      totalCacheCreate: totals.cache_create,
      totalCacheRead: totals.cache_read,
      sessionCount: totals.session_count,
      overheadCost: overhead.overhead_cost,
      userCost: totals.total_cost - overhead.overhead_cost,
    });
  });

  // Daily costs (for stacked bar chart)
  app.get("/api/daily-costs", (c) => {
    const period = c.req.query("period") ?? "week";
    const start = periodToStart(period);

    const rows = db
      .prepare(
        `
      SELECT
        DATE(s.started_at) as date,
        COALESCE(SUM(s.total_cost_usd), 0) as total_cost
      FROM sessions s
      WHERE s.started_at >= ?
      GROUP BY DATE(s.started_at)
      ORDER BY date
    `,
      )
      .all(start) as Array<{ date: string; total_cost: number }>;

    // Get overhead per day from agents
    const overheadRows = db
      .prepare(
        `
      SELECT
        DATE(a.started_at) as date,
        COALESCE(SUM(a.total_cost_usd), 0) as overhead_cost
      FROM agents a
      WHERE a.started_at >= ? AND a.source_category = 'overhead'
      GROUP BY DATE(a.started_at)
      ORDER BY date
    `,
      )
      .all(start) as Array<{ date: string; overhead_cost: number }>;

    const overheadByDate = new Map(
      overheadRows.map((r) => [r.date, r.overhead_cost]),
    );

    return c.json(
      rows.map((r) => ({
        date: r.date,
        totalCost: r.total_cost,
        overheadCost: overheadByDate.get(r.date) ?? 0,
        userCost: r.total_cost - (overheadByDate.get(r.date) ?? 0),
      })),
    );
  });

  // Models
  app.get("/api/models", (c) => {
    const period = c.req.query("period") ?? "week";
    const start = periodToStart(period);

    const rows = db
      .prepare(
        `
      SELECT
        model,
        SUM(input_tokens) as total_input,
        SUM(output_tokens) as total_output,
        SUM(cost_usd) as total_cost,
        COUNT(*) as message_count
      FROM token_usage
      WHERE timestamp >= ?
      GROUP BY model
      ORDER BY total_cost DESC
    `,
      )
      .all(start);

    return c.json(rows);
  });

  // Projects
  app.get("/api/projects", (c) => {
    const period = c.req.query("period") ?? "week";
    const start = periodToStart(period);

    const rows = db
      .prepare(
        `
      SELECT
        p.id,
        p.display_name as name,
        COALESCE(SUM(s.total_cost_usd), 0) as total_cost,
        COUNT(s.id) as session_count,
        MAX(s.started_at) as last_active
      FROM projects p
      LEFT JOIN sessions s ON s.project_id = p.id AND s.started_at >= ?
      GROUP BY p.id
      HAVING session_count > 0
      ORDER BY total_cost DESC
    `,
      )
      .all(start) as Array<
      Record<string, unknown> & {
        id: number;
        total_cost: number;
        overheadCost?: number;
        userCost?: number;
      }
    >;

    // Enrich each project with overhead cost and top category
    for (const row of rows) {
      const oh = db
        .prepare(
          `
        SELECT COALESCE(SUM(a.total_cost_usd), 0) as overhead_cost
        FROM agents a
        JOIN sessions s ON a.session_id = s.id
        WHERE s.project_id = ? AND a.started_at >= ? AND a.source_category = 'overhead'
      `,
        )
        .get(row.id, start) as Record<string, number>;
      row.overheadCost = oh.overhead_cost;
      row.userCost = row.total_cost - oh.overhead_cost;

      // Dominant session category for this project
      const cat = db
        .prepare(
          `
        SELECT category, COUNT(*) as cnt
        FROM sessions
        WHERE project_id = ? AND started_at >= ? AND category != 'mixed'
        GROUP BY category
        ORDER BY cnt DESC
        LIMIT 1
      `,
        )
        .get(row.id, start) as { category: string; cnt: number } | undefined;
      (row as any).topCategory = cat?.category ?? "mixed";
    }

    return c.json(rows);
  });

  // Project sessions drill-down
  app.get("/api/projects/:id/sessions", (c) => {
    const projectId = c.req.param("id");
    const period = c.req.query("period") ?? "week";
    const start = periodToStart(period);

    const rows = db
      .prepare(
        `
      SELECT
        s.id,
        s.started_at,
        s.ended_at,
        s.primary_model,
        s.total_cost_usd,
        s.message_count,
        s.agent_count,
        s.end_reason,
        s.category
      FROM sessions s
      WHERE s.project_id = ? AND s.started_at >= ?
      ORDER BY s.started_at DESC
    `,
      )
      .all(projectId, start);

    return c.json(rows);
  });

  // Agents
  app.get("/api/agents", (c) => {
    const period = c.req.query("period") ?? "week";
    const start = periodToStart(period);
    const sourceCategory = c.req.query("source_category") ?? "all";
    const projectId = c.req.query("project_id");

    let query = `
      SELECT
        a.id as agent_id,
        a.session_id,
        a.agent_type,
        a.model,
        a.total_input_tokens,
        a.total_output_tokens,
        a.total_cost_usd,
        a.started_at,
        a.ended_at,
        a.message_count,
        a.source_category,
        p.display_name as project
      FROM agents a
      JOIN sessions s ON a.session_id = s.id
      JOIN projects p ON s.project_id = p.id
      WHERE a.started_at >= ?
    `;
    const params: (string | number)[] = [start];

    if (sourceCategory !== "all") {
      query += " AND a.source_category = ?";
      params.push(sourceCategory);
    }
    if (projectId) {
      query += " AND s.project_id = ?";
      params.push(projectId);
    }

    query += " ORDER BY a.total_cost_usd DESC";

    const rows = db.prepare(query).all(...params);
    return c.json(rows);
  });

  // Skills
  app.get("/api/skills", (c) => {
    const period = c.req.query("period") ?? "week";
    const project = c.req.query("project") ?? undefined;
    const result = querySkillUsage(db, period, project);
    return c.json(result);
  });

  // Categories
  app.get("/api/categories", (c) => {
    const period = c.req.query("period") ?? "week";
    const start = periodToStart(period);

    const rows = db
      .prepare(
        `
      SELECT
        category,
        COUNT(*) as session_count,
        COALESCE(SUM(total_cost_usd), 0) as total_cost
      FROM sessions
      WHERE started_at >= ?
      GROUP BY category
      ORDER BY total_cost DESC
    `,
      )
      .all(start) as Array<{
      category: string;
      session_count: number;
      total_cost: number;
    }>;

    return c.json(rows);
  });

  // Optimize
  app.get("/api/optimize", (c) => {
    const period = c.req.query("period") ?? "month";
    const recs = generateRecommendations(db, period);
    return c.json(recs);
  });
}
