import { initHookDb } from "./init-db.js";
import { readJsonlLines } from "../parser/jsonl-reader.js";
import {
  extractAssistantData,
  deduplicateMessages,
} from "../parser/message-extractor.js";
import { calculateCost } from "../db/pricing.js";
import { upsertProject, insertTokenUsage } from "../db/queries.js";
import { dirname, basename } from "path";
import { statSync } from "fs";
import type Database from "better-sqlite3";

/**
 * Lightweight real-time session tracking.
 *
 * Called on every Claude response (Stop event) DURING the session.
 * Only writes to dedup-safe tables:
 *   - token_usage: INSERT OR IGNORE (UNIQUE constraint handles dedup)
 *   - sessions: INSERT ON CONFLICT UPDATE (preserves end_reason + category)
 *   - projects: ON CONFLICT upsert (idempotent)
 *
 * Does NOT touch accumulation-based tables (daily_summaries, tool_calls)
 * or run classification — SessionEnd handles those at session completion.
 */

interface StopPayload {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode: string;
  hook_event_name: string;
  stop_hook_active?: boolean;
  last_assistant_message?: string;
  agent_id?: string;
  agent_type?: string;
}

export async function handleStop(
  payload: StopPayload,
  dbPath?: string,
): Promise<void> {
  // Skip if this is a subagent Stop — SubagentStop hook handles those
  if (payload.agent_id) return;

  const db = initHookDb(dbPath);

  try {
    // Check if file has changed since last parse — skip if unchanged
    const fileStat = statSync(payload.transcript_path, { throwIfNoEntry: false });
    if (!fileStat) return;

    const syncRow = db
      .prepare("SELECT file_size FROM sync_state WHERE file_path = ?")
      .get(payload.transcript_path) as { file_size: number } | undefined;

    if (syncRow && syncRow.file_size === fileStat.size) {
      return; // File unchanged since last parse — nothing new to process
    }

    const lines = await readJsonlLines(payload.transcript_path);

    // Extract session metadata from first user line
    const firstUser = lines.find((l) => l.type === "user") as any;
    const sessionId = firstUser?.sessionId ?? basename(payload.transcript_path, ".jsonl");
    const claudeVersion = firstUser?.version ?? null;
    const gitBranch = firstUser?.gitBranch ?? null;
    const actualCwd = firstUser?.cwd ?? payload.cwd;

    const firstLineTimestamp = (lines[0] as any)?.timestamp ?? null;

    // Extract and deduplicate assistant messages
    const rawAssistant = lines
      .filter((l) => l.type === "assistant")
      .map(extractAssistantData)
      .filter((d): d is NonNullable<typeof d> => d !== null);

    const messages = deduplicateMessages(rawAssistant);

    if (messages.length === 0) return;

    // Derive project path and display name
    const dir = dirname(payload.transcript_path);
    const projectPath = basename(dir);
    const displayName = actualCwd.split("/").filter(Boolean).pop() ?? projectPath;

    db.transaction(() => {
      const projectId = upsertProject(
        db,
        projectPath,
        displayName,
        actualCwd,
        messages[0]?.timestamp ?? firstLineTimestamp ?? new Date().toISOString(),
      );

      // Compute aggregates
      const modelTokens = new Map<string, number>();
      let totalInput = 0;
      let totalOutput = 0;
      let totalCacheCreate = 0;
      let totalCacheRead = 0;
      let totalCost = 0;
      let toolUseCount = 0;
      const messageCosts: number[] = [];

      for (const msg of messages) {
        const cost = calculateCost(db, msg.model, {
          input_tokens: msg.inputTokens,
          output_tokens: msg.outputTokens,
          cache_create_tokens: msg.cacheCreateTokens,
          cache_read_tokens: msg.cacheReadTokens,
        });
        messageCosts.push(cost);
        totalInput += msg.inputTokens;
        totalOutput += msg.outputTokens;
        totalCacheCreate += msg.cacheCreateTokens;
        totalCacheRead += msg.cacheReadTokens;
        totalCost += cost;

        const mt = modelTokens.get(msg.model) ?? 0;
        modelTokens.set(msg.model, mt + msg.outputTokens);

        toolUseCount += msg.toolUses.length;
      }

      // Primary model
      let primaryModel: string | null = null;
      let maxOutput = 0;
      for (const [model, output] of modelTokens) {
        if (output > maxOutput) {
          maxOutput = output;
          primaryModel = model;
        }
      }

      const agentCount = messages.reduce(
        (sum, m) => sum + m.toolUses.filter((t) => t.name === "Agent").length,
        0,
      );

      const startedAt = messages[0]?.timestamp ?? firstLineTimestamp ?? new Date().toISOString();
      const endedAt = messages[messages.length - 1]?.timestamp ?? null;

      // Upsert session — INSERT ON CONFLICT preserves end_reason and category
      // (SessionEnd sets these; we must not overwrite them)
      upsertSessionLive(db, {
        id: sessionId,
        projectId,
        startedAt,
        endedAt,
        primaryModel,
        claudeVersion,
        gitBranch,
        totalInputTokens: totalInput,
        totalOutputTokens: totalOutput,
        totalCacheCreateTokens: totalCacheCreate,
        totalCacheReadTokens: totalCacheRead,
        totalCostUsd: totalCost,
        messageCount: messages.length,
        toolUseCount,
        agentCount,
      });

      // Insert token_usage — INSERT OR IGNORE handles dedup via UNIQUE(session_id, message_id)
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        insertTokenUsage(db, {
          sessionId,
          messageId: msg.messageId,
          model: msg.model,
          inputTokens: msg.inputTokens,
          outputTokens: msg.outputTokens,
          cacheCreateTokens: msg.cacheCreateTokens,
          cacheReadTokens: msg.cacheReadTokens,
          costUsd: messageCosts[i],
          timestamp: msg.timestamp,
        });
      }

      // Track file size so next Stop can skip if unchanged
      db.prepare(`
        INSERT OR REPLACE INTO sync_state
        (file_path, file_size, last_modified, last_parsed_at, lines_parsed, status)
        VALUES (?, ?, ?, ?, ?, 'partial')
      `).run(
        payload.transcript_path,
        fileStat.size,
        fileStat.mtime.toISOString(),
        new Date().toISOString(),
        messages.length,
      );
    })();
  } finally {
    db.close();
  }
}

