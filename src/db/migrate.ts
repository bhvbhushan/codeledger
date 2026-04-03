import type Database from "better-sqlite3";
import { copyFileSync, unlinkSync, existsSync } from "fs";
import { PHASE_A_SCHEMA } from "./schema.js";
import { PHASE_B_SCHEMA } from "./schema-v2.js";
import { PHASE_B_CATEGORY_SCHEMA } from "./schema-v3.js";
import { PHASE_C_CATEGORY_SCHEMA } from "./schema-v4.js";

interface Migration {
  version: number;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  { version: 1, sql: PHASE_A_SCHEMA },
  { version: 2, sql: PHASE_B_SCHEMA },
  { version: 3, sql: PHASE_B_CATEGORY_SCHEMA },
  { version: 4, sql: PHASE_C_CATEGORY_SCHEMA },
];

/** Check whether a column already exists on a table. */
function columnExists(
  db: Database.Database,
  table: string,
  column: string,
): boolean {
  const cols = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  return cols.some((c) => c.name === column);
}

/**
 * Apply ALTER TABLE statements only when the target column does not yet exist.
 * Returns the SQL with already-applied ALTER TABLE lines stripped.
 */
function safeguardAlterTable(db: Database.Database, sql: string): string {
  return sql
    .split("\n")
    .filter((line) => {
      const match = line.match(
        /^\s*ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)/i,
      );
      if (!match) return true;
      return !columnExists(db, match[1], match[2]);
    })
    .join("\n");
}

export function runMigrations(db: Database.Database, dbPath?: string): void {
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

  const pendingMigrations = MIGRATIONS.filter(
    (m) => m.version > currentVersion,
  );

  if (pendingMigrations.length === 0) return;

  // Backup before migration
  if (dbPath && existsSync(dbPath)) {
    try {
      copyFileSync(dbPath, dbPath + ".bak");
    } catch (err) {
      process.stderr.write(
        `[codeledger] Warning: could not create backup: ${err}\n`,
      );
    }
  }

  try {
    for (const migration of pendingMigrations) {
      db.transaction(() => {
        const safeSql = safeguardAlterTable(db, migration.sql);
        db.exec(safeSql);
        db.prepare(
          "INSERT INTO schema_version (version, applied_at) VALUES (?, ?)",
        ).run(migration.version, new Date().toISOString());
      })();
    }

    // Cleanup backup on success
    if (dbPath && existsSync(dbPath + ".bak")) {
      try {
        unlinkSync(dbPath + ".bak");
      } catch {
        /* best-effort cleanup */
      }
    }
  } catch (err) {
    if (dbPath) {
      process.stderr.write(
        `[codeledger] Migration failed. Backup preserved at: ${dbPath}.bak\n`,
      );
    }
    throw err;
  }
}
