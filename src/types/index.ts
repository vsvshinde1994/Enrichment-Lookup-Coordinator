export type RequestStatus = 
  | 'QUEUED'
  | 'LEASED'
  | 'EXECUTING'
  | 'COMPLETED'
  | 'EXPIRED'
  | 'FAILED';

export type ThreatVerdict = 'clean' | 'suspicious' | 'malicious';

export interface VerdictResult {
  verdict: ThreatVerdict;
  confidence: number;
  details: string;
  analyzedAt: string;
  provider: string;
}

export interface DailyQuotaRow {
  quota_date: string;
  max_limit: number;
  reserved_count: number;
  consumed_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface DailyQuotaDTO {
  quotaDate: string;
  maxLimit: number;
  reservedCount: number;
  consumedCount: number;
  availableCount: number;
  queuedCount: number;
}

export interface EnrichmentRequestRow {
  id: string;
  analyst_id: string;
  idempotency_key: string;
  indicator: string;
  normalized_indicator: string;
  status: RequestStatus;
  quota_date?: string | Date;
  queue_position: string | number;
  lease_acquired_at: Date | null;
  lease_expires_at: Date | null;
  execution_started_at: Date | null;
  completed_at: Date | null;
  verdict: VerdictResult | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface EnrichmentResponseDTO {
  id: string;
  analystId: string;
  indicator: string;
  normalizedIndicator: string;
  status: RequestStatus;
  queuePosition: number | null;
  relativeQueuePosition?: number;
  leaseAcquiredAt: string | null;
  leaseExpiresAt: string | null;
  leaseSecondsRemaining: number | null;
  verdict: VerdictResult | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEnrichmentInput {
  analystId: string;
  idempotencyKey: string;
  indicator: string;
}