/**
 * Insert or update a session WITHOUT overwriting end_reason or category.
 * Unlike insertSession (INSERT OR REPLACE which deletes + reinserts),
 * this uses INSERT ON CONFLICT DO UPDATE to preserve fields set by SessionEnd.
 */
function upsertSessionLive(
  db: Database.Database,
  session: {
    id: string;
    projectId: number;
    startedAt: string;
    endedAt: string | null;
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
  },
): void {
  db.prepare(`
    INSERT INTO sessions
    (id, project_id, started_at, ended_at, primary_model, claude_version,
     git_branch, total_input_tokens, total_output_tokens, total_cache_create_tokens,
     total_cache_read_tokens, total_cost_usd, message_count, tool_use_count, agent_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      ended_at = excluded.ended_at,
      primary_model = excluded.primary_model,
      total_input_tokens = excluded.total_input_tokens,
      total_output_tokens = excluded.total_output_tokens,
      total_cache_create_tokens = excluded.total_cache_create_tokens,
      total_cache_read_tokens = excluded.total_cache_read_tokens,
      total_cost_usd = excluded.total_cost_usd,
      message_count = excluded.message_count,
      tool_use_count = excluded.tool_use_count,
      agent_count = excluded.agent_count
  `).run(
    session.id, session.projectId, session.startedAt, session.endedAt,
    session.primaryModel, session.claudeVersion, session.gitBranch,
    session.totalInputTokens, session.totalOutputTokens,
    session.totalCacheCreateTokens, session.totalCacheReadTokens,
    session.totalCostUsd, session.messageCount, session.toolUseCount,
    session.agentCount,
  );
}

// When run as hook handler: read JSON from stdin
async function main() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const payload: StopPayload = JSON.parse(Buffer.concat(chunks).toString("utf-8"));

  try {
    await handleStop(payload);
  } catch (err) {
    process.stderr.write(`[codeledger] Stop hook error: ${err}\n`);
  }
  process.exit(0);
}

import { fileURLToPath } from "url";
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
