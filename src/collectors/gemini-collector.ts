import type Database from "better-sqlite3";
import { readdirSync, readFileSync, statSync, existsSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import { calculateCost } from "../db/pricing.js";
import { upsertProject, recalculateProjectTotals } from "../db/queries.js";
import type { Collector, CollectorResult } from "./types.js";

const GEMINI_DIR = join(
  process.env.HOME || process.env.USERPROFILE || "~",
  ".gemini",
  "tmp",
);

export class GeminiCollector implements Collector {
  tool = "gemini-cli";
  provider = "google";

  findDataFiles(): string[] {
    if (!existsSync(GEMINI_DIR)) return [];
    const files: string[] = [];
    let sessionDirs: string[];
    try {
      sessionDirs = readdirSync(GEMINI_DIR);
    } catch {
      return [];
    }
    for (const sessionDir of sessionDirs) {
      const sessionPath = join(GEMINI_DIR, sessionDir);
      const stat = statSync(sessionPath, { throwIfNoEntry: false });
      if (!stat?.isDirectory()) continue;
      const stateFile = join(sessionPath, "state.json");
      if (existsSync(stateFile)) {
        files.push(stateFile);
      }
    }
    return files;
  }

  validateFormat(data: unknown): { valid: boolean; version?: string; warning?: string } {
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      return { valid: false, warning: "Expected JSON object" };
    }
    const obj = data as Record<string, unknown>;
    if (!Array.isArray(obj.messages)) {
      return { valid: false, warning: "Missing messages array" };
    }
    // Check that at least some messages have usage_metadata
    const messages = obj.messages as Array<Record<string, unknown>>;
    const hasUsage = messages.some(
      (m) => m.usage_metadata && typeof m.usage_metadata === "object",
    );
    if (!hasUsage && messages.length > 0) {
      return { valid: false, warning: "No messages with usage_metadata found" };
    }
    return { valid: true };
  }

  async parseFile(db: Database.Database, filePath: string): Promise<CollectorResult> {
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(filePath, "utf-8"));
    } catch {
      process.stderr.write(
        `[codeledger] Warning: gemini-cli format may have changed. Skipping ${filePath}.\n`,
      );
      const fileStat = statSync(filePath);
      db.prepare(`
        INSERT OR REPLACE INTO sync_state
        (file_path, file_size, last_modified, last_parsed_at, lines_parsed, status)
        VALUES (?, ?, ?, ?, 0, 'format_changed')
      `).run(filePath, fileStat.size, fileStat.mtime.toISOString(), new Date().toISOString());
      return { sessionsAdded: 0, errors: 1 };
    }

    const validation = this.validateFormat(data);
    if (!validation.valid) {
      process.stderr.write(
        `[codeledger] Warning: gemini-cli format may have changed. Skipping ${filePath}.\n`,
      );
      const fileStat = statSync(filePath);
      db.prepare(`
        INSERT OR REPLACE INTO sync_state
        (file_path, file_size, last_modified, last_parsed_at, lines_parsed, status)
        VALUES (?, ?, ?, ?, 0, 'format_changed')
      `).run(filePath, fileStat.size, fileStat.mtime.toISOString(), new Date().toISOString());
      return { sessionsAdded: 0, errors: 1 };
    }

    const obj = data as Record<string, unknown>;
    const messages = (obj.messages as Array<Record<string, unknown>>) ?? [];
    if (messages.length === 0) return { sessionsAdded: 0, errors: 0 };

    const sessionId = createHash("sha256").update(filePath).digest("hex").slice(0, 32);
    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheRead = 0;
    let totalCost = 0;
    let model = "gemini-2.5-pro";
    let startedAt: string | null = null;
    let endedAt: string | null = null;
    let messageCount = 0;

    for (const msg of messages) {
      const usage = msg.usage_metadata as Record<string, unknown> | undefined;
      if (!usage) continue;

      const promptTokens = typeof usage.prompt_token_count === "number" ? usage.prompt_token_count : 0;
      const candidateTokens = typeof usage.candidates_token_count === "number" ? usage.candidates_token_count : 0;
      const cachedTokens = typeof usage.cached_content_token_count === "number" ? usage.cached_content_token_count : 0;

      totalInput += promptTokens;
      totalOutput += candidateTokens;
      totalCacheRead += cachedTokens;
      messageCount++;

      if (typeof msg.model === "string" && msg.model) {
        model = msg.model;
      }

      const ts = typeof msg.created_at === "string"
        ? msg.created_at
        : typeof msg.timestamp === "string"
          ? msg.timestamp
          : null;
      if (ts) {
        if (!startedAt) startedAt = ts;
        endedAt = ts;
      }
    }

    if (messageCount === 0) return { sessionsAdded: 0, errors: 0 };

    totalCost = calculateCost(db, model, {
      input_tokens: totalInput,
      output_tokens: totalOutput,
      cache_create_tokens: 0,
      cache_read_tokens: totalCacheRead,
    });

    const now = new Date().toISOString();
    if (!startedAt) startedAt = now;

    db.transaction(() => {
      const projectPath = "gemini-cli-sessions";
      const projectId = upsertProject(db, projectPath, "gemini-cli", GEMINI_DIR, startedAt!);

      db.prepare(`
        INSERT OR REPLACE INTO sessions
        (id, project_id, started_at, ended_at, end_reason, primary_model, claude_version,
         git_branch, total_input_tokens, total_output_tokens, total_cache_create_tokens,
         total_cache_read_tokens, total_cost_usd, message_count, tool_use_count, agent_count,
         tool, provider)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        sessionId, projectId, startedAt, endedAt, null, model, null, null,
        totalInput, totalOutput, 0, totalCacheRead, totalCost, messageCount, 0, 0,
        this.tool, this.provider,
      );

      recalculateProjectTotals(db, projectId);
    })();

    return { sessionsAdded: 1, errors: 0 };
  }
}
