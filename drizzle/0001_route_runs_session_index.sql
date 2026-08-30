CREATE INDEX IF NOT EXISTS route_runs_session_updated_idx
ON route_runs (session_id, updated_at DESC);
