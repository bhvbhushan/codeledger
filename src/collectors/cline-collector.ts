import type Database from "better-sqlite3";
import { readdirSync, readFileSync, statSync, existsSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import { upsertProject, recalculateProjectTotals } from "../db/queries.js";
import type { Collector, CollectorResult } from "./types.js";

const CLINE_DIR = join(
  process.env.HOME || process.env.USERPROFILE || "~",
  ".vscode",
  "globalStorage",
  "saoudrizwan.claude-dev",
  "tasks",
);

function detectProvider(model: string): string {
  if (model.startsWith("claude")) return "anthropic";
  if (model.startsWith("gpt") || model.startsWith("o3") || model.startsWith("o4")) return "openai";
  if (model.startsWith("gemini")) return "google";
  return "unknown";
}

export class ClineCollector implements Collector {
  tool = "cline";
  provider = "varies";

  findDataFiles(): string[] {
    if (!existsSync(CLINE_DIR)) return [];
    const files: string[] = [];
    let taskDirs: string[];
    try {
      taskDirs = readdirSync(CLINE_DIR);
    } catch {
      return [];
    }
    for (const taskDir of taskDirs) {
      const taskPath = join(CLINE_DIR, taskDir);
      const stat = statSync(taskPath, { throwIfNoEntry: false });
      if (!stat?.isDirectory()) continue;
      const historyFile = join(taskPath, "api_conversation_history.json");
      if (existsSync(historyFile)) {
        files.push(historyFile);
      }
    }
    return files;
  }

  validateFormat(data: unknown): { valid: boolean; version?: string; warning?: string } {
    if (!Array.isArray(data)) return { valid: false, warning: "Expected JSON array" };
    if (data.length === 0) return { valid: true };
    const first = data[0];
    if (typeof first !== "object" || first === null) {
      return { valid: false, warning: "Array entries must be objects" };
    }
    // Cline entries typically have tokensIn and tokensOut (or ts field)
    if ("tokensIn" in first || "tokensOut" in first || "ts" in first) {
      return { valid: true };
    }
    return { valid: false, warning: "Missing expected tokensIn/tokensOut fields" };
  }

  async parseFile(db: Database.Database, filePath: string): Promise<CollectorResult> {
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(filePath, "utf-8"));
    } catch {
      process.stderr.write(
        `[codeledger] Warning: cline format may have changed. Skipping ${filePath}.\n`,
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
        `[codeledger] Warning: cline format may have changed. Skipping ${filePath}.\n`,
      );
      const fileStat = statSync(filePath);
      db.prepare(`
        INSERT OR REPLACE INTO sync_state
        (file_path, file_size, last_modified, last_parsed_at, lines_parsed, status)
        VALUES (?, ?, ?, ?, 0, 'format_changed')
      `).run(filePath, fileStat.size, fileStat.mtime.toISOString(), new Date().toISOString());
      return { sessionsAdded: 0, errors: 1 };
    }

    const entries = data as Array<Record<string, unknown>>;
    if (entries.length === 0) return { sessionsAdded: 0, errors: 0 };

    const sessionId = createHash("sha256").update(filePath).digest("hex").slice(0, 32);
    let totalInput = 0;
    let totalOutput = 0;
    let totalCost = 0;
    let model = "unknown";
    let provider = "unknown";
    let startedAt: string | null = null;
    let endedAt: string | null = null;
    let messageCount = 0;

    for (const entry of entries) {
      const tokIn = typeof entry.tokensIn === "number" ? entry.tokensIn : 0;
      const tokOut = typeof entry.tokensOut === "number" ? entry.tokensOut : 0;
      totalInput += tokIn;
      totalOutput += tokOut;

      // Use pre-calculated cost when available
      if (typeof entry.cost === "number") {
        totalCost += entry.cost;
      }

      if (typeof entry.model === "string" && entry.model) {
        model = entry.model;
        provider = detectProvider(model);
      }

      const ts = typeof entry.ts === "number"
        ? new Date(entry.ts).toISOString()
        : typeof entry.ts === "string"
          ? entry.ts
          : null;
      if (ts) {
        if (!startedAt) startedAt = ts;
        endedAt = ts;
      }

      if (tokIn > 0 || tokOut > 0) messageCount++;
    }

    if (messageCount === 0) return { sessionsAdded: 0, errors: 0 };

    const now = new Date().toISOString();
    if (!startedAt) startedAt = now;

    db.transaction(() => {
      const projectPath = "cline-sessions";
      const projectId = upsertProject(db, projectPath, "cline", CLINE_DIR, startedAt!);

      db.prepare(`
        INSERT OR REPLACE INTO sessions
        (id, project_id, started_at, ended_at, end_reason, primary_model, claude_version,
         git_branch, total_input_tokens, total_output_tokens, total_cache_create_tokens,
         total_cache_read_tokens, total_cost_usd, message_count, tool_use_count, agent_count,
         tool, provider)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        sessionId, projectId, startedAt, endedAt, null, model, null, null,
        totalInput, totalOutput, 0, 0, totalCost, messageCount, 0, 0,
        this.tool, provider,
      );

      recalculateProjectTotals(db, projectId);
    })();

    return { sessionsAdded: 1, errors: 0 };
  }
}
