import type Database from "better-sqlite3";

export type SessionCategory =
  | "generation" // Write + Edit heavy
  | "exploration" // Read + Grep + Glob heavy
  | "debugging" // Bash (test runs) + Edit combos
  | "review" // Read-heavy, no Write/Edit
  | "planning" // Agent(Plan) tool calls
  | "devops" // Bash-heavy (git, npm, docker)
  | "mixed"; // No dominant pattern

interface ToolProfile {
  [toolName: string]: number;
}

// Signal tools — tools that indicate what kind of work the session is doing.
// Framework/system tools (TaskUpdate, TaskCreate, Skill, ToolSearch, WebSearch,
// mcp__*, etc.) are noise that dilutes classification ratios.
const SIGNAL_TOOLS = new Set([
  "Read", "Write", "Edit", "NotebookEdit",
  "Bash",
  "Grep", "Glob",
  "Agent",
]);

export function categorizeSession(toolCalls: ToolProfile): SessionCategory {
  // Only count signal tools for classification — ignore framework noise
  const gen =
    (toolCalls["Write"] ?? 0) +
    (toolCalls["Edit"] ?? 0) +
    (toolCalls["NotebookEdit"] ?? 0);
  const read =
    (toolCalls["Read"] ?? 0) +
    (toolCalls["Grep"] ?? 0) +
    (toolCalls["Glob"] ?? 0);
  const bash = toolCalls["Bash"] ?? 0;
  const agent = toolCalls["Agent"] ?? 0;

  const total = gen + read + bash + agent;
  if (total === 0) return "mixed";

  const genRatio = gen / total;
  const readRatio = read / total;
  const bashRatio = bash / total;

  // Planning: sessions with predominantly Agent(Plan) tool calls
  if (agent / total > 0.5 && genRatio < 0.1) return "planning";

  // Generation: Write + Edit heavy (>40%)
  if (genRatio > 0.4) return "generation";

  // Debugging: Bash (test runs) + Edit combos
  if (bashRatio > 0.2 && gen > 0 && genRatio < 0.4) return "debugging";

  // DevOps: Bash-heavy (>50%) with no significant code editing
  if (bashRatio > 0.5 && genRatio < 0.1) return "devops";

  // Review: Read-heavy (>50%) with no Write/Edit
  if (readRatio > 0.5 && gen === 0) return "review";

  // Exploration: Read + Grep + Glob heavy (>60%)
  if (readRatio > 0.6) return "exploration";

  return "mixed";
}

/**
 * Get tool call profile for a session from the DB
 */
export function getSessionToolProfile(
  db: Database.Database,
  sessionId: string
): ToolProfile {
  const rows = db
    .prepare("SELECT tool_name, call_count FROM tool_calls WHERE session_id = ?")
    .all(sessionId) as { tool_name: string; call_count: number }[];

  const profile: ToolProfile = {};
  for (const row of rows) {
    profile[row.tool_name] = row.call_count;
  }
  return profile;
}

/**
 * Classify a single session and update the DB
 */
export function classifyAndUpdateSession(
  db: Database.Database,
  sessionId: string
): SessionCategory {
  const profile = getSessionToolProfile(db, sessionId);
  const category = categorizeSession(profile);
  db.prepare("UPDATE sessions SET category = ? WHERE id = ?").run(
    category,
    sessionId
  );
  return category;
}

/**
 * Retroactively classify all sessions that have tool_calls data
 */
export function classifyAllSessions(db: Database.Database): number {
  const sessions = db
    .prepare(
      "SELECT DISTINCT s.id FROM sessions s INNER JOIN tool_calls tc ON tc.session_id = s.id"
    )
    .all() as { id: string }[];

  let classified = 0;
  for (const session of sessions) {
    const profile = getSessionToolProfile(db, session.id);
    const category = categorizeSession(profile);
    db.prepare("UPDATE sessions SET category = ? WHERE id = ?").run(
      category,
      session.id
    );
    classified++;
  }
  return classified;
}
