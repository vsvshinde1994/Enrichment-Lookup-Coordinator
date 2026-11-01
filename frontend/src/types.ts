export type RequestStatus =
  | 'QUEUED'
  | 'LEASED'
  | 'EXECUTING'
  | 'COMPLETED'
  | 'EXPIRED'
  | 'FAILED';

export interface VerdictResult {
  verdict: 'clean' | 'suspicious' | 'malicious';
  confidence: number;
  details: string;
  analyzedAt: string;
  provider: string;
}

export interface EnrichmentRequest {
  id: string;
  analystId: string;
  indicator: string;
  normalizedIndicator: string;
  status: RequestStatus;
  queuePosition: number | null;
  relativeQueuePosition?: number;
  leaseAcquiredAt: string | null;
  leaseExpiresAt: string | null;
  leaseSecondsRemaining?: number | null;
  verdict: VerdictResult | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DailyQuota {
  quotaDate: string;
  maxLimit: number;
  reservedCount: number;
  consumedCount: number;
  availableCount: number;
  queuedCount: number;
}

