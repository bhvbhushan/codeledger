import type Database from "better-sqlite3";
import { PHASE_A_SCHEMA } from "./schema.js";

interface Migration {
  version: number;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  { version: 1, sql: PHASE_A_SCHEMA },
  // Phase B will add: { version: 2, sql: PHASE_B_SCHEMA }
];

export function runMigrations(db: Database.Database): void {
  // Ensure schema_version table exists (bootstrap)
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const currentVersion =
    (
      db
        .prepare("SELECT MAX(version) as v FROM schema_version")
        .get() as any
    )?.v ?? 0;

  for (const migration of MIGRATIONS) {
    if (migration.version > currentVersion) {
      db.transaction(() => {
        db.exec(migration.sql);
        db.prepare(
          "INSERT INTO schema_version (version, applied_at) VALUES (?, ?)"
        ).run(migration.version, new Date().toISOString());
      })();
    }
  }
}
