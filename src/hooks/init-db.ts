import { createConnection, getDefaultDbPath } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";
import { seedPricing } from "../db/pricing.js";
import type Database from "better-sqlite3";

export function initHookDb(dbPath?: string): Database.Database {
  const db = createConnection(dbPath ?? getDefaultDbPath());
  runMigrations(db);
  seedPricing(db);
  return db;
}
