-- Schema for Enrichment Lookup Coordinator with Provider Quota

-- 1. Daily Quotas Table
CREATE TABLE IF NOT EXISTS daily_quotas (
    quota_date DATE PRIMARY KEY DEFAULT CURRENT_DATE,
    max_limit INT NOT NULL DEFAULT 10 CHECK (max_limit >= 0),
    reserved_count INT NOT NULL DEFAULT 0 CHECK (reserved_count >= 0),
    consumed_count INT NOT NULL DEFAULT 0 CHECK (consumed_count >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT quota_not_exceeded CHECK ((reserved_count + consumed_count) <= max_limit)
);

-- 2. Enrichment Requests Table
CREATE TABLE IF NOT EXISTS enrichment_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    analyst_id VARCHAR(64) NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL,
    indicator VARCHAR(255) NOT NULL,
    normalized_indicator VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'QUEUED' CHECK (
        status IN ('QUEUED', 'LEASED', 'EXECUTING', 'COMPLETED', 'EXPIRED', 'FAILED')
    ),
    quota_date DATE NOT NULL DEFAULT CURRENT_DATE,
    
    -- FIFO queue ordering using monotonic BIGINT identity sequence
    queue_position BIGINT GENERATED ALWAYS AS IDENTITY,
    
    -- Lease timing
    lease_acquired_at TIMESTAMPTZ,
    lease_expires_at TIMESTAMPTZ,
    
    -- Execution tracking & results
    execution_started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    verdict JSONB,
    error_message TEXT,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Idempotency per analyst
    CONSTRAINT uq_analyst_idempotency UNIQUE (analyst_id, idempotency_key)
);

-- Partial Unique Index: Only 1 active request per normalized indicator
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_normalized_indicator 
ON enrichment_requests (normalized_indicator) 
WHERE status IN ('QUEUED', 'LEASED', 'EXECUTING');

-- Queue FIFO order drain index
CREATE INDEX IF NOT EXISTS idx_queued_fifo 
ON enrichment_requests (queue_position ASC) 
WHERE status = 'QUEUED';

-- Expiration sweep index
CREATE INDEX IF NOT EXISTS idx_leased_expiry 
ON enrichment_requests (lease_expires_at ASC) 
WHERE status = 'LEASED';

-- Analyst lookup history index
CREATE INDEX IF NOT EXISTS idx_analyst_requests 
ON enrichment_requests (analyst_id, created_at DESC);
