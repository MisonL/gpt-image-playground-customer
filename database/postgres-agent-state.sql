CREATE TABLE IF NOT EXISTS state_schema_migrations (
    id TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_requests (
    request_id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    request_hash TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('generate', 'edit')),
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'orphaned')),
    request_json JSONB NOT NULL,
    response_json JSONB,
    error_json JSONB,
    locked_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_requests_status_locked_until ON agent_requests(status, locked_until);
CREATE INDEX IF NOT EXISTS idx_agent_requests_expires_at ON agent_requests(expires_at);

CREATE TABLE IF NOT EXISTS agent_artifacts (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL REFERENCES agent_requests(request_id),
    filename TEXT NOT NULL UNIQUE,
    filepath TEXT NOT NULL,
    content_url TEXT NOT NULL,
    metadata_url TEXT NOT NULL,
    output_format TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    width INTEGER,
    height INTEGER,
    model TEXT NOT NULL,
    prompt_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_artifacts_request_id ON agent_artifacts(request_id);

CREATE TABLE IF NOT EXISTS agent_recovery_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    details_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS image_shares (
    token TEXT PRIMARY KEY,
    source_filename TEXT NOT NULL,
    content_filename TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    access_code_required BOOLEAN NOT NULL,
    expires_at TIMESTAMPTZ,
    access_code_salt TEXT,
    access_code_hash TEXT,
    CHECK (
        (access_code_required = FALSE AND access_code_salt IS NULL AND access_code_hash IS NULL)
        OR (access_code_required = TRUE AND access_code_salt IS NOT NULL AND access_code_hash IS NOT NULL)
    )
);
CREATE INDEX IF NOT EXISTS idx_image_shares_expires_at ON image_shares(expires_at);

CREATE TABLE IF NOT EXISTS result_feedback (
    target_type TEXT NOT NULL CHECK (target_type IN ('page_request', 'agent_request', 'agent_artifact')),
    target_id TEXT NOT NULL,
    value TEXT NOT NULL CHECK (value IN ('usable', 'needs_revision')),
    note TEXT,
    source TEXT NOT NULL CHECK (source IN ('webui', 'agent')),
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_result_feedback_updated_at ON result_feedback(updated_at);
