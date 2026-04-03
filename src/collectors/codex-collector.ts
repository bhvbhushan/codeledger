import type Database from "better-sqlite3";
import { readdirSync, readFileSync, statSync, existsSync } from "fs";
import { join, basename } from "path";
import { createHash } from "crypto";
import { calculateCost } from "../db/pricing.js";
import { upsertProject, recalculateProjectTotals } from "../db/queries.js";
import type { Collector, CollectorResult } from "./types.js";

const CODEX_DIR = join(
  process.env.HOME || process.env.USERPROFILE || "~",
  ".codex",
  "sessions",
);

export class CodexCollector implements Collector {
  tool = "codex-cli";
  provider = "openai";

  findDataFiles(): string[] {
    if (!existsSync(CODEX_DIR)) return [];
    const files: string[] = [];
    let dateDirs: string[];
    try {
      dateDirs = readdirSync(CODEX_DIR);
    } catch {
      return [];
    }
    for (const dateDir of dateDirs) {
      const datePath = join(CODEX_DIR, dateDir);
      const stat = statSync(datePath, { throwIfNoEntry: false });
      if (!stat?.isDirectory()) continue;
      let entries: string[];
      try {
        entries = readdirSync(datePath);
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.endsWith(".jsonl")) {
          files.push(join(datePath, entry));
        }
      }
    }
    return files;
  }

  validateFormat(data: unknown): { valid: boolean; version?: string; warning?: string } {
    if (typeof data !== "string") return { valid: false, warning: "Expected JSONL string" };
    const lines = data.split("\n").filter((l) => l.trim());
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.type === "response" && obj.response?.output) {
          return { valid: true };
        }
      } catch {
        continue;
      }
    }
    return { valid: false, warning: "No response entries with output found" };
  }

  async parseFile(db: Database.Database, filePath: string): Promise<CollectorResult> {
    const content = readFileSync(filePath, "utf-8");
    const validation = this.validateFormat(content);
    if (!validation.valid) {
      process.stderr.write(
        `[codeledger] Warning: codex-cli format may have changed. Skipping ${filePath}.\n`,
      );
      db.prepare(`
        INSERT OR REPLACE INTO sync_state
        (file_path, file_size, last_modified, last_parsed_at, lines_parsed, status)
        VALUES (?, ?, ?, ?, 0, 'format_changed')
      `).run(filePath, statSync(filePath).size, statSync(filePath).mtime.toISOString(), new Date().toISOString());
      return { sessionsAdded: 0, errors: 1 };
    }

    const sessionId = createHash("sha256").update(filePath).digest("hex").slice(0, 32);
    const lines = content.split("\n").filter((l) => l.trim());

    let totalInput = 0;
    let totalOutput = 0;
    let totalCost = 0;
    let model = "o4-mini";
    let startedAt: string | null = null;
    let endedAt: string | null = null;
    let messageCount = 0;

    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.type === "response" && obj.response) {
          const resp = obj.response;
          const usage = resp.usage;
          if (usage) {
            totalInput += usage.input_tokens ?? 0;
            totalOutput += usage.output_tokens ?? 0;
            messageCount++;
          }
          if (resp.model) model = resp.model;
          if (resp.created_at) {
            const ts = typeof resp.created_at === "number"
              ? new Date(resp.created_at * 1000).toISOString()
              : resp.created_at;
            if (!startedAt) startedAt = ts;
            endedAt = ts;
          }
        }
      } catch {
        continue;
      }
    }

    if (messageCount === 0) return { sessionsAdded: 0, errors: 0 };

    totalCost = calculateCost(db, model, {
      input_tokens: totalInput,
      output_tokens: totalOutput,
      cache_create_tokens: 0,
      cache_read_tokens: 0,
    });

    const now = new Date().toISOString();
    if (!startedAt) startedAt = now;

    db.transaction(() => {
      const projectPath = "codex-cli-sessions";
      const projectId = upsertProject(db, projectPath, "codex-cli", CODEX_DIR, startedAt!);

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
        this.tool, this.provider,
      );

      recalculateProjectTotals(db, projectId);
    })();

    return { sessionsAdded: 1, errors: 0 };
  }
}
