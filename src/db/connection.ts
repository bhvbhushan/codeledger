import Database from "better-sqlite3";
import { mkdirSync, chmodSync, existsSync } from "fs";
import { dirname } from "path";

export function createConnection(dbPath: string): Database.Database {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  const db = new Database(dbPath);

  // Set pragmas for performance and safety
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  // Set file permissions to owner-only
  if (existsSync(dbPath)) {
    chmodSync(dbPath, 0o600);
  }

  return db;
}

export function getDefaultDbPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "~";
  return (
    process.env.CODELEDGER_DB_PATH || `${home}/.codeledger/codeledger.db`
  );
}
