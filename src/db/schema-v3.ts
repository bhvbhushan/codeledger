export const PHASE_B_CATEGORY_SCHEMA = `
ALTER TABLE agents ADD COLUMN source_category TEXT DEFAULT 'user';

-- Retroactively classify existing agents by agentId prefix
-- Handles both raw (acompact-*) and filename-derived (agent-acompact-*) formats
UPDATE agents SET source_category = 'overhead' WHERE id LIKE '%acompact-%';
UPDATE agents SET source_category = 'overhead' WHERE id LIKE '%aprompt_suggestion-%';
UPDATE agents SET source_category = 'overhead' WHERE id LIKE '%aside_question-%';

CREATE INDEX IF NOT EXISTS idx_agents_source_category ON agents(source_category);
`;
