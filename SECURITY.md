# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in CodeLedger, please report it responsibly.

**Do NOT open a public issue.** Use one of these methods:

1. **GitHub private vulnerability reporting** — [Report a vulnerability](https://github.com/bhvbhushan/codeledger/security/advisories/new)
2. **Email** — bhvbhushan@gmail.com with subject "CodeLedger Security"

## What to Expect

- **Acknowledgment** within 48 hours
- **Assessment** within 7 days
- **Fix target** within 14 days for critical issues
- **Credit** in release notes (unless you prefer anonymity)

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest (0.x) | Yes |

## Scope

This policy covers:
- The `codeledger` npm package
- The CodeLedger GitHub repository
- JSONL parsing logic (path traversal, arbitrary file read)
- SQLite query construction (injection)
- Dashboard HTML rendering (XSS)
- Hook handler input processing

## Out of Scope

- Bugs in Claude Code itself (report to [Anthropic](https://github.com/anthropics/claude-code/issues))
- Bugs in dependencies (report upstream)
- Feature requests (use [Issues](https://github.com/bhvbhushan/codeledger/issues))
- Cosmetic issues

## Security Model

CodeLedger is a **local-only** tool:
- All data stays in `~/.codeledger/` — zero network calls (free tier)
- SQLite database created with `0600` permissions (owner read/write only)
- Database directory created with `0700` permissions
- No authentication required — same trust model as Claude Code itself
- MCP server uses stdio transport (no network listener)
- Dashboard serves on localhost only
