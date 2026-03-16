import type Database from "better-sqlite3";
import { readdirSync, statSync } from "fs";
import { join } from "path";
import { parseSessionFile } from "../parser/session-parser.js";

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
  }

  return { newFiles, errors };
}
