#!/usr/bin/env node

const command = process.argv[2];

if (command === "dashboard") {
  // Forward all remaining args to the dashboard server
  import("./dashboard/server.js");
} else {
  console.log(`CodeLedger — Token-level cost intelligence

Usage:
  codeledger dashboard [--port 4321]   Start the local dashboard
  codeledger --help                    Show this help

The MCP server and hooks start automatically when installed as a Claude Code plugin.`);
  if (command && command !== "--help" && command !== "-h") {
    console.error(`\nUnknown command: ${command}`);
    process.exit(1);
  }
}
