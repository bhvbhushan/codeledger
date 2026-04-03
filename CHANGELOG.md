# Changelog

All notable changes to CodeLedger are documented here.

## [0.3.2] - 2026-04-03

### Fixed
- Publish workflow: add OIDC token clearing step for Trusted Publisher auth (was using empty token placeholder instead of OIDC, causing 404 on publish)
- Publish workflow: restore `npm install -g npm@latest` for OIDC support, add `workflow_dispatch` trigger

### Added
- CHANGELOG.md covering all releases from 0.1.0 through 0.3.0

## [0.3.0] - 2026-04-03

### Added
- **Budget system** — `budget_set` and `budget_status` MCP tools with per-project and total budgets (daily/weekly/monthly)
- **Anomaly detection** — Rule 6 in `cost_optimize` flags unusual spend spikes via z-score on 30-day daily baseline
- **Budget alerts** — proactive stderr warnings when session ends and spend exceeds 75% of budget
- **Budget context in `usage_summary`** — one-liner showing budget utilization when a monthly budget is set
- **Multi-tool collectors** — local file parsers for Codex CLI (`~/.codex/sessions/`), Cline (VS Code extension storage), and Gemini CLI (`~/.gemini/tmp/`)
- **`cross_tool_cost` MCP tool** — spend breakdown across all AI coding tools
- **OpenAI and Gemini model pricing** — o3-mini, o4-mini, gpt-4o, gpt-4.1, gpt-4.1-mini, gemini-2.5-pro, gemini-2.5-flash
- Schema v5 (budgets table) and v6 (tool + provider columns on sessions)
- 32 new tests (170 total)

### Changed
- All existing MCP tools and dashboard queries now filter by `tool = 'claude-code'` to isolate Claude Code analytics from multi-tool data
- `daily_summaries` upsert is now idempotent (recalculates from sessions instead of incrementing)
- Calendar-aligned budget periods (1st of month, Monday of week) distinct from rolling windows in existing tools

## [0.2.6] - 2026-04-03

### Added
- **Spend velocity and projection** — `usage_summary` shows $/day and projected monthly spend
- **Cache efficiency monitoring** — Rule 5 in `cost_optimize` detects silent cache ratio drops (>50% from baseline)
- **Costliest session** — `usage_summary` surfaces the highest-cost session per period
- **Migration rollback safety** — automatic backup before schema migrations, preserved on failure
- **MCP quality gate 100/100** — `.describe()` on all Zod parameters

### Changed
- Dashboard `/api/projects` uses batch queries instead of N+1 (3 queries instead of 2N)
- `limit` parameter on `project_usage` bounded to 1-100
- `cost_optimize` period enum includes "today"

## [0.2.5] - 2026-03-17

### Changed
- Clarify Anthropic plugin marketplace submission is pending approval
- Add demo video to README

## [0.2.4] - 2026-03-17

### Added
- **Full token breakdown** in `project_usage` tool and dashboard drill-down — shows cache read/write/input/output costs separately
- **Real-time session tracking** via Stop hook — tracks tokens during active sessions, not just on completion

### Fixed
- Stop hook preserves `end_reason` and `category` set by SessionEnd (uses INSERT ON CONFLICT UPDATE instead of REPLACE)

## [0.2.3] - 2026-03-16

### Changed
- Centralize version and pricing constants (no more hardcoded values)
- Add GitHub Actions publish workflow

### Fixed
- Correct hardcoded Opus rates in dashboard breakdown bar

## [0.2.2] - 2026-03-16

### Added
- `--version` and `-v` CLI flags

### Fixed
- Correct model pricing — Opus 4.6 is $5/$25 not $15/$75

## [0.2.1] - 2026-03-16

### Added
- **Full token breakdown** showing cache read/write costs in usage summary

## [0.2.0] - 2026-03-16

### Added
- **Real-time session tracking** via Stop hook — tokens tracked during active sessions
- Contributing guidelines, security policy, code of conduct
- CI workflow for linting and testing

### Fixed
- Installation instructions — use `--plugin-dir` instead of `mcp add`

## [0.1.0] - 2026-03-15

### Added
- **Phase A** — Per-project/session tracking, 3 MCP tools (`usage_summary`, `project_usage`, `model_stats`), SessionEnd hook, background scanner, SQLite with WAL mode
- **Phase B** — Per-agent and per-skill tracking (`agent_usage`, `skill_usage`), SubagentStop and PostToolUse hooks, overhead classification (user vs background agents)
- **Phase C** — Session category classification (7 types), `cost_optimize` tool with 4 evidence-based rules
- **Local dashboard** at localhost:4321 — Overview, Projects, Agents, Skills, Optimize tabs
- Plugin manifest for Claude Code marketplace
