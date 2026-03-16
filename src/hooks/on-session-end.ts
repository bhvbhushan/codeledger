import { createConnection, getDefaultDbPath } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";
import { seedPricing } from "../db/pricing.js";
import { parseSessionFile } from "../parser/session-parser.js";
import { dirname, basename } from "path";

interface SessionEndPayload {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode: string;
  hook_event_name: string;
  reason: string;
}

export async function handleSessionEnd(
  payload: SessionEndPayload,
  dbPath?: string
): Promise<void> {
  const db = createConnection(dbPath ?? getDefaultDbPath());

  try {
    runMigrations(db);
    seedPricing(db);

    // Derive project path from transcript_path directory
    // ~/.claude/projects/{project-path}/{session-uuid}.jsonl
    const dir = dirname(payload.transcript_path);
    const projectPath = basename(dir);

    const result = await parseSessionFile(db, payload.transcript_path, projectPath, payload.cwd);

    // Update session with end_reason from hook payload
    db.prepare("UPDATE sessions SET end_reason = ? WHERE id = ?").run(
      payload.reason,
      result.sessionId
    );
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
  const payload: SessionEndPayload = JSON.parse(Buffer.concat(chunks).toString("utf-8"));

  try {
    await handleSessionEnd(payload);
  } catch (err) {
    process.stderr.write(`[codeledger] SessionEnd hook error: ${err}\n`);
  }
  process.exit(0);
}

// Only run main when executed directly (not imported in tests)
import { fileURLToPath } from "url";
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
