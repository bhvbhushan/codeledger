Start the CodeLedger dashboard by running the following command in the terminal:

```bash
npx codeledger dashboard
```

This opens a local web dashboard at http://localhost:4321 with:
- Overview: total spend, user vs overhead split, daily cost chart, model distribution
- Projects: per-project breakdown with session drill-down
- Agents: per-agent table with user/overhead filtering, click project to see its agents
- Skills: per-skill estimated token usage (~estimated)

The dashboard reads from the same local database as the MCP tools. No data leaves your machine.
