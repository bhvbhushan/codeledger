import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createConnection, getDefaultDbPath } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";
import { seedPricing } from "../db/pricing.js";
import { registerApiRoutes } from "./routes.js";
import { getStaticHtml, getStaticJs, getStaticCss } from "./static-assets.js";

const app = new Hono();

const dbPath = process.env.CODELEDGER_DB_PATH || getDefaultDbPath();
const db = createConnection(dbPath);
runMigrations(db);
seedPricing(db);

// API routes
registerApiRoutes(app, db);

// Static files
app.get("/", (c) => c.html(getStaticHtml()));
app.get("/app.js", (c) => {
  c.header("Content-Type", "application/javascript");
  return c.body(getStaticJs());
});
app.get("/style.css", (c) => {
  c.header("Content-Type", "text/css");
  return c.body(getStaticCss());
});

const port = parseInt(
  process.argv.find((a, i) => process.argv[i - 1] === "--port") ?? "4321",
  10,
);

serve({ fetch: app.fetch, port }, (info) => {
  const url = `http://localhost:${info.port}`;
  console.log(`CodeLedger Dashboard running at ${url}`);

  // Auto-open browser
  import("child_process").then(({ exec }) => {
    const cmd =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "start"
          : "xdg-open";
    exec(`${cmd} ${url}`);
  });
});
