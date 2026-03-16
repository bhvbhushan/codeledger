export const PHASE_B_SCHEMA = `
CREATE TABLE IF NOT EXISTS agents (
  id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  agent_type TEXT,
  description TEXT,
  model TEXT,
  total_input_tokens INTEGER DEFAULT 0,
  total_output_tokens INTEGER DEFAULT 0,
  total_cache_create_tokens INTEGER DEFAULT 0,
  total_cache_read_tokens INTEGER DEFAULT 0,
  total_cost_usd REAL DEFAULT 0.0,
  started_at TEXT,
  ended_at TEXT,
  message_count INTEGER DEFAULT 0,
  PRIMARY KEY (session_id, id)
);

CREATE TABLE IF NOT EXISTS skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT REFERENCES sessions(id),
  skill_name TEXT NOT NULL,
  invoked_at TEXT NOT NULL,
  est_input_tokens INTEGER,
  est_output_tokens INTEGER,
  est_cost_usd REAL,
  is_estimated BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_agents_session ON agents(session_id);
CREATE INDEX IF NOT EXISTS idx_agents_type ON agents(agent_type);
CREATE INDEX IF NOT EXISTS idx_skills_session ON skills(session_id);
CREATE INDEX IF NOT EXISTS idx_skills_name ON skills(skill_name);
CREATE INDEX IF NOT EXISTS idx_skills_invoked_at ON skills(invoked_at);
`;
