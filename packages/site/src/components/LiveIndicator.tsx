'use client';

import { useEffect, useState } from 'react';
import styles from './LiveIndicator.module.css';

interface LiveIndicatorProps {
  className?: string;
}

/**
 * Pulsing "LIVE" indicator shown in the header when a live stream is active.
 * Checks a lightweight API endpoint to determine stream status.
 */
export function LiveIndicator({ className }: LiveIndicatorProps) {
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    // Check stream status every 60 seconds
    async function checkLiveStatus() {
      try {
        const res = await fetch('/api/live-status', { next: { revalidate: 60 } });
        if (res.ok) {
          const data = await res.json();
          setIsLive(data.isLive);
        }
      } catch {
        // Silently fail — don't show indicator if check fails
      }
    }

    checkLiveStatus();
    const interval = setInterval(checkLiveStatus, 60_000);
    return () => clearInterval(interval);
  }, []);

  if (!isLive) return null;

  return (
    <a href="/blog" className={`${styles.indicator} ${className ?? ''}`}>
      <span className={styles.dot} />
      <span className={styles.label}>LIVE</span>
    </a>
  );
}
