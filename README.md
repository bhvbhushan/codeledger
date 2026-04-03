# CodeLedger

**Token-level cost intelligence for AI coding tools.**

[![npm version](https://img.shields.io/npm/v/codeledger)](https://www.npmjs.com/package/codeledger)
[![license](https://img.shields.io/npm/l/codeledger)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/node/v/codeledger)](https://nodejs.org/)

CodeLedger is a Claude Code plugin that tracks where your AI coding tokens go — per-project, per-agent, per-skill — across Claude Code, Codex CLI, Cline, and Gemini CLI. It separates your actual coding work from background plugin overhead, sets budget alerts, and detects spend anomalies. Ask questions conversationally via MCP tools, or browse the local dashboard.

### Setup & MCP Tools
![CodeLedger Setup](demo/codeledger-setup.gif)

### Dashboard
![CodeLedger Dashboard](demo/codeledger-dashboard.gif)

## Why CodeLedger?

Running Claude Code agents can burn through tokens fast. A single session with 49 parallel subagents can cost $8,000-$15,000. But you have zero visibility into:

- Which **project** costs the most?
- Which **agent** burned the most tokens?
- How much is **plugin overhead** (claude-mem observers, auto-compaction) vs your actual work?
- Are you using **Opus for tasks that Sonnet handles just as well**?
- Am I going to **blow my budget** this month?
- How much am I spending across **all my AI coding tools**?

No existing tool answers these questions. CodeLedger does.

## What Makes It Different

| Capability | ccusage | Agentlytics | tokscale | **CodeLedger** |
|---|---|---|---|---|
| Per-project tracking | Yes | Yes | No | **Yes** |
| Per-agent token breakdown | No | No | No | **Yes** |
| Per-skill attribution | No | No | No | **Yes (~estimated)** |
| User vs overhead cost split | No | No | No | **Yes** |
| Session category classification | No | No | No | **Yes** |
| Cost optimization recommendations | No | No | No | **Yes** |
| Budget alerts & anomaly detection | No | No | No | **Yes** |
| Multi-tool cost tracking | No | Yes (16+) | Yes (16+) | **Yes (4 tools)** |
| Conversational querying via MCP | No | No | No | **Yes** |
| Local web dashboard | No | Yes | No | **Yes** |
| Runs as Claude Code plugin | No | No | No | **Yes** |

## Quick Start

### Install from npm

```bash
npm install -g codeledger
```

### Run Claude Code with the plugin

**macOS / Linux:**
```bash
claude --plugin-dir $(npm root -g)/codeledger
```

**Windows (PowerShell):**
```powershell
claude --plugin-dir "$(npm root -g)\codeledger"
```

**Windows (CMD):**
```cmd
for /f "delims=" %i in ('npm root -g') do claude --plugin-dir "%i\codeledger"
```

This loads **everything** — 9 MCP tools, 4 hooks (real-time tracking), and slash commands.

> **Anthropic Plugin Marketplace:** CodeLedger has been submitted to the [official Claude Code plugin directory](https://github.com/anthropics/claude-plugins-official) and is **pending approval**. Once approved, installation will be simply:
> ```
> /plugin install codeledger
> ```
> Until then, use the npm install method above.

### Start the dashboard

```bash
npx codeledger dashboard
```

Opens a local dashboard at `http://localhost:4321` with charts, tables, and drill-downs.

### Install from source (development)

```bash
git clone https://github.com/bhvbhushan/codeledger.git
cd codeledger && npm install && npm run build
claude --plugin-dir .
```

## Features

### 9 MCP Tools (conversational querying)

Ask Claude directly — no dashboards needed:

- **`usage_summary`** — "How much have I spent today?" (includes spend velocity + budget status)
- **`project_usage`** — "Which project costs the most?"
- **`model_stats`** — "What's my model distribution?"
- **`agent_usage`** — "Which agents burned the most tokens?"
- **`skill_usage`** — "How much does brainstorming cost vs code review?" (~estimated)
- **`cost_optimize`** — "How can I reduce my costs?" (6 evidence-based rules including anomaly detection)
- **`budget_set`** — "Set my monthly budget to $200"
- **`budget_status`** — "Am I on track for my budget?" (utilization + projected overshoot)
- **`cross_tool_cost`** — "How much am I spending across all my AI tools?"

### User vs Overhead Classification

CodeLedger automatically separates your actual coding work from background noise:

```
This Week — $142.62
  Your coding agents:     $122.76 (86%)
  Background overhead:     $19.87 (14%)
    Plugin observers (acompact-*)
    System agents (aprompt_suggestion-*)
```

Zero configuration. Works by detecting agent ID prefixes — a structural signal present in all Claude Code versions.

### Session Categories (auto-classified)

Every session is classified by what kind of work it does, based on tool usage patterns:

| Category | Signal |
|----------|--------|
| **generation** | Write + Edit > 40% of tool calls |
| **exploration** | Read + Grep + Glob > 60% |
| **debugging** | Bash + Edit combos |
| **review** | Read-heavy, no Write/Edit |
| **planning** | Agent delegation dominant |
| **devops** | Bash-heavy, no editing |
| **mixed** | No dominant pattern |

Classification is heuristic (~70-80% accuracy). Always labeled "auto-categorized."

### Cost Optimization

Evidence-based recommendations with dollar amounts:

```
1. Opus used for exploration-only sessions
   12 sessions spent $45.00 using Opus just for Read/Grep/Glob
   Recommendation: Use Sonnet — same quality at 1/5 the price
   Potential savings: ~$36.00

2. Background plugin overhead exceeds 15%
   $19.87 spent on overhead agents (14% of total)
   Recommendation: Review active plugin configuration
   Potential savings: ~$9.94
```

### Budget Alerts & Anomaly Detection

Set per-project or total budgets and get proactive warnings:

```
## Budget Status (monthly, Apr 1 - Apr 30)
| Scope | Budget | Spent | %   | Projected | Status              |
|-------|--------|-------|-----|-----------|---------------------|
| Total | $200   | $142  | 71% | $215      | ⚠️ Projected overshoot |
| myapp | $75    | $68   | 91% | $102      | ⚠️ Near limit        |
```

Anomaly detection flags unusual spend spikes automatically:

```
6. Daily spend anomaly detected
   Today's $25.40 is 3.2x your 30-day average of $7.80
   Recommendation: Check for runaway agents or model upgrades
```

Budget alerts fire via stderr when a session ends and spend exceeds 75% of budget.

### Multi-Tool Cost Tracking

Track spend across Claude Code, Codex CLI, Cline, and Gemini CLI — all from local session files, zero API keys needed:

```
## Cross-Tool Cost (month)
| Tool        | Sessions | Cost    | Tokens |
|-------------|----------|---------|--------|
| claude-code | 45       | $142.50 | 15.7M  |
| codex-cli   | 12       | $23.40  | 2.9M   |
| gemini-cli  | 8        | $15.20  | 2.4M   |
| Total       | 65       | $181.10 | 21.0M  |
```

Collectors auto-detect installed tools and parse their local data directories. Existing Claude Code analytics stay isolated — multi-tool data only appears in `cross_tool_cost`.

### Local Dashboard

Dark-themed web dashboard at `localhost:4321`:

- **Overview** — KPI cards, daily spend chart (user vs overhead), model distribution pie chart, top projects
- **Projects** — per-project table with drill-down to sessions and agents
- **Agents** — filter by user/overhead, click project to see its agents
- **Skills** — per-skill estimated token attribution
- **Optimize** — actionable cost reduction recommendations

## How It Works

```
~/.claude/projects/*/              Claude Code JSONL session files
         │
         ├── SessionEnd hook ──────── Parses JSONL + budget alerts
         ├── SubagentStop hook ────── Parses agent JSONL files
         ├── PostToolUse hook ─────── Logs skill invocations
         └── Background scanner ───── Catches missed sessions (every 5 min)
                    │
~/.codex/sessions/  │  Codex CLI JSONL ──── Codex collector
~/.gemini/tmp/      │  Gemini CLI JSON ──── Gemini collector
~/.vscode/.../cline │  Cline task JSON ──── Cline collector
                    │
                    ▼
         ~/.codeledger/codeledger.db   SQLite (WAL mode)
                    │
          ┌─────────┼──────────┐
          ▼         ▼          ▼
      MCP Tools  Dashboard  Classifier
     (9 tools)  (:4321)   (categories)
```

All data stays local. Zero network calls. The SQLite database at `~/.codeledger/codeledger.db` is readable, exportable, and deletable at any time.

## Configuration

| Environment Variable | Default | Purpose |
|---------------------|---------|---------|
| `CODELEDGER_DB_PATH` | `~/.codeledger/codeledger.db` | Database location |
| `CLAUDE_DATA_DIR` | `~/.claude` | Claude Code data directory |

Dashboard port: `npx codeledger dashboard --port 8080`

## Development

```bash
git clone https://github.com/bhvbhushan/codeledger.git
cd codeledger
npm install
npm run build     # tsup: src/ → dist/
npm test          # vitest (170 tests)
npm run lint      # tsc --noEmit
npm run dev       # tsup --watch
```

## Privacy

- **100% local.** All data stays in `~/.codeledger/`. Zero network calls.
- **Read-only parsing.** CodeLedger reads JSONL files but never modifies them.
- **No code or prompts stored.** Only aggregated metrics: token counts, costs, model names, tool names.
- **User-owned data.** Delete `~/.codeledger/` at any time to remove all data.

## Roadmap

- [x] Per-project and per-session tracking
- [x] Per-agent token breakdown with overhead classification
- [x] Per-skill estimated token attribution
- [x] Session category classification
- [x] Cost optimization recommendations
- [x] Local web dashboard
- [x] Budget alerts and anomaly detection
- [x] Multi-tool support (Codex CLI, Cline, Gemini CLI)
- [ ] Team dashboard (hosted, multi-user aggregation)

## Contributing

Contributions are welcome! Please read the [Contributing Guidelines](./CONTRIBUTING.md) before submitting a PR.

- **Bug reports** and **feature requests** — use [Issue Templates](https://github.com/bhvbhushan/codeledger/issues/new/choose)
- **Questions** — use [GitHub Discussions](https://github.com/bhvbhushan/codeledger/discussions)
- **Security vulnerabilities** — see [Security Policy](./SECURITY.md)

All contributors are expected to follow the [Code of Conduct](./CODE_OF_CONDUCT.md).

## License

[MIT](./LICENSE)
