export const PHASE_C_CATEGORY_SCHEMA = `
ALTER TABLE sessions ADD COLUMN category TEXT DEFAULT 'mixed';

CREATE INDEX IF NOT EXISTS idx_sessions_category ON sessions(category);
`;
