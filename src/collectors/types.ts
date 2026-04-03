import type Database from "better-sqlite3";

export interface CollectorResult {
  sessionsAdded: number;
  errors: number;
}

export interface Collector {
  tool: string;
  provider: string;
  findDataFiles(): string[];
  validateFormat(data: unknown): { valid: boolean; version?: string; warning?: string };
  parseFile(db: Database.Database, filePath: string): Promise<CollectorResult>;
}
