#!/usr/bin/env node

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pkg = require("../package.json");

const command = process.argv[2];

if (command === "dashboard") {
  import("./dashboard/server.js");
} else if (command === "--version" || command === "-v") {
  console.log(pkg.version);
} else {
  console.log(`CodeLedger v${pkg.version} — Token-level cost intelligence

Usage:
  codeledger dashboard [--port 4321]   Start the local dashboard
  codeledger --version, -v             Show version
  codeledger --help                    Show this help

The MCP server and hooks start automatically when installed as a Claude Code plugin.`);
  if (command && command !== "--help" && command !== "-h") {
    console.error(`\nUnknown command: ${command}`);
    process.exit(1);
  }
}
