import type Database from "better-sqlite3";

export function upsertProject(
  db: Database.Database,
  path: string,
  displayName: string,
  cwd: string,
  timestamp: string
): number {
  db.prepare(`
    INSERT INTO projects (path, display_name, cwd, first_seen, last_active)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET last_active = excluded.last_active
  `).run(path, displayName, cwd, timestamp, timestamp);

  const row = db
    .prepare("SELECT id FROM projects WHERE path = ?")
    .get(path) as any;
  return row.id;
}

export function insertSession(
  db: Database.Database,
  session: {
    id: string;
    projectId: number;
    startedAt: string;
    endedAt: string | null;
    endReason: string | null;
    primaryModel: string | null;
    claudeVersion: string | null;
    gitBranch: string | null;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheCreateTokens: number;
    totalCacheReadTokens: number;
    totalCostUsd: number;
    messageCount: number;
    toolUseCount: number;
    agentCount: number;
  }
): void {
  db.prepare(`
    INSERT OR REPLACE INTO sessions
    (id, project_id, started_at, ended_at, end_reason, primary_model, claude_version,
     git_branch, total_input_tokens, total_output_tokens, total_cache_create_tokens,
     total_cache_read_tokens, total_cost_usd, message_count, tool_use_count, agent_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    session.id,
    session.projectId,
    session.startedAt,
    session.endedAt,
    session.endReason,
    session.primaryModel,
    session.claudeVersion,
    session.gitBranch,
    session.totalInputTokens,
    session.totalOutputTokens,
    session.totalCacheCreateTokens,
    session.totalCacheReadTokens,
    session.totalCostUsd,
    session.messageCount,
    session.toolUseCount,
    session.agentCount
  );
}

export function insertTokenUsage(
  db: Database.Database,
  usage: {
    sessionId: string;
    messageId: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheCreateTokens: number;
    cacheReadTokens: number;
    costUsd: number;
    timestamp: string;
  }
): void {
  db.prepare(`
    INSERT OR IGNORE INTO token_usage
    (session_id, message_id, model, input_tokens, output_tokens,
     cache_create_tokens, cache_read_tokens, cost_usd, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    usage.sessionId,
    usage.messageId,
    usage.model,
    usage.inputTokens,
    usage.outputTokens,
    usage.cacheCreateTokens,
    usage.cacheReadTokens,
    usage.costUsd,
    usage.timestamp
  );
}

export function upsertToolCall(
  db: Database.Database,
  sessionId: string,
  toolName: string,
  count: number
): void {
  db.prepare(`
    INSERT INTO tool_calls (session_id, tool_name, call_count)
    VALUES (?, ?, ?)
    ON CONFLICT(session_id, tool_name) DO UPDATE SET call_count = call_count + excluded.call_count
  `).run(sessionId, toolName, count);
}

export function upsertDailySummary(
  db: Database.Database,
  date: string,
  projectId: number,
  model: string,
  inputTokens: number,
  outputTokens: number,
  costUsd: number
): void {
  db.prepare(`
    INSERT INTO daily_summaries (date, project_id, model, total_input_tokens, total_output_tokens, total_cost_usd, session_count)
    VALUES (?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(date, project_id, model) DO UPDATE SET
      total_input_tokens = total_input_tokens + excluded.total_input_tokens,
      total_output_tokens = total_output_tokens + excluded.total_output_tokens,
      total_cost_usd = total_cost_usd + excluded.total_cost_usd,
      session_count = session_count + 1
  `).run(date, projectId, model, inputTokens, outputTokens, costUsd);
}

export function recalculateProjectTotals(
  db: Database.Database,
  projectId: number
): void {
  db.prepare(`
    UPDATE projects SET
      total_input_tokens = COALESCE((SELECT SUM(total_input_tokens) FROM sessions WHERE project_id = ?), 0),
      total_output_tokens = COALESCE((SELECT SUM(total_output_tokens) FROM sessions WHERE project_id = ?), 0),
      total_cache_create_tokens = COALESCE((SELECT SUM(total_cache_create_tokens) FROM sessions WHERE project_id = ?), 0),
      total_cache_read_tokens = COALESCE((SELECT SUM(total_cache_read_tokens) FROM sessions WHERE project_id = ?), 0),
      total_cost_usd = COALESCE((SELECT SUM(total_cost_usd) FROM sessions WHERE project_id = ?), 0)
    WHERE id = ?
  `).run(projectId, projectId, projectId, projectId, projectId, projectId);
}

export function insertSkillInvocation(
  db: Database.Database,
  skill: {
    sessionId: string;
    skillName: string;
    invokedAt: string;
  }
): void {
  db.prepare(`
    INSERT INTO skills (session_id, skill_name, invoked_at, is_estimated)
    VALUES (?, ?, ?, TRUE)
  `).run(skill.sessionId, skill.skillName, skill.invokedAt);
}
