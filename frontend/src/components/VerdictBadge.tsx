import React from 'react';
import { VerdictResult } from '../types.js';

interface Props {
  verdict: VerdictResult | null;
  status: string;
}

export const VerdictBadge: React.FC<Props> = ({ verdict, status }) => {
  if (status === 'QUEUED') {
    return <span className="badge badge-queued">In Queue</span>;
  }

  if (status === 'LEASED') {
    return <span className="badge badge-leased">Lease Active</span>;
  }

  if (status === 'EXECUTING') {
    return (
      <span className="badge badge-executing animate-pulse">
        <span className="spinner-sm"></span> Scanning...
      </span>
    );
  }

  if (status === 'EXPIRED') {
    return <span className="badge badge-expired">Lease Expired</span>;
  }

  if (status === 'FAILED') {
    return <span className="badge badge-failed">Failed</span>;
  }

  if (!verdict) {
    return <span className="badge badge-neutral">—</span>;
  }

  const v = verdict.verdict.toLowerCase();
  if (v === 'malicious') {
    return (
      <div className="verdict-container">
        <span className="badge badge-malicious">
          <svg className="badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          MALICIOUS
        </span>
        <span className="verdict-confidence">{Math.round(verdict.confidence * 100)}% conf</span>
      </div>
    );
  }

  if (v === 'suspicious') {
    return (
      <div className="verdict-container">
        <span className="badge badge-suspicious">
          <svg className="badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          SUSPICIOUS
        </span>
        <span className="verdict-confidence">{Math.round(verdict.confidence * 100)}% conf</span>
      </div>
    );
  }

  return (
    <div className="verdict-container">
      <span className="badge badge-clean">
        <svg className="badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          <path d="m9 12 2 2 4-4"/>
        </svg>
        CLEAN
      </span>
      <span className="verdict-confidence">{Math.round(verdict.confidence * 100)}% conf</span>
    </div>
  );
};

