export const PHASE_E2_MULTI_TOOL_SCHEMA = `
ALTER TABLE sessions ADD COLUMN tool TEXT NOT NULL DEFAULT 'claude-code';
ALTER TABLE sessions ADD COLUMN provider TEXT NOT NULL DEFAULT 'anthropic';
CREATE INDEX IF NOT EXISTS idx_sessions_tool ON sessions(tool);
`;
