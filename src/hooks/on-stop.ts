import { initHookDb } from "./init-db.js";
import { readJsonlLines } from "../parser/jsonl-reader.js";
import {
  extractAssistantData,
  deduplicateMessages,
} from "../parser/message-extractor.js";
import { calculateCost } from "../db/pricing.js";
import { upsertProject, insertSession, insertTokenUsage } from "../db/queries.js";
import { dirname, basename } from "path";

/**
 * Lightweight real-time session tracking.
 *
 * Called on every Claude response (Stop event) DURING the session.
 * Only writes to dedup-safe tables:
 *   - token_usage: INSERT OR IGNORE (UNIQUE constraint handles dedup)
 *   - sessions: INSERT OR REPLACE (latest totals overwrite)
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

      // Upsert session — INSERT OR REPLACE ensures latest totals win
      insertSession(db, {
        id: sessionId,
        projectId,
        startedAt,
        endedAt,
        endReason: null, // Only SessionEnd sets this
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
    })();
  } finally {
    db.close();
  }
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
