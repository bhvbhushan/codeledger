import { createConnection, getDefaultDbPath } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";
import { seedPricing } from "../db/pricing.js";
import type Database from "better-sqlite3";

export function initHookDb(dbPath?: string): Database.Database {
  const resolved = dbPath ?? getDefaultDbPath();
  const db = createConnection(resolved);
  runMigrations(db, resolved);
  seedPricing(db);
  return db;
}
