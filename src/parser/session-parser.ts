import type Database from "better-sqlite3";
import { basename } from "path";
import { readJsonlLines } from "./jsonl-reader.js";
import {
  extractAssistantData,
  deduplicateMessages,
} from "./message-extractor.js";
import { calculateCost } from "../db/pricing.js";
import {
  upsertProject,
  insertSession,
  insertTokenUsage,
  upsertToolCall,
  upsertDailySummary,
  recalculateProjectTotals,
} from "../db/queries.js";

export interface ParseResult {
  sessionId: string;
  messageCount: number;
  totalCostUsd: number;
}

export async function parseSessionFile(
  db: Database.Database,
  filePath: string,
  projectPath: string,
  cwd: string
): Promise<ParseResult> {
  const lines = await readJsonlLines(filePath);

  // Extract session metadata from first user line
  const firstUser = lines.find((l) => l.type === "user") as any;
  const sessionId = firstUser?.sessionId ?? basename(filePath, ".jsonl");
  const claudeVersion = firstUser?.version ?? null;
  const gitBranch = firstUser?.gitBranch ?? null;
  const actualCwd = firstUser?.cwd ?? cwd;

  // Use earliest available timestamp from any line (never fall back to current time)
  const firstLineTimestamp = (lines[0] as any)?.timestamp ?? null;

  // Extract and deduplicate assistant messages
  const rawAssistant = lines
    .filter((l) => l.type === "assistant")
    .map(extractAssistantData)
    .filter((d): d is NonNullable<typeof d> => d !== null);

  const messages = deduplicateMessages(rawAssistant);

  // Skip sessions with no assistant messages (empty/idle sessions, queue-only files)
  if (messages.length === 0) {
    return { sessionId, messageCount: 0, totalCostUsd: 0 };
  }

  // Derive display name from cwd (last path segment)
  const displayName =
    actualCwd.split("/").filter(Boolean).pop() ?? projectPath;

  // All DB writes in a single transaction
  const result = db.transaction(() => {
    const projectId = upsertProject(
      db,
      projectPath,
      displayName,
      actualCwd,
      messages[0]?.timestamp ?? firstLineTimestamp ?? new Date().toISOString()
    );

    // First pass: compute aggregates and per-message costs
    const modelTokens = new Map<string, { input: number; output: number }>();
    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheCreate = 0;
    let totalCacheRead = 0;
    let totalCost = 0;
    let toolUseCount = 0;
    const toolCounts = new Map<string, number>();
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

      // Track model token distribution for primary_model
      const mt = modelTokens.get(msg.model) ?? { input: 0, output: 0 };
      mt.output += msg.outputTokens;
      modelTokens.set(msg.model, mt);

      // Count tool uses
      for (const tool of msg.toolUses) {
        toolUseCount++;
        toolCounts.set(tool.name, (toolCounts.get(tool.name) ?? 0) + 1);
      }
    }

    // Determine primary model (highest output tokens)
    let primaryModel: string | null = null;
    let maxOutput = 0;
    for (const [model, counts] of modelTokens) {
      if (counts.output > maxOutput) {
        maxOutput = counts.output;
        primaryModel = model;
      }
    }

    // Count agents (tool_use blocks with name "Agent")
    const agentCount = messages.reduce(
      (sum, m) => sum + m.toolUses.filter((t) => t.name === "Agent").length,
      0
    );

    const startedAt = messages[0]?.timestamp ?? firstLineTimestamp ?? new Date().toISOString();
    const endedAt = messages[messages.length - 1]?.timestamp ?? null;

    // Insert session first (token_usage has FK to sessions)
    insertSession(db, {
      id: sessionId,
      projectId,
      startedAt,
      endedAt,
      endReason: null,
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

    // Second pass: insert token_usage rows (after session exists)
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

    // Insert tool call counts
    for (const [name, count] of toolCounts) {
      upsertToolCall(db, sessionId, name, count);
    }

    // Upsert daily summary
    const date = startedAt.split("T")[0];
    if (primaryModel) {
      upsertDailySummary(
        db,
        date,
        projectId,
        primaryModel,
        totalInput,
        totalOutput,
        totalCost
      );
    }

    // Recompute project totals from sessions
    recalculateProjectTotals(db, projectId);

    return {
      sessionId,
      messageCount: messages.length,
      totalCostUsd: totalCost,
    };
  })();

  return result;
}
