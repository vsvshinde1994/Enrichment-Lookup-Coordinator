import React, { useEffect, useState } from 'react';
import { EnrichmentRequest } from '../types.js';

interface Props {
  request: EnrichmentRequest | null;
  currentAnalystId: string;
  onExecute: (id: string) => Promise<void>;
  isExecuting: boolean;
  onRefresh: () => void;
}

export const LookupStatusPanel: React.FC<Props> = ({
  request,
  currentAnalystId,
  onExecute,
  isExecuting,
  onRefresh,
}) => {
  // Requirement 3: Derive lease countdown strictly from server-provided expiresAt timestamp
  const calculateRemainingSeconds = (expiresAt: string | null) => {
    if (!expiresAt) return 0;
    const diff = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000);
    return Math.max(0, diff);
  };

  const [secondsRemaining, setSecondsRemaining] = useState<number>(() =>
    calculateRemainingSeconds(request?.leaseExpiresAt ?? null)
  );

  // Requirement 7: Clean up polling/countdown timers when components unmount or expiresAt changes
  useEffect(() => {
    if (!request || request.status !== 'LEASED' || !request.leaseExpiresAt) {
      setSecondsRemaining(0);
      return;
    }

    setSecondsRemaining(calculateRemainingSeconds(request.leaseExpiresAt));

    const intervalId = setInterval(() => {
      const remaining = calculateRemainingSeconds(request.leaseExpiresAt);
      setSecondsRemaining(remaining);

      if (remaining <= 0) {
        clearInterval(intervalId);
        onRefresh();
      }
    }, 1000);

    return () => {
      clearInterval(intervalId);
    };
  }, [request?.id, request?.status, request?.leaseExpiresAt, onRefresh]);

  if (!request) {
    return (
      <section className="card lookup-status-panel panel-empty" aria-label="Lookup Status Panel">
        <div className="status-panel-placeholder">
          <div className="placeholder-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h3 className="placeholder-title">No Request Selected</h3>
          <p className="placeholder-hint">
            Submit a new indicator above or click on any request in the recent requests table below to monitor its lease status, countdown, and reputation verdict.
          </p>
        </div>
      </section>
    );
  }

  // Requirement 4: Disable Run Lookup when lease is expired or in invalid state
  const isLeaseActive = request.status === 'LEASED' && secondsRemaining > 0;
  const canRunLookup = isLeaseActive && !isExecuting;

  const formatCountdown = (totalSecs: number) => {
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  return (
    <section
      className={`card lookup-status-panel panel-status-${request.status.toLowerCase()}`}
      aria-labelledby="status-panel-heading"
      aria-live="polite"
    >
      <div className="status-panel-header">
        <div>
          <span className="card-tag">Active Lookup Inspector</span>
          <h2 id="status-panel-heading" className="card-title">
            Lookup Status: <code>{request.indicator}</code>
          </h2>
        </div>
        <div className="status-header-badge">
          <span className={`status-pill status-${request.status.toLowerCase()}`}>
            {request.status}
          </span>
        </div>
      </div>

      <div className="status-panel-body">
        {/* Metadata Strip */}
        <div className="status-metadata-grid">
          <div className="meta-item">
            <span className="meta-label">Analyst ID:</span>
            <span className="meta-value">
              <code>{request.analystId}</code>{' '}
              {request.analystId === currentAnalystId && (
                <span className="badge-you">(You)</span>
              )}
            </span>
          </div>

          <div className="meta-item">
            <span className="meta-label">Normalized IOC:</span>
            <span className="meta-value">
              <code>{request.normalizedIndicator}</code>
            </span>
          </div>

          <div className="meta-item">
            <span className="meta-label">Request ID:</span>
            <span className="meta-value meta-id" title={request.id}>
              {request.id.substring(0, 13)}...
            </span>
          </div>

          <div className="meta-item">
            <span className="meta-label">Created At:</span>
            <span className="meta-value">
              {new Date(request.createdAt).toLocaleTimeString()}
            </span>
          </div>
        </div>

        {/* STATE 1: QUEUED */}
        {request.status === 'QUEUED' && (
          <div className="status-card-inner card-inner-queued">
            <div className="status-icon-badge icon-queued">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" />
                <line x1="3" y1="12" x2="3.01" y2="12" />
                <line x1="3" y1="18" x2="3.01" y2="18" />
              </svg>
            </div>
            <div className="status-card-content">
              <h3 className="status-heading">Request is Waiting in FIFO Queue</h3>
              <p className="status-text">
                Daily quota capacity is currently fully reserved. Your request is queued at{' '}
                <strong className="text-highlight">
                  position #{request.relativeQueuePosition ?? request.queuePosition ?? '1'}
                </strong>{' '}
                in the fair FIFO queue. When an active lease expires or today's quota resets, your request will be promoted automatically.
              </p>
            </div>
          </div>
        )}

        {/* STATE 2: LEASED (Active Lease Countdown & Run Lookup) */}
        {request.status === 'LEASED' && (
          <div className="status-card-inner card-inner-leased">
            <div className="lease-countdown-section">
              <div className="countdown-display">
                <span className="countdown-label">Lease Countdown Deadline:</span>
                <div
                  className={`countdown-value ${
                    secondsRemaining < 60 ? 'countdown-urgent' : ''
                  }`}
                  aria-label={`Time remaining: ${secondsRemaining} seconds`}
                >
                  <svg
                    className="clock-icon"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  {secondsRemaining > 0 ? formatCountdown(secondsRemaining) : '00:00 (Expired)'}
                </div>
                <div className="countdown-subtext">
                  Expires at:{' '}
                  {request.leaseExpiresAt
                    ? new Date(request.leaseExpiresAt).toLocaleTimeString()
                    : 'N/A'}
                </div>
              </div>

              {/* Requirement 4: Run Lookup Action Button */}
              <div className="lookup-action-box">
                <button
                  type="button"
                  onClick={() => onExecute(request.id)}
                  disabled={!canRunLookup}
                  className={`btn btn-lg ${canRunLookup ? 'btn-run-lookup' : 'btn-disabled'}`}
                  title={
                    !canRunLookup
                      ? 'Lease has expired or execution is in progress'
                      : 'Call threat provider and consume quota unit'
                  }
                >
                  {isExecuting ? (
                    <>
                      <span className="spinner-sm" aria-hidden="true"></span> Calling Provider...
                    </>
                  ) : (
                    <>
                      <svg className="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                      Run Lookup (Execute Lease)
                    </>
                  )}
                </button>
                <p className="action-hint">
                  Running lookup will permanently consume 1 reserved quota unit for today.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* STATE 3: EXECUTING */}
        {request.status === 'EXECUTING' && (
          <div className="status-card-inner card-inner-executing">
            <span className="spinner-md" aria-hidden="true"></span>
            <div className="status-card-content">
              <h3 className="status-heading">Threat Intelligence Provider Scan in Progress</h3>
              <p className="status-text">
                Lease claimed atomically using the Non-Blocking Two-Phase Claim Pattern. External provider network call is underway outside of database transactions.
              </p>
            </div>
          </div>
        )}

        {/* STATE 4: COMPLETED (Completed Reputation Verdict) */}
        {request.status === 'COMPLETED' && request.verdict && (
          <div
            className={`status-card-inner card-inner-completed verdict-theme-${request.verdict.verdict.toLowerCase()}`}
          >
            <div className="verdict-banner">
              <div className="verdict-main">
                <span className="verdict-tag">Completed Reputation Verdict</span>
                <h3 className="verdict-title">
                  {request.verdict.verdict === 'clean' && '🛡️ CLEAN'}
                  {request.verdict.verdict === 'suspicious' && '⚠️ SUSPICIOUS'}
                  {request.verdict.verdict === 'malicious' && '🚨 MALICIOUS THREAT DETECTED'}
                </h3>
                <p className="verdict-details-text">{request.verdict.details}</p>
              </div>

              <div className="verdict-metrics">
                <div className="verdict-conf-box">
                  <span className="conf-label">Confidence</span>
                  <span className="conf-value">
                    {Math.round(request.verdict.confidence * 100)}%
                  </span>
                </div>
                <div className="verdict-provider-box">
                  <span className="provider-label">Provider</span>
                  <span className="provider-value">{request.verdict.provider}</span>
                </div>
                <div className="verdict-timestamp-box">
                  <span className="time-label">Analyzed</span>
                  <span className="time-value">
                    {new Date(request.verdict.analyzedAt).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* STATE 5: EXPIRED */}
        {request.status === 'EXPIRED' && (
          <div className="status-card-inner card-inner-expired">
            <div className="status-icon-badge icon-expired">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <div className="status-card-content">
              <h3 className="status-heading">Lease Expired (Unused)</h3>
              <p className="status-text">
                The 5-minute reservation expired before execution. The reserved quota unit was safely released back to the daily quota pool and the next queued request was promoted.
              </p>
            </div>
          </div>
        )}

        {/* STATE 6: FAILED */}
        {request.status === 'FAILED' && (
          <div className="status-card-inner card-inner-failed">
            <div className="status-icon-badge icon-failed">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>
            <div className="status-card-content">
              <h3 className="status-heading">Enrichment Lookup Failed</h3>
              <p className="status-text">
                {request.errorMessage || 'Provider invocation error encountered.'}
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

