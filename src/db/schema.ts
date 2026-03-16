export const PHASE_A_SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  cwd TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_active TEXT NOT NULL,
  total_input_tokens INTEGER DEFAULT 0,
  total_output_tokens INTEGER DEFAULT 0,
  total_cache_create_tokens INTEGER DEFAULT 0,
  total_cache_read_tokens INTEGER DEFAULT 0,
  total_cost_usd REAL DEFAULT 0.0
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  end_reason TEXT,
  primary_model TEXT,
  claude_version TEXT,
  git_branch TEXT,
  total_input_tokens INTEGER DEFAULT 0,
  total_output_tokens INTEGER DEFAULT 0,
  total_cache_create_tokens INTEGER DEFAULT 0,
  total_cache_read_tokens INTEGER DEFAULT 0,
  total_cost_usd REAL DEFAULT 0.0,
  message_count INTEGER DEFAULT 0,
  tool_use_count INTEGER DEFAULT 0,
  agent_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS token_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT REFERENCES sessions(id),
  message_id TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_create_tokens INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0,
  cost_usd REAL NOT NULL,
  timestamp TEXT NOT NULL,
  UNIQUE(session_id, message_id)
);

CREATE TABLE IF NOT EXISTS tool_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT REFERENCES sessions(id),
  tool_name TEXT NOT NULL,
  call_count INTEGER DEFAULT 0,
  UNIQUE(session_id, tool_name)
);

CREATE TABLE IF NOT EXISTS sync_state (
  file_path TEXT PRIMARY KEY,
  file_size INTEGER NOT NULL,
  last_modified TEXT NOT NULL,
  last_parsed_at TEXT NOT NULL,
  lines_parsed INTEGER NOT NULL,
  status TEXT DEFAULT 'complete'
);

CREATE TABLE IF NOT EXISTS daily_summaries (
  date TEXT NOT NULL,
  project_id INTEGER REFERENCES projects(id),
  model TEXT NOT NULL,
  total_input_tokens INTEGER DEFAULT 0,
  total_output_tokens INTEGER DEFAULT 0,
  total_cost_usd REAL DEFAULT 0.0,
  session_count INTEGER DEFAULT 0,
  agent_count INTEGER DEFAULT 0,
  PRIMARY KEY (date, project_id, model)
);

CREATE TABLE IF NOT EXISTS model_pricing (
  model_pattern TEXT PRIMARY KEY,
  input_per_mtok REAL NOT NULL,
  output_per_mtok REAL NOT NULL,
  cache_create_per_mtok REAL,
  cache_read_per_mtok REAL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_token_usage_session ON token_usage(session_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_timestamp ON token_usage(timestamp);
CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id);
CREATE INDEX IF NOT EXISTS idx_daily_summaries_date ON daily_summaries(date);
CREATE INDEX IF NOT EXISTS idx_daily_summaries_project ON daily_summaries(project_id);
CREATE INDEX IF NOT EXISTS idx_sync_state_status ON sync_state(status);
`;
