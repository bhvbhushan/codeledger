import type Database from "better-sqlite3";
import { readFileSync, existsSync } from "fs";
import { readJsonlLines } from "./jsonl-reader.js";
import {
  extractAssistantData,
  deduplicateMessages,
} from "./message-extractor.js";
import { calculateCost } from "../db/pricing.js";
import { classifyAgentSource } from "./classify-agent.js";

export interface AgentMeta {
  agentType: string;
}

export interface AgentParseResult {
  agentId: string;
  sessionId: string;
  agentType: string | null;
  model: string | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreateTokens: number;
  totalCacheReadTokens: number;
  totalCostUsd: number;
  startedAt: string | null;
  endedAt: string | null;
  messageCount: number;
  sourceCategory: "user" | "overhead";
}

export function readAgentMeta(metaPath: string): AgentMeta | null {
  try {
    if (!existsSync(metaPath)) return null;
    const raw = readFileSync(metaPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed.agentType) {
      return { agentType: parsed.agentType };
    }
    return null;
  } catch {
    return null;
  }
}

export async function parseAgentFile(
  db: Database.Database,
  filePath: string,
  agentId: string,
  sessionId: string,
  agentType: string | null,
  description?: string | null
): Promise<AgentParseResult | null> {
  const lines = await readJsonlLines(filePath);

  // Extract and deduplicate assistant messages (same logic as session-parser)
  const rawAssistant = lines
    .filter((l) => l.type === "assistant")
    .map(extractAssistantData)
    .filter((d): d is NonNullable<typeof d> => d !== null);

  const messages = deduplicateMessages(rawAssistant);

  if (messages.length === 0) {
    return null;
  }

  // Compute aggregates
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheCreate = 0;
  let totalCacheRead = 0;
  let totalCost = 0;
  const modelTokens = new Map<string, number>();

  for (const msg of messages) {
    const cost = calculateCost(db, msg.model, {
      input_tokens: msg.inputTokens,
      output_tokens: msg.outputTokens,
      cache_create_tokens: msg.cacheCreateTokens,
      cache_read_tokens: msg.cacheReadTokens,
    });

    totalInput += msg.inputTokens;
    totalOutput += msg.outputTokens;
    totalCacheCreate += msg.cacheCreateTokens;
    totalCacheRead += msg.cacheReadTokens;
    totalCost += cost;

    const mt = modelTokens.get(msg.model) ?? 0;
    modelTokens.set(msg.model, mt + msg.outputTokens);
  }

  // Determine primary model (highest output tokens)
  let primaryModel: string | null = null;
  let maxOutput = 0;
  for (const [model, output] of modelTokens) {
    if (output > maxOutput) {
      maxOutput = output;
      primaryModel = model;
    }
  }

  const startedAt = messages[0]?.timestamp ?? null;
  const endedAt = messages[messages.length - 1]?.timestamp ?? null;

  const result: AgentParseResult = {
    agentId,
    sessionId,
    agentType,
    model: primaryModel,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    totalCacheCreateTokens: totalCacheCreate,
    totalCacheReadTokens: totalCacheRead,
    totalCostUsd: totalCost,
    startedAt,
    endedAt,
    messageCount: messages.length,
    sourceCategory: classifyAgentSource(agentId),
  };

  // Write to agents table — use INSERT OR REPLACE for idempotency
  // Use a try/catch to handle FK violation if parent session doesn't exist yet
  try {
    db.prepare(`
      INSERT OR REPLACE INTO agents
      (id, session_id, agent_type, description, model,
       total_input_tokens, total_output_tokens,
       total_cache_create_tokens, total_cache_read_tokens,
       total_cost_usd, started_at, ended_at, message_count, source_category)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      agentId,
      sessionId,
      agentType,
      description ?? null,
      primaryModel,
      totalInput,
      totalOutput,
      totalCacheCreate,
      totalCacheRead,
      totalCost,
      startedAt,
      endedAt,
      messages.length,
      classifyAgentSource(agentId)
    );
  } catch (err: any) {
    // FK violation means parent session not in DB yet — scanner will backfill
    if (err.message?.includes("FOREIGN KEY")) {
      process.stderr.write(
        `[codeledger] Agent ${agentId}: parent session ${sessionId} not in DB, skipping insert\n`
      );
    } else {
      throw err;
    }
  }

  return result;
}
