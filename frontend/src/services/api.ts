import { DailyQuota, EnrichmentRequest } from '../types.js';

const API_BASE = '/api';

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    let errorMsg = res.statusText || 'An unexpected error occurred';
    let code: string | undefined = data?.code;

    if (data?.error) {
      if (typeof data.error === 'string') {
        errorMsg = data.error;
      } else if (typeof data.error === 'object' && data.error !== null) {
        errorMsg = data.error.message || errorMsg;
        code = data.error.code || code;
      }
    } else if (data?.message) {
      errorMsg = data.message;
    }

    throw new ApiError(res.status, errorMsg, code);
  }
  return data as T;
}

export async function fetchQuota(): Promise<DailyQuota> {
  const res = await fetch(`${API_BASE}/quota`);
  return handleResponse<DailyQuota>(res);
}

export async function fetchRequests(analystId?: string): Promise<EnrichmentRequest[]> {
  const url = analystId
    ? `${API_BASE}/enrichments?analystId=${encodeURIComponent(analystId)}`
    : `${API_BASE}/enrichments`;
  const res = await fetch(url);
  return handleResponse<EnrichmentRequest[]>(res);
}

export async function createEnrichment(
  analystId: string,
  indicator: string,
  idempotencyKey?: string
): Promise<EnrichmentRequest> {
  const key = idempotencyKey || `ui-${analystId}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const res = await fetch(`${API_BASE}/enrichments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-analyst-id': analystId,
    },
    body: JSON.stringify({ indicator, analystId, idempotencyKey: key }),
  });
  return handleResponse<EnrichmentRequest>(res);
}

export async function executeLookup(requestId: string, analystId: string): Promise<EnrichmentRequest> {
  const res = await fetch(`${API_BASE}/enrichments/${requestId}/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-analyst-id': analystId,
    },
  });
  return handleResponse<EnrichmentRequest>(res);
}

export async function triggerReconciliation(): Promise<{ expiredCount: number; promotedCount: number }> {
  const res = await fetch(`${API_BASE}/enrichments/maintenance/reconcile`, {
    method: 'POST',
  });
  return handleResponse<{ expiredCount: number; promotedCount: number }>(res);
}

