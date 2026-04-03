import type Database from "better-sqlite3";
import { readdirSync, statSync, existsSync } from "fs";
import { join, basename } from "path";
import { parseSessionFile } from "../parser/session-parser.js";
import { parseAgentFile, readAgentMeta } from "../parser/agent-parser.js";
import { CodexCollector } from "../collectors/codex-collector.js";
import { ClineCollector } from "../collectors/cline-collector.js";
import { GeminiCollector } from "../collectors/gemini-collector.js";
import type { Collector, CollectorResult } from "../collectors/types.js";

interface ScanResult {
  newFiles: number;
  errors: number;
}

export async function scanForNewSessions(
  db: Database.Database,
  claudeDir: string
): Promise<ScanResult> {
  const projectsDir = join(claudeDir, "projects");
  let newFiles = 0;
  let errors = 0;

  let projectDirs: string[];
  try {
    projectDirs = readdirSync(projectsDir);
  } catch {
    return { newFiles: 0, errors: 0 };
  }

  for (const projectName of projectDirs) {
    const projectPath = join(projectsDir, projectName);
    const stat = statSync(projectPath, { throwIfNoEntry: false });
    if (!stat?.isDirectory()) continue;

    let files: string[];
    try {
      files = readdirSync(projectPath);
    } catch {
      continue;
    }

    // Phase A: Scan session JSONL files
    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;

      const filePath = join(projectPath, file);
      const fileStat = statSync(filePath, { throwIfNoEntry: false });
      if (!fileStat) continue;

      const syncRow = db
        .prepare("SELECT * FROM sync_state WHERE file_path = ?")
        .get(filePath) as any;

      if (syncRow && syncRow.file_size === fileStat.size) {
        continue;
      }

      try {
        const cwd = "/" + projectName.replace(/^-/, "").replace(/-/g, "/");

        await parseSessionFile(db, filePath, projectName, cwd);

        db.prepare(`
          INSERT OR REPLACE INTO sync_state
          (file_path, file_size, last_modified, last_parsed_at, lines_parsed, status)
          VALUES (?, ?, ?, ?, 0, 'complete')
        `).run(
          filePath,
          fileStat.size,
          fileStat.mtime.toISOString(),
          new Date().toISOString()
        );

        newFiles++;
      } catch (err) {
        errors++;
        db.prepare(`
          INSERT OR REPLACE INTO sync_state
          (file_path, file_size, last_modified, last_parsed_at, lines_parsed, status)
          VALUES (?, ?, ?, ?, 0, 'error')
        `).run(
          filePath,
          fileStat.size,
          fileStat.mtime.toISOString(),
          new Date().toISOString()
        );
      }
    }

    // Phase B: Scan subagent directories
    // Session directories are UUIDs containing a subagents/ folder
    for (const entry of files) {
      const sessionDir = join(projectPath, entry);
      const sessionStat = statSync(sessionDir, { throwIfNoEntry: false });
      if (!sessionStat?.isDirectory()) continue;

      const subagentsDir = join(sessionDir, "subagents");
      if (!existsSync(subagentsDir)) continue;

      let agentFiles: string[];
      try {
        agentFiles = readdirSync(subagentsDir);
      } catch {
        continue;
      }

      for (const agentFile of agentFiles) {
        if (!agentFile.endsWith(".jsonl")) continue;

        const agentFilePath = join(subagentsDir, agentFile);
        const agentFileStat = statSync(agentFilePath, {
          throwIfNoEntry: false,
        });
        if (!agentFileStat) continue;

        // Check sync_state
        const syncRow = db
          .prepare("SELECT * FROM sync_state WHERE file_path = ?")
          .get(agentFilePath) as any;

        if (syncRow && syncRow.file_size === agentFileStat.size) {
          continue;
        }

        try {
          // Extract agent ID from filename: agent-{id}.jsonl
          const agentId = basename(agentFile, ".jsonl");

          // The session ID is the directory name (UUID)
          const sessionId = entry;

          // Read companion meta.json
          const metaPath = agentFilePath.replace(/\.jsonl$/, ".meta.json");
          const meta = readAgentMeta(metaPath);
          const agentType = meta?.agentType ?? null;

          await parseAgentFile(
            db,
            agentFilePath,
            agentId,
            sessionId,
            agentType
          );

          db.prepare(`
            INSERT OR REPLACE INTO sync_state
            (file_path, file_size, last_modified, last_parsed_at, lines_parsed, status)
            VALUES (?, ?, ?, ?, 0, 'complete')
          `).run(
            agentFilePath,
            agentFileStat.size,
            agentFileStat.mtime.toISOString(),
            new Date().toISOString()
          );

          newFiles++;
        } catch (err) {
          errors++;
          db.prepare(`
            INSERT OR REPLACE INTO sync_state
            (file_path, file_size, last_modified, last_parsed_at, lines_parsed, status)
            VALUES (?, ?, ?, ?, 0, 'error')
          `).run(
            agentFilePath,
            agentFileStat.size,
            agentFileStat.mtime.toISOString(),
            new Date().toISOString()
          );
        }
      }
    }
  }

  return { newFiles, errors };
}

export async function scanCollectors(
  db: Database.Database,
): Promise<ScanResult> {
  const collectors: Collector[] = [
    new CodexCollector(),
    new ClineCollector(),
    new GeminiCollector(),
  ];

  let newFiles = 0;
  let errors = 0;

  for (const collector of collectors) {
    try {
      const files = collector.findDataFiles();

      for (const filePath of files) {
        const fileStat = statSync(filePath, { throwIfNoEntry: false });
        if (!fileStat) continue;

        const syncRow = db
          .prepare("SELECT * FROM sync_state WHERE file_path = ?")
          .get(filePath) as any;

        if (syncRow && syncRow.file_size === fileStat.size) {
          continue;
        }

        try {
          const result: CollectorResult = await collector.parseFile(db, filePath);
          newFiles += result.sessionsAdded;
          errors += result.errors;

          if (result.sessionsAdded > 0) {
            db.prepare(`
              INSERT OR REPLACE INTO sync_state
              (file_path, file_size, last_modified, last_parsed_at, lines_parsed, status)
              VALUES (?, ?, ?, ?, 0, 'complete')
            `).run(
              filePath,
              fileStat.size,
              fileStat.mtime.toISOString(),
              new Date().toISOString(),
            );
          }
        } catch (err) {
          errors++;
          process.stderr.write(
            `[codeledger] Warning: ${collector.tool} collector error on ${filePath}: ${err}\n`,
          );
          db.prepare(`
            INSERT OR REPLACE INTO sync_state
            (file_path, file_size, last_modified, last_parsed_at, lines_parsed, status)
            VALUES (?, ?, ?, ?, 0, 'error')
          `).run(
            filePath,
            fileStat.size,
            fileStat.mtime.toISOString(),
            new Date().toISOString(),
          );
        }
      }
    } catch (err) {
      process.stderr.write(
        `[codeledger] Warning: ${collector.tool} collector failed: ${err}\n`,
      );
    }
  }

  return { newFiles, errors };
}
