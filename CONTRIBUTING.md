# Contributing to CodeLedger

Contributions are welcome! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/bhvbhushan/codeledger.git
cd codeledger
npm install
npm run build     # tsup: src/ → dist/
npm test          # vitest (117 tests)
npm run lint      # tsc --noEmit
```

## Project Structure

```
src/
  parser/          # JSONL reading, message extraction, session/agent parsing
  db/              # SQLite connection, schema, migrations, queries, pricing
  classifier/      # Session category classification (heuristic)
  hooks/           # SessionEnd, SubagentStop, PostToolUse hook handlers
  sync/            # Background file scanner
  tools/           # MCP tool implementations (6 tools)
  dashboard/       # Hono HTTP server, REST API, static frontend
  utils/           # Shared utilities (period calculation)
tests/             # Mirrors src/ structure, vitest
```

## How to Contribute

1. **Check existing issues** — your idea may already be tracked
2. **Open an issue first** for large changes — discuss before coding
3. **Fork and branch** — create a feature branch from `main`
4. **Write tests** — all PRs must pass `npm test`
5. **Follow code style** — TypeScript strict mode, ESM, functional patterns
6. **Submit a PR** — fill out the PR template, target `main`

## Code Standards

- TypeScript strict mode (`"strict": true`)
- ESM (`"type": "module"`)
- Small, focused functions (<50 lines)
- Zod for validation at boundaries
- No `any` types — use proper interfaces
- Tests for all new functionality

## Before Submitting a PR

```bash
npm run lint      # Must pass — zero type errors
npm test          # Must pass — all tests green
npm run build     # Must succeed
```

## What We're Looking For

- Bug fixes with reproduction steps
- Performance improvements with benchmarks
- New MCP tools with tests
- Dashboard improvements
- Documentation improvements

## What to Avoid

- Large refactors without prior discussion in an issue
- PRs that don't include tests for new functionality
- Changes that break existing tests without justification
- Adding dependencies without strong justification

## Review Process

- PRs are reviewed by maintainers within a few days
- CI must pass before review
- One approval required for merge
- Squash merge to keep history clean

## Questions?

Use [GitHub Discussions](https://github.com/bhvbhushan/codeledger/discussions) for questions — not issues.
