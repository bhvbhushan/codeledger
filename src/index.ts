import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pkg = require("../package.json");
import { createConnection, getDefaultDbPath } from "./db/connection.js";
import { runMigrations } from "./db/migrate.js";
import { seedPricing } from "./db/pricing.js";
import { scanForNewSessions } from "./sync/scanner.js";
import { classifyAllSessions } from "./classifier/categorize-session.js";
import { registerUsageSummary } from "./tools/usage-summary.js";
import { registerProjectUsage } from "./tools/project-usage.js";
import { registerModelStats } from "./tools/model-stats.js";
import { registerAgentUsage } from "./tools/agent-usage.js";
import { registerSkillUsage } from "./tools/skill-usage.js";
import { registerCostOptimize } from "./tools/cost-optimize.js";

const SCAN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

async function main() {
  const dbPath = getDefaultDbPath();
  const claudeDir = process.env.CLAUDE_DATA_DIR ||
    `${process.env.HOME || process.env.USERPROFILE}/.claude`;

  const db = createConnection(dbPath);
  runMigrations(db);
  seedPricing(db);

  // Retroactively classify existing sessions
  classifyAllSessions(db);

  // Initial scan
  await scanForNewSessions(db, claudeDir);

  // Periodic scan
  setInterval(async () => {
    try {
      await scanForNewSessions(db, claudeDir);
    } catch (err) {
      process.stderr.write(`[codeledger] Scanner error: ${err}\n`);
    }
  }, SCAN_INTERVAL_MS);

  // Create MCP server
  const server = new McpServer({
    name: "codeledger",
    version: pkg.version,
  });

  // Register Phase A tools
  registerUsageSummary(server, db);
  registerProjectUsage(server, db);
  registerModelStats(server, db);

  // Register Phase B tools
  registerAgentUsage(server, db);
  registerSkillUsage(server, db);

  // Register Phase C tools
  registerCostOptimize(server, db);

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`[codeledger] Fatal: ${err}\n`);
  process.exit(1);
});
