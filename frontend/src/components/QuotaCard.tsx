import React from 'react';
import { DailyQuota } from '../types.js';

interface Props {
  quota: DailyQuota | null;
  loading: boolean;
}

export const QuotaCard: React.FC<Props> = ({ quota, loading }) => {
  if (loading && !quota) {
    return (
      <div className="card quota-card animate-pulse">
        <div className="skeleton-bar" style={{ width: '40%', height: '24px' }}></div>
      </div>
    );
  }

  const max = quota?.maxLimit ?? 10;
  const consumed = quota?.consumedCount ?? 0;
  const reserved = quota?.reservedCount ?? 0;
  const available = quota?.availableCount ?? 0;

  const consumedPct = Math.min(100, Math.round((consumed / max) * 100));
  const reservedPct = Math.min(100 - consumedPct, Math.round((reserved / max) * 100));
  const availablePct = Math.max(0, 100 - consumedPct - reservedPct);

  return (
    <div className="card quota-card">
      <div className="quota-header">
        <div>
          <span className="card-tag">Daily Provider Quota</span>
          <h2 className="quota-title">Threat Intelligence Quota</h2>
        </div>
        <div className="quota-date-badge">
          <svg className="badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect width="18" height="18" x="3" y="4" rx="2" ry="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8" y1="2" x2="8" y2="6"/>
            <line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
          {quota?.quotaDate || 'Today'}
        </div>
      </div>

      <div className="quota-metrics-grid">
        {/* Available Units */}
        <div className="metric-box metric-available">
          <div className="metric-label">Available to Reserve</div>
          <div className="metric-value">{available}</div>
          <div className="metric-hint">Immediate 5-min leases</div>
        </div>

        {/* Reserved Units */}
        <div className="metric-box metric-reserved">
          <div className="metric-label">Active Leases (Reserved)</div>
          <div className="metric-value">{reserved}</div>
          <div className="metric-hint">Pending execution</div>
        </div>

        {/* Consumed Units */}
        <div className="metric-box metric-consumed">
          <div className="metric-label">Permanently Consumed</div>
          <div className="metric-value">{consumed}</div>
          <div className="metric-hint">Executed lookups</div>
        </div>

        {/* Daily Cap */}
        <div className="metric-box metric-limit">
          <div className="metric-label">Daily Capacity Limit</div>
          <div className="metric-value">{max}</div>
          <div className="metric-hint">Resets at midnight UTC</div>
        </div>
      </div>

      {/* Visual Stacked Progress Bar */}
      <div className="quota-progress-container">
        <div className="quota-progress-track">
          <div
            className="progress-segment segment-consumed"
            style={{ width: `${consumedPct}%` }}
            title={`Consumed: ${consumed} units (${consumedPct}%)`}
          />
          <div
            className="progress-segment segment-reserved"
            style={{ width: `${reservedPct}%` }}
            title={`Reserved: ${reserved} units (${reservedPct}%)`}
          />
          <div
            className="progress-segment segment-available"
            style={{ width: `${availablePct}%` }}
            title={`Available: ${available} units (${availablePct}%)`}
          />
        </div>

        <div className="progress-legend">
          <span className="legend-item">
            <span className="legend-color legend-consumed"></span> Consumed ({consumed})
          </span>
          <span className="legend-item">
            <span className="legend-color legend-reserved"></span> Reserved Leases ({reserved})
          </span>
          <span className="legend-item">
            <span className="legend-color legend-available"></span> Available ({available})
          </span>
        </div>
      </div>

      {available === 0 && (
        <div className="quota-alert alert-warning">
          <svg className="alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <div>
            <strong>Daily Quota Exhausted or Reserved:</strong> New enrichment requests will enter the fair FIFO queue. When active leases expire or capacity frees up, queued requests will be promoted automatically.
          </div>
        </div>
      )}
    </div>
  );
};

