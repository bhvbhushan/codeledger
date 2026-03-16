You have access to CodeLedger analytics tools. Present a smart usage summary.

Rules:
1. Call the `usage_summary` tool with period="today" first.
2. If the user is currently in a project, also call `project_usage` filtered to that project.
3. Present the data in a clean, scannable format:
   - Total cost today (highlight if > $5)
   - Token breakdown (input vs output vs cache)
   - Top project by cost
   - Model distribution (% opus vs sonnet vs haiku)
4. Keep it concise — 10-15 lines max.
5. If cost seems high, mention they can ask for optimization tips.

Do NOT show raw numbers without context. Always show cost in USD alongside token counts.
