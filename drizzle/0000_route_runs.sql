CREATE TABLE IF NOT EXISTS route_runs (
  run_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  bootstrap_id TEXT,
  label TEXT NOT NULL,
  flow_json TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  events_json TEXT NOT NULL,
  revision INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  mutation_owner TEXT,
  mutation_expires_at INTEGER
);
