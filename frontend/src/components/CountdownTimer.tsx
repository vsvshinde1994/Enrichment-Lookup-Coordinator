import React, { useEffect, useState } from 'react';

interface Props {
  expiresAt: string | null;
  onExpired?: () => void;
}

export const CountdownTimer: React.FC<Props> = ({ expiresAt, onExpired }) => {
  const calculateRemaining = () => {
    if (!expiresAt) return 0;
    const diff = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000);
    return Math.max(0, diff);
  };

  const [seconds, setSeconds] = useState<number>(calculateRemaining);

  useEffect(() => {
    setSeconds(calculateRemaining());

    const timer = setInterval(() => {
      const remaining = calculateRemaining();
      setSeconds(remaining);
      if (remaining <= 0) {
        clearInterval(timer);
        onExpired?.();
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [expiresAt]);

  if (seconds <= 0) {
    return <span className="countdown-expired">00:00 (Expired)</span>;
  }

  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  const isLow = seconds < 60;

  return (
    <span className={`countdown-timer ${isLow ? 'countdown-urgent' : ''}`}>
      <svg className="timer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10"/>
        <polyline points="12 6 12 12 16 14"/>
      </svg>
      {formatted}
    </span>
  );
};

