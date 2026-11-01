import React from 'react';
import { DailyQuota } from '../types.js';

interface Props {
  quota: DailyQuota | null;
  loading: boolean;
}

export const DailyQuotaSummary: React.FC<Props> = ({ quota, loading }) => {
  if (loading && !quota) {
    return (
      <div className="card quota-card animate-pulse" aria-busy="true">
        <div className="skeleton-line" style={{ width: '35%', height: '24px' }}></div>
        <div className="skeleton-grid" style={{ marginTop: '1rem' }}></div>
      </div>
    );
  }

  const max = quota?.maxLimit ?? 10;
  const available = quota?.availableCount ?? 0;
  const reserved = quota?.reservedCount ?? 0;
  const consumed = quota?.consumedCount ?? 0;
  const queued = quota?.queuedCount ?? 0;

  const consumedPct = Math.min(100, Math.round((consumed / max) * 100));
  const reservedPct = Math.min(100 - consumedPct, Math.round((reserved / max) * 100));
  const availablePct = Math.max(0, 100 - consumedPct - reservedPct);

  return (
    <section className="card quota-summary-card" aria-labelledby="quota-summary-title">
      <div className="quota-header">
        <div>
          <span className="card-tag">Daily Capacity &amp; Quota</span>
          <h2 id="quota-summary-title" className="card-title">
            Threat Intelligence Quota Summary
          </h2>
        </div>
        <div className="quota-date-badge" title="Active Quota Accounting Period (UTC)">
          <svg
            className="badge-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <span>Period: <strong>{quota?.quotaDate || 'Today (UTC)'}</strong></span>
        </div>
      </div>

      {/* 5-Metric Responsive Grid */}
      <div className="quota-metrics-grid" role="region" aria-label="Quota Metrics">
        {/* Total Quota */}
        <div className="metric-box metric-total">
          <div className="metric-label">Total Daily Quota</div>
          <div className="metric-value">{max}</div>
          <div className="metric-hint">Fixed daily limit</div>
        </div>

        {/* Remaining Available Quota */}
        <div className="metric-box metric-available">
          <div className="metric-label">Remaining Available</div>
          <div className="metric-value">{available}</div>
          <div className="metric-hint">Ready for immediate lease</div>
        </div>

        {/* Active Leases */}
        <div className="metric-box metric-reserved">
          <div className="metric-label">Active Leases</div>
          <div className="metric-value">{reserved}</div>
          <div className="metric-hint">Reserved for 5 minutes</div>
        </div>

        {/* Consumed Units */}
        <div className="metric-box metric-consumed">
          <div className="metric-label">Consumed Units</div>
          <div className="metric-value">{consumed}</div>
          <div className="metric-hint">Permanently used lookups</div>
        </div>

        {/* Queued Requests */}
        <div className="metric-box metric-queued">
          <div className="metric-label">Queued Requests</div>
          <div className="metric-value">{queued}</div>
          <div className="metric-hint">Awaiting FIFO promotion</div>
        </div>
      </div>

      {/* Stacked Capacity Progress Gauge */}
      <div className="quota-progress-container">
        <div
          className="quota-progress-track"
          role="progressbar"
          aria-valuenow={consumed + reserved}
          aria-valuemin={0}
          aria-valuemax={max}
          aria-label="Daily Quota Allocation"
        >
          <div
            className="progress-segment segment-consumed"
            style={{ width: `${consumedPct}%` }}
            title={`Consumed: ${consumed} units (${consumedPct}%)`}
          />
          <div
            className="progress-segment segment-reserved"
            style={{ width: `${reservedPct}%` }}
            title={`Active Leases: ${reserved} units (${reservedPct}%)`}
          />
          <div
            className="progress-segment segment-available"
            style={{ width: `${availablePct}%` }}
            title={`Remaining: ${available} units (${availablePct}%)`}
          />
        </div>

        <div className="progress-legend">
          <span className="legend-item">
            <span className="legend-color legend-consumed" aria-hidden="true"></span>
            Consumed: <strong>{consumed}</strong>
          </span>
          <span className="legend-item">
            <span className="legend-color legend-reserved" aria-hidden="true"></span>
            Active Leases: <strong>{reserved}</strong>
          </span>
          <span className="legend-item">
            <span className="legend-color legend-available" aria-hidden="true"></span>
            Available: <strong>{available}</strong>
          </span>
          {queued > 0 && (
            <span className="legend-item legend-queued-item">
              <span className="legend-color legend-queued" aria-hidden="true"></span>
              In FIFO Queue: <strong>{queued}</strong>
            </span>
          )}
        </div>
      </div>

      {/* Quota Exhaustion Alert */}
      {available === 0 && (
        <div className="quota-alert alert-warning" role="alert">
          <svg className="alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div>
            <strong>Daily Quota Fully Allocated:</strong> {reserved} unit(s) are currently leased and {consumed} permanently consumed.
            New requests will enter the fair FIFO queue. When unexecuted leases expire or daily quota resets, queued requests are promoted automatically.
          </div>
        </div>
      )}
    </section>
  );
};

