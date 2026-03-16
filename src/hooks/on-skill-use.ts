import { createConnection, getDefaultDbPath } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";
import { seedPricing } from "../db/pricing.js";
import { insertSkillInvocation } from "../db/queries.js";

interface PostToolUsePayload {
  session_id: string;
  tool_name: string;
  tool_input?: {
    skill?: string;
    args?: string;
  };
  tool_response?: string;
  transcript_path?: string;
  cwd: string;
  permission_mode: string;
  hook_event_name: string;
}

export async function handleSkillUse(
  payload: PostToolUsePayload,
  dbPath?: string
): Promise<void> {
  const db = createConnection(dbPath ?? getDefaultDbPath());

  try {
    runMigrations(db);
    seedPricing(db);

    // Extract skill name — tool_input structure is inferred, not verified
    const skillName = payload.tool_input?.skill;
    if (!skillName) {
      process.stderr.write(
        `[codeledger] PostToolUse(Skill): could not extract skill name from tool_input, skipping\n`
      );
      return;
    }

    try {
      insertSkillInvocation(db, {
        sessionId: payload.session_id,
        skillName,
        invokedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      // FK violation means parent session not in DB yet
      if (err.message?.includes("FOREIGN KEY")) {
        process.stderr.write(
          `[codeledger] PostToolUse(Skill): session ${payload.session_id} not in DB, skipping\n`
        );
      } else {
        throw err;
      }
    }
  } catch (err) {
    process.stderr.write(
      `[codeledger] PostToolUse(Skill) hook error: ${err}\n`
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
  const payload: PostToolUsePayload = JSON.parse(
    Buffer.concat(chunks).toString("utf-8")
  );

  try {
    await handleSkillUse(payload);
  } catch (err) {
    process.stderr.write(
      `[codeledger] PostToolUse(Skill) hook error: ${err}\n`
    );
  }
  process.exit(0);
}

// Only run main when executed directly (not imported in tests)
import { fileURLToPath } from "url";
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
