import React, { useState, useEffect, useCallback, useRef } from 'react';
import { DailyQuota, EnrichmentRequest } from './types.js';
import {
  fetchQuota,
  fetchRequests,
  createEnrichment,
  executeLookup,
  triggerReconciliation,
  ApiError,
} from './services/api.js';
import { Header } from './components/Header.js';
import { DailyQuotaSummary } from './components/DailyQuotaSummary.js';
import { RequestForm } from './components/RequestForm.js';
import { LookupStatusPanel } from './components/LookupStatusPanel.js';
import { RequestTable } from './components/RequestTable.js';

interface Toast {
  id: number;
  type: 'success' | 'warning' | 'error' | 'info';
  message: string;
}

export const App: React.FC = () => {
  // Requirement: Analyst ID input with clearly documented development default ('analyst-alice')
  const [analystId, setAnalystId] = useState<string>('analyst-alice');
  const [quota, setQuota] = useState<DailyQuota | null>(null);
  const [requests, setRequests] = useState<EnrichmentRequest[]>([]);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);

  const [loadingInitial, setLoadingInitial] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isReconciling, setIsReconciling] = useState<boolean>(false);
  const [executingIds, setExecutingIds] = useState<Set<string>>(new Set());
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Polling management: requirement 2 ("stop polling when no longer necessary")
  const [userPausedPolling, setUserPausedPolling] = useState<boolean>(false);
  const [isPollingActive, setIsPollingActive] = useState<boolean>(true);
  const idleCountRef = useRef<number>(0);

  const addToast = (type: Toast['type'], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  };

  const removeToast = (id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Requirement 1 & 8: Fetch real server state (never simulate success with local-only state)
  const refreshData = useCallback(async (quiet: boolean = false) => {
    try {
      if (!quiet) setLoadingInitial(true);
      const [quotaData, requestsData] = await Promise.all([
        fetchQuota(),
        fetchRequests(),
      ]);

      setQuota(quotaData);
      setRequests(requestsData);
      setDashboardError(null);

      // Auto-select latest request if none selected or keep existing selection updated
      setSelectedRequestId((prevId) => {
        if (!prevId && requestsData.length > 0) {
          return requestsData[0].id;
        }
        return prevId;
      });

      // Requirement 2: Smart adaptive polling - check if active leases or queued items exist
      const hasActiveWork = requestsData.some(
        (r) => r.status === 'LEASED' || r.status === 'QUEUED' || r.status === 'EXECUTING'
      );

      if (hasActiveWork) {
        idleCountRef.current = 0;
        setIsPollingActive(true);
      } else {
        idleCountRef.current += 1;
        // If 4 consecutive cycles pass with zero active leases/queues, back off polling
        if (idleCountRef.current >= 4) {
          setIsPollingActive(false);
        }
      }
    } catch (err: any) {
      const msg = err.message || 'Failed to connect to backend coordinator.';
      setDashboardError(msg);
      if (!quiet) {
        addToast('error', `Connection error: ${msg}`);
      }
    } finally {
      if (!quiet) setLoadingInitial(false);
    }
  }, []);

  // Initial dashboard load
  useEffect(() => {
    refreshData(false);
  }, [refreshData]);

  // Requirement 2 & 7: Polling timer with clean cleanup on unmount
  useEffect(() => {
    if (userPausedPolling || !isPollingActive) {
      return;
    }

    const intervalTimer = setInterval(() => {
      refreshData(true);
    }, 2500);

    return () => {
      clearInterval(intervalTimer);
    };
  }, [userPausedPolling, isPollingActive, refreshData]);

  // Selected request in status panel
  const selectedRequest = requests.find((r) => r.id === selectedRequestId) || requests[0] || null;

  // Requirement 4 & 5: Handle Request Enrichment submission with unique Idempotency-Key
  const handleCreateRequest = async (indicator: string, idempotencyKey: string) => {
    setIsSubmitting(true);
    setSubmissionError(null);
    try {
      // Re-activate polling immediately on new user action
      idleCountRef.current = 0;
      setIsPollingActive(true);

      const created = await createEnrichment(analystId, indicator, idempotencyKey);

      // Requirement 8: Update state strictly from backend response
      await refreshData(true);
      setSelectedRequestId(created.id);

      if (created.status === 'LEASED') {
        addToast('success', `Lease reserved for ${created.normalizedIndicator}! (Valid for 5m)`);
      } else if (created.status === 'QUEUED') {
        addToast(
          'info',
          `Quota fully reserved. Placed at #${created.relativeQueuePosition ?? '1'} in FIFO queue.`
        );
      }
    } catch (err: any) {
      const msg = err.message || 'Failed to reserve enrichment request.';
      setSubmissionError(msg);
      if (err instanceof ApiError && err.status === 409) {
        addToast('warning', `Conflict (409): ${msg}`);
      } else {
        addToast('error', `Submission error: ${msg}`);
      }
      throw err;
    } finally {
      setIsSubmitting(false);
    }
  };

  // Requirement 4: Execute Lookup (Run Lookup while lease is valid)
  const handleExecuteLookup = async (requestId: string) => {
    setExecutingIds((prev) => new Set(prev).add(requestId));
    try {
      idleCountRef.current = 0;
      setIsPollingActive(true);

      const updated = await executeLookup(requestId, analystId);

      // Re-fetch authoritative state from server
      await refreshData(true);
      setSelectedRequestId(updated.id);

      const verdictStr = updated.verdict?.verdict.toUpperCase() ?? 'UNKNOWN';
      addToast('success', `Lookup completed! Verdict for ${updated.normalizedIndicator}: ${verdictStr}`);
    } catch (err: any) {
      const msg = err.message || 'Lookup execution failed.';
      addToast('error', `Execution error: ${msg}`);
      await refreshData(true);
    } finally {
      setExecutingIds((prev) => {
        const next = new Set(prev);
        next.delete(requestId);
        return next;
      });
    }
  };

  // Trigger manual background worker sweep
  const handleManualReconcile = async () => {
    setIsReconciling(true);
    try {
      idleCountRef.current = 0;
      setIsPollingActive(true);
      const res = await triggerReconciliation();
      addToast(
        'info',
        `Reconciliation cycle: Expired ${res.expiredCount} stale leases, Promoted ${res.promotedCount} queued requests.`
      );
      await refreshData(true);
    } catch (err: any) {
      addToast('error', `Reconciliation error: ${err.message}`);
    } finally {
      setIsReconciling(false);
    }
  };

  return (
    <div className="app-container">
      {/* Toast Notification Stack */}
      <div className="toast-stack" aria-live="assertive">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`} role="alert">
            <span className="toast-text">{t.message}</span>
            <button
              onClick={() => removeToast(t.id)}
              className="toast-close"
              aria-label="Dismiss notification"
            >
              &times;
            </button>
          </div>
        ))}
      </div>

      {/* Top Navbar */}
      <Header
        analystId={analystId}
        onAnalystChange={(newId) => {
          setAnalystId(newId);
          refreshData(true);
        }}
        isAutoRefresh={!userPausedPolling && isPollingActive}
        onToggleAutoRefresh={() => {
          if (userPausedPolling) {
            setUserPausedPolling(false);
            setIsPollingActive(true);
            refreshData(true);
          } else {
            setUserPausedPolling(true);
          }
        }}
        onManualReconcile={handleManualReconcile}
        isReconciling={isReconciling}
      />

      <main className="main-content" role="main">
        {/* Connection Failure Error Banner */}
        {dashboardError && (
          <div className="card dashboard-error-banner" role="alert">
            <div className="error-header">
              <svg className="alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <strong>Backend Service Error:</strong> {dashboardError}
            </div>
            <button
              type="button"
              onClick={() => refreshData(false)}
              className="btn btn-secondary btn-sm"
            >
              Retry Connection
            </button>
          </div>
        )}

        {/* Component 1: Daily Quota Summary */}
        <DailyQuotaSummary quota={quota} loading={loadingInitial} />

        {/* 2-Column Responsive Layout: Request Form + Lookup Status Panel */}
        <div className="dashboard-grid">
          {/* Component 2: Request Enrichment Form */}
          <RequestForm
            analystId={analystId}
            onAnalystIdChange={setAnalystId}
            onSubmit={handleCreateRequest}
            isSubmitting={isSubmitting}
            lastError={submissionError}
            onClearError={() => setSubmissionError(null)}
          />

          {/* Component 3: Lookup Status Panel */}
          <LookupStatusPanel
            request={selectedRequest}
            currentAnalystId={analystId}
            onExecute={handleExecuteLookup}
            isExecuting={selectedRequest ? executingIds.has(selectedRequest.id) : false}
            onRefresh={() => refreshData(true)}
          />
        </div>

        {/* Component 4: Recent Requests Table & Queues */}
        <RequestTable
          requests={requests}
          selectedRequestId={selectedRequest?.id ?? null}
          onSelectRequest={(req) => setSelectedRequestId(req.id)}
          currentAnalystId={analystId}
          onExecute={handleExecuteLookup}
          onRefresh={() => refreshData(true)}
          executingIds={executingIds}
          loading={loadingInitial}
          onRetry={() => refreshData(false)}
          error={dashboardError}
        />
      </main>

      <footer className="footer" role="contentinfo">
        <div>
          <strong>Enrichment Lookup Coordinator</strong> &bull; PostgreSQL ACID Concurrency &bull; Row-Level Lock Order &bull; Fair FIFO Queuing
        </div>
      </footer>
    </div>
  );
};
