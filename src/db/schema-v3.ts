export const PHASE_B_CATEGORY_SCHEMA = `
ALTER TABLE agents ADD COLUMN source_category TEXT DEFAULT 'user';
CREATE INDEX IF NOT EXISTS idx_agents_source_category ON agents(source_category);
`;
