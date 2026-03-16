import { createConnection, getDefaultDbPath } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";
import { seedPricing } from "../db/pricing.js";
import { parseAgentFile, readAgentMeta } from "../parser/agent-parser.js";
import { dirname, basename } from "path";

interface SubagentStopPayload {
  session_id: string;
  agent_id: string;
  agent_type?: string;
  agent_transcript_path: string;
  last_assistant_message?: string;
  stop_hook_active?: boolean;
  transcript_path?: string;
  cwd: string;
  permission_mode: string;
  hook_event_name: string;
}

export async function handleSubagentStop(
  payload: SubagentStopPayload,
  dbPath?: string
): Promise<void> {
  const db = createConnection(dbPath ?? getDefaultDbPath());

  try {
    runMigrations(db);
    seedPricing(db);

    // Determine agent_type: prefer payload, fall back to meta.json
    let agentType = payload.agent_type ?? null;
    if (!agentType && payload.agent_transcript_path) {
      const metaPath = payload.agent_transcript_path.replace(
        /\.jsonl$/,
        ".meta.json"
      );
      const meta = readAgentMeta(metaPath);
      if (meta) {
        agentType = meta.agentType;
      }
    }

    await parseAgentFile(
      db,
      payload.agent_transcript_path,
      payload.agent_id,
      payload.session_id,
      agentType
    );
  } catch (err) {
    process.stderr.write(
      `[codeledger] SubagentStop hook error: ${err}\n`
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
  const payload: SubagentStopPayload = JSON.parse(
    Buffer.concat(chunks).toString("utf-8")
  );

  try {
    await handleSubagentStop(payload);
  } catch (err) {
    process.stderr.write(`[codeledger] SubagentStop hook error: ${err}\n`);
  }
  process.exit(0);
}

// Only run main when executed directly (not imported in tests)
import { fileURLToPath } from "url";
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
