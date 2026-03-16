You have access to CodeLedger analytics tools. Present a smart usage summary.

Rules:
1. Call the `usage_summary` tool with period="today" first.
2. If the user is currently in a project, also call `project_usage` filtered to that project.
3. Call `agent_usage` with period="today" to check for agent activity.
4. Call `skill_usage` with period="today" to check for skill activity.
5. Present the data in a clean, scannable format:
   - Total cost today (highlight if > $5)
   - Token breakdown (input vs output vs cache)
   - Top project by cost
   - Model distribution (% opus vs sonnet vs haiku)
   - If agents were used, show agent count and top agents by cost
   - If skills were used, show skill invocations and estimated cost (mark as ~estimated)
6. Keep it concise — 15-20 lines max.
7. If cost seems high, mention they can ask for optimization tips.

Do NOT show raw numbers without context. Always show cost in USD alongside token counts.
Skill token estimates are always approximate — always label them as ~estimated.
