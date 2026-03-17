import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
    dashboard: "src/dashboard/server.ts",
    "hooks/on-session-end": "src/hooks/on-session-end.ts",
    "hooks/on-subagent-stop": "src/hooks/on-subagent-stop.ts",
    "hooks/on-skill-use": "src/hooks/on-skill-use.ts",
    "hooks/on-stop": "src/hooks/on-stop.ts",
  },
  format: ["esm"],
  target: "node18",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  external: ["better-sqlite3"],
});
