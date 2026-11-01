import React, { useState, useId } from 'react';
import { validateIndicator } from '../utils/validation.js';

interface Props {
  analystId: string;
  onAnalystIdChange: (newId: string) => void;
  onSubmit: (indicator: string, idempotencyKey: string) => Promise<void>;
  isSubmitting: boolean;
  lastError: string | null;
  onClearError: () => void;
}

const PRESET_INDICATORS = [
  { label: 'Malicious C2 Domain', val: 'evil-c2[.]net' },
  { label: 'Defanged IPv4', val: '198.51.100[.]42' },
  { label: 'Phishing URL', val: 'hxxps://login-verification[.]com/auth' },
  { label: 'SHA-256 Ransomware Hash', val: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
  { label: 'Clean Enterprise Portal', val: 'clean-enterprise-corp.com' },
];

export const RequestForm: React.FC<Props> = ({
  analystId,
  onAnalystIdChange,
  onSubmit,
  isSubmitting,
  lastError,
  onClearError,
}) => {
  const [rawIndicator, setRawIndicator] = useState('');
  const [customKey, setCustomKey] = useState('');
  const [showIdempotencyControls, setShowIdempotencyControls] = useState(false);
  const [localValidationError, setLocalValidationError] = useState<string | null>(null);

  const indicatorInputId = useId();
  const analystInputId = useId();
  const idempotencyInputId = useId();

  // Live validation detection
  const validation = validateIndicator(rawIndicator);

  // Generate a cryptographically strong unique idempotency key
  const generateUniqueKey = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  };

  const handleIndicatorChange = (val: string) => {
    setRawIndicator(val);
    setLocalValidationError(null);
    onClearError();
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalValidationError(null);
    onClearError();

    const val = rawIndicator.trim();
    if (!val) {
      setLocalValidationError('Please enter an IP address, domain, URL, or file hash.');
      return;
    }

    const check = validateIndicator(val);
    if (!check.isValid) {
      setLocalValidationError(check.errorMessage || 'Invalid indicator format.');
      return;
    }

    if (!analystId.trim()) {
      setLocalValidationError('Analyst ID cannot be empty. Please enter an analyst identifier.');
      return;
    }

    // Requirement 4: Generate unique Idempotency-Key for each new user action
    const keyToUse =
      showIdempotencyControls && customKey.trim()
        ? customKey.trim()
        : generateUniqueKey();

    try {
      await onSubmit(val, keyToUse);
      // Reset indicator upon successful server response
      setRawIndicator('');
      if (!showIdempotencyControls) {
        setCustomKey('');
      }
    } catch {
      // Error is surfaced through props.lastError and local state
    }
  };

  const handleSampleSelect = (sample: string) => {
    setRawIndicator(sample);
    setLocalValidationError(null);
    onClearError();
  };

  return (
    <section className="card request-form-card" aria-labelledby="request-form-heading">
      <div className="card-header">
        <div>
          <span className="card-tag">New Submission</span>
          <h2 id="request-form-heading" className="card-title">
            Request Threat Intelligence Enrichment
          </h2>
        </div>
      </div>

      <form onSubmit={handleFormSubmit} noValidate>
        {/* Analyst Identity Input with Documented Default */}
        <div className="form-group analyst-id-group">
          <label htmlFor={analystInputId} className="form-label">
            Analyst Identifier <span className="label-default-hint">(Development default: <code>analyst-alice</code>)</span>
          </label>
          <div className="analyst-input-row">
            <input
              id={analystInputId}
              type="text"
              value={analystId}
              onChange={(e) => onAnalystIdChange(e.target.value)}
              placeholder="e.g. analyst-alice, soc-investigator"
              className="text-input"
              required
              aria-describedby="analyst-desc"
            />
            <button
              type="button"
              onClick={() => onAnalystIdChange('analyst-alice')}
              className="btn btn-secondary btn-sm"
              title="Reset to development default"
            >
              Reset Default
            </button>
          </div>
          <p id="analyst-desc" className="hint-text">
            All requests and lookups are tracked against this analyst identity via the <code>x-analyst-id</code> header.
          </p>
        </div>

        {/* Indicator Input with Live Validation */}
        <div className="form-group">
          <div className="form-label-row">
            <label htmlFor={indicatorInputId} className="form-label">
              Network Indicator of Compromise (IOC)
            </label>
            {rawIndicator.trim() && (
              <span
                className={`indicator-type-pill ${
                  validation.isValid ? 'pill-valid' : 'pill-invalid'
                }`}
                aria-live="polite"
              >
                {validation.isValid ? `Type: ${validation.label}` : 'Invalid format'}
              </span>
            )}
          </div>

          <div className="input-with-button">
            <input
              id={indicatorInputId}
              type="text"
              value={rawIndicator}
              onChange={(e) => handleIndicatorChange(e.target.value)}
              placeholder="Enter IP (e.g. 192.168.1[.]1), Domain (evil.com), URL, or MD5/SHA256 hash"
              className={`text-input ${
                localValidationError ? 'input-error' : rawIndicator.trim() && validation.isValid ? 'input-success' : ''
              }`}
              disabled={isSubmitting}
              autoComplete="off"
              spellCheck="false"
              aria-invalid={!!localValidationError}
              aria-describedby="ioc-help ioc-error"
            />

            <button
              type="submit"
              disabled={isSubmitting || !rawIndicator.trim()}
              className="btn btn-primary"
              title="Request a 5-minute lease or enter FIFO queue"
            >
              {isSubmitting ? (
                <>
                  <span className="spinner-sm" aria-hidden="true"></span> Reserving...
                </>
              ) : (
                <>
                  <svg className="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  Request Enrichment
                </>
              )}
            </button>
          </div>

          {/* IOC Refanging & Normalization preview */}
          {rawIndicator.trim() && validation.isValid && (
            <div id="ioc-help" className="normalization-hint">
              <span className="hint-label">Canonical normalized representation:</span>{' '}
              <code>{validation.normalized}</code>
            </div>
          )}

          {/* Local Validation Error Banner */}
          {localValidationError && (
            <div id="ioc-error" className="form-error-banner" role="alert">
              <svg className="alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{localValidationError}</span>
            </div>
          )}
        </div>

        {/* Quick Sample IOC Buttons */}
        <div className="samples-row" role="region" aria-label="Sample Indicators">
          <span className="samples-label">Quick samples:</span>
          <div className="samples-buttons">
            {PRESET_INDICATORS.map((sample) => (
              <button
                key={sample.val}
                type="button"
                onClick={() => handleSampleSelect(sample.val)}
                className="sample-pill"
                title={`Load sample: ${sample.label}`}
              >
                {sample.val}
              </button>
            ))}
          </div>
        </div>

        {/* Advanced Idempotency Key Testing Controls */}
        <div className="idempotency-toggle-section">
          <button
            type="button"
            onClick={() => setShowIdempotencyControls(!showIdempotencyControls)}
            className="btn-link"
            aria-expanded={showIdempotencyControls}
          >
            {showIdempotencyControls
              ? '▼ Hide Idempotency Key Configuration'
              : '▶ Idempotency Key Testing (Simulate Replays & Network Retries)'}
          </button>

          {showIdempotencyControls && (
            <div className="idempotency-body">
              <label htmlFor={idempotencyInputId} className="form-label">
                Custom Idempotency-Key Header:
              </label>
              <div className="idempotency-input-row">
                <input
                  id={idempotencyInputId}
                  type="text"
                  value={customKey}
                  onChange={(e) => setCustomKey(e.target.value)}
                  placeholder="Leave empty to auto-generate unique UUID on each submission"
                  className="text-input"
                />
                <button
                  type="button"
                  onClick={() => setCustomKey(generateUniqueKey())}
                  className="btn btn-secondary btn-sm"
                >
                  Generate Key
                </button>
              </div>
              <p className="hint-text">
                Submitting an identical <code>(analystId, Idempotency-Key)</code> pair safely returns the existing request with zero quota penalty.
              </p>
            </div>
          )}
        </div>

        {/* Server API Error Banner with Safe Retry */}
        {lastError && (
          <div className="form-error-banner alert-server-error" role="alert">
            <svg className="alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <div className="error-content">
              <strong>Error:</strong> {lastError}
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="btn btn-secondary btn-sm"
              title="Safe retry with the same input"
            >
              Retry
            </button>
          </div>
        )}
      </form>
    </section>
  );
};
