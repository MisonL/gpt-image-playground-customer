CREATE TABLE IF NOT EXISTS agent_requests (
    request_id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    request_hash TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('generate', 'edit')),
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'orphaned')),
    request_json TEXT NOT NULL,
    response_json TEXT,
    error_json TEXT,
    locked_until TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_requests_status_locked_until ON agent_requests(status, locked_until);
CREATE INDEX IF NOT EXISTS idx_agent_requests_expires_at ON agent_requests(expires_at);

CREATE TABLE IF NOT EXISTS agent_artifacts (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL,
    filename TEXT NOT NULL UNIQUE,
    filepath TEXT NOT NULL,
    content_url TEXT NOT NULL,
    metadata_url TEXT NOT NULL,
    output_format TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    width INTEGER,
    height INTEGER,
    model TEXT NOT NULL,
    prompt_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(request_id) REFERENCES agent_requests(request_id)
);
CREATE INDEX IF NOT EXISTS idx_agent_artifacts_request_id ON agent_artifacts(request_id);

CREATE TABLE IF NOT EXISTS agent_recovery_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    details_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS image_shares (
    token TEXT PRIMARY KEY,
    source_filename TEXT NOT NULL,
    content_filename TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    access_code_required INTEGER NOT NULL CHECK (access_code_required IN (0, 1)),
    expires_at TEXT,
    access_code_salt TEXT,
    access_code_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_image_shares_expires_at ON image_shares(expires_at);
