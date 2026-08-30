CREATE UNIQUE INDEX IF NOT EXISTS route_runs_session_bootstrap_idx
ON route_runs (session_id, bootstrap_id)
WHERE bootstrap_id IS NOT NULL;
