import React, { useState } from 'react';
import { EnrichmentRequest, RequestStatus } from '../types.js';
import { VerdictBadge } from './VerdictBadge.js';
import { CountdownTimer } from './CountdownTimer.js';

interface Props {
  requests: EnrichmentRequest[];
  selectedRequestId: string | null;
  onSelectRequest: (request: EnrichmentRequest) => void;
  currentAnalystId: string;
  onExecute: (id: string) => Promise<void>;
  onRefresh: () => void;
  executingIds: Set<string>;
  loading: boolean;
  onRetry: () => void;
  error: string | null;
}

export const RequestTable: React.FC<Props> = ({
  requests,
  selectedRequestId,
  onSelectRequest,
  currentAnalystId,
  onExecute,
  onRefresh,
  executingIds,
  loading,
  onRetry,
  error,
}) => {
  const [filterTab, setFilterTab] = useState<'ALL' | RequestStatus>('ALL');
  const [filterMyAnalystOnly, setFilterMyAnalystOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Filtering
  const filtered = requests.filter((req) => {
    if (filterTab !== 'ALL' && req.status !== filterTab) {
      return false;
    }
    if (filterMyAnalystOnly && req.analystId !== currentAnalystId) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        req.indicator.toLowerCase().includes(q) ||
        req.normalizedIndicator.toLowerCase().includes(q) ||
        req.analystId.toLowerCase().includes(q) ||
        req.id.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const getStatusCounts = () => {
    const counts: Record<string, number> = { ALL: requests.length };
    for (const r of requests) {
      counts[r.status] = (counts[r.status] || 0) + 1;
    }
    return counts;
  };

  const counts = getStatusCounts();

  return (
    <section className="card request-table-card" aria-labelledby="requests-table-heading">
      <div className="table-controls-header">
        <div>
          <span className="card-tag">Request Audit Trail</span>
          <h2 id="requests-table-heading" className="card-title">
            Recent Enrichment Requests &amp; Queues
          </h2>
        </div>

        <div className="table-search-row">
          <div className="search-box">
            <svg
              className="search-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search IOCs, analysts..."
              className="search-input"
              aria-label="Filter recent requests by keyword"
            />
          </div>

          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={filterMyAnalystOnly}
              onChange={(e) => setFilterMyAnalystOnly(e.target.checked)}
            />
            <span>Only My Requests (<code>{currentAnalystId}</code>)</span>
          </label>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="tab-buttons" role="tablist" aria-label="Filter by Request Status">
        <button
          role="tab"
          aria-selected={filterTab === 'ALL'}
          onClick={() => setFilterTab('ALL')}
          className={`tab-btn ${filterTab === 'ALL' ? 'active' : ''}`}
        >
          All Requests <span className="tab-badge">{counts.ALL || 0}</span>
        </button>
        <button
          role="tab"
          aria-selected={filterTab === 'LEASED'}
          onClick={() => setFilterTab('LEASED')}
          className={`tab-btn ${filterTab === 'LEASED' ? 'active' : ''}`}
        >
          Active Leases <span className="tab-badge badge-leased">{counts.LEASED || 0}</span>
        </button>
        <button
          role="tab"
          aria-selected={filterTab === 'QUEUED'}
          onClick={() => setFilterTab('QUEUED')}
          className={`tab-btn ${filterTab === 'QUEUED' ? 'active' : ''}`}
        >
          Queued <span className="tab-badge badge-queued">{counts.QUEUED || 0}</span>
        </button>
        <button
          role="tab"
          aria-selected={filterTab === 'COMPLETED'}
          onClick={() => setFilterTab('COMPLETED')}
          className={`tab-btn ${filterTab === 'COMPLETED' ? 'active' : ''}`}
        >
          Completed <span className="tab-badge badge-clean">{counts.COMPLETED || 0}</span>
        </button>
        <button
          role="tab"
          aria-selected={filterTab === 'EXPIRED'}
          onClick={() => setFilterTab('EXPIRED')}
          className={`tab-btn ${filterTab === 'EXPIRED' ? 'active' : ''}`}
        >
          Expired <span className="tab-badge badge-expired">{counts.EXPIRED || 0}</span>
        </button>
      </div>

      {/* ERROR STATE */}
      {error && (
        <div className="table-error-banner" role="alert">
          <svg className="alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div className="error-text">
            <strong>Failed to sync requests:</strong> {error}
          </div>
          <button type="button" onClick={onRetry} className="btn btn-secondary btn-sm">
            Retry Sync
          </button>
        </div>
      )}

      {/* LOADING STATE */}
      {loading && requests.length === 0 ? (
        <div className="table-loading-skeleton" aria-busy="true">
          <div className="skeleton-row"></div>
          <div className="skeleton-row"></div>
          <div className="skeleton-row"></div>
        </div>
      ) : filtered.length === 0 ? (
        /* EMPTY STATE */
        <div className="empty-state" role="status">
          <svg className="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10" />
            <line x1="8" y1="12" x2="16" y2="12" />
          </svg>
          <p className="empty-title">No enrichment requests found</p>
          <p className="empty-subtitle">
            {searchQuery || filterTab !== 'ALL' || filterMyAnalystOnly
              ? 'Try modifying your search or switching filter tabs.'
              : 'Submit an IOC using the form above to reserve a 5-minute lease.'}
          </p>
        </div>
      ) : (
        /* TABLE OF RECENT REQUESTS */
        <div className="table-responsive">
          <table className="enrichment-table" aria-label="Recent enrichment requests table">
            <thead>
              <tr>
                <th scope="col">Indicator</th>
                <th scope="col">Analyst</th>
                <th scope="col">Status</th>
                <th scope="col">Queue Pos</th>
                <th scope="col">Lease Countdown</th>
                <th scope="col">Reputation Verdict</th>
                <th scope="col" className="th-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((req) => {
                const isExecuting = executingIds.has(req.id) || req.status === 'EXECUTING';
                const canExecute = req.status === 'LEASED' && !isExecuting;
                const isSelected = selectedRequestId === req.id;

                return (
                  <tr
                    key={req.id}
                    className={`table-row ${isSelected ? 'row-selected' : ''}`}
                    onClick={() => onSelectRequest(req)}
                    tabIndex={0}
                    role="button"
                    aria-label={`Select request for ${req.indicator}`}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelectRequest(req);
                      }
                    }}
                  >
                    {/* Indicator */}
                    <td className="td-indicator">
                      <div className="indicator-primary">{req.indicator}</div>
                      {req.indicator !== req.normalizedIndicator && (
                        <div className="indicator-normalized">
                          norm: <code>{req.normalizedIndicator}</code>
                        </div>
                      )}
                    </td>

                    {/* Analyst */}
                    <td className="td-analyst">
                      <span
                        className={`analyst-badge ${
                          req.analystId === currentAnalystId ? 'badge-current-analyst' : ''
                        }`}
                      >
                        {req.analystId}
                      </span>
                    </td>

                    {/* Status Badge */}
                    <td className="td-status">
                      <span className={`status-pill status-${req.status.toLowerCase()}`}>
                        {req.status}
                      </span>
                    </td>

                    {/* Queue Position */}
                    <td className="td-queue">
                      {req.status === 'QUEUED' ? (
                        <span className="queue-position-badge">
                          #{req.relativeQueuePosition ?? req.queuePosition ?? '?'} in queue
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>

                    {/* Lease Countdown */}
                    <td className="td-countdown">
                      {req.status === 'LEASED' ? (
                        <CountdownTimer
                          expiresAt={req.leaseExpiresAt}
                          onExpired={onRefresh}
                        />
                      ) : req.status === 'EXPIRED' ? (
                        <span className="text-expired">Expired</span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>

                    {/* Verdict */}
                    <td className="td-verdict">
                      <VerdictBadge verdict={req.verdict} status={req.status} />
                    </td>

                    {/* Action: Run Lookup Button */}
                    <td
                      className="td-actions"
                      onClick={(e) => e.stopPropagation()} // Prevent row selection click
                    >
                      <button
                        type="button"
                        onClick={() => onExecute(req.id)}
                        disabled={!canExecute}
                        className={`btn btn-sm ${canExecute ? 'btn-run-lookup' : 'btn-disabled'}`}
                        title={
                          req.status === 'LEASED'
                            ? 'Run lookup and consume quota reservation'
                            : req.status === 'QUEUED'
                            ? 'Cannot execute: waiting in FIFO queue'
                            : req.status === 'COMPLETED'
                            ? 'Lookup already completed'
                            : req.status === 'EXPIRED'
                            ? 'Lease expired. Re-request to enter queue'
                            : 'Execution unavailable'
                        }
                      >
                        {isExecuting ? (
                          <>
                            <span className="spinner-sm" aria-hidden="true"></span> Running...
                          </>
                        ) : (
                          <>
                            <svg className="btn-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polygon points="5 3 19 12 5 21 5 3" />
                            </svg>
                            Run Lookup
                          </>
                        )}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
