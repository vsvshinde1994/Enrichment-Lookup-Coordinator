import React from 'react';

interface Props {
  analystId: string;
  onAnalystChange: (newId: string) => void;
  isAutoRefresh: boolean;
  onToggleAutoRefresh: () => void;
  onManualReconcile: () => void;
  isReconciling: boolean;
}

const PRESET_ANALYSTS = [
  'analyst-alice',
  'analyst-bob',
  'analyst-charlie',
  'soc-tier2',
];

export const Header: React.FC<Props> = ({
  analystId,
  onAnalystChange,
  isAutoRefresh,
  onToggleAutoRefresh,
  onManualReconcile,
  isReconciling,
}) => {
  return (
    <header className="navbar">
      <div className="navbar-brand">
        <div className="brand-logo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            <path d="m9 12 2 2 4-4"/>
          </svg>
        </div>
        <div>
          <h1 className="brand-title">Enrichment Lookup Coordinator</h1>
          <p className="brand-subtitle">Provider Quota &amp; Fair FIFO Leases</p>
        </div>
      </div>

      <div className="navbar-controls">
        {/* Analyst Selector */}
        <div className="analyst-control">
          <label htmlFor="analyst-select" className="control-label">
            Analyst Identity:
          </label>
          <div className="analyst-input-group">
            <select
              id="analyst-select"
              value={PRESET_ANALYSTS.includes(analystId) ? analystId : 'custom'}
              onChange={(e) => {
                if (e.target.value !== 'custom') {
                  onAnalystChange(e.target.value);
                }
              }}
              className="select-input"
            >
              {PRESET_ANALYSTS.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
              <option value="custom">Custom...</option>
            </select>

            {!PRESET_ANALYSTS.includes(analystId) && (
              <input
                type="text"
                value={analystId}
                onChange={(e) => onAnalystChange(e.target.value)}
                placeholder="Enter custom analystId"
                className="text-input analyst-custom-input"
              />
            )}
          </div>
        </div>

        {/* Reconcile Sweep Button */}
        <button
          onClick={onManualReconcile}
          disabled={isReconciling}
          title="Manually expire stale leases and promote next queued requests"
          className="btn btn-secondary"
        >
          {isReconciling ? (
            <span className="spinner-sm"></span>
          ) : (
            <svg className="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
              <path d="M3 3v5h5"/>
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/>
              <path d="M16 21h5v-5"/>
            </svg>
          )}
          Reconcile Leases
        </button>

        {/* Live Polling Toggle */}
        <button
          onClick={onToggleAutoRefresh}
          className={`btn btn-toggle ${isAutoRefresh ? 'active' : ''}`}
          title={isAutoRefresh ? 'Auto-refresh active (every 2s)' : 'Auto-refresh paused'}
        >
          <span className={`status-dot ${isAutoRefresh ? 'dot-live' : 'dot-paused'}`}></span>
          {isAutoRefresh ? 'Live Sync' : 'Paused'}
        </button>
      </div>
    </header>
  );
};

