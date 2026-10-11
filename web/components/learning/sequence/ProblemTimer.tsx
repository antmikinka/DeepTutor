"use client";

import { useEffect, useRef, useState } from "react";

export interface ProblemTimerProps {
  solved: boolean;
}

/** mm:ss, or h:mm:ss past an hour. Clamped so the display never goes below zero. */
export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Count-up-only timer: it measures how long a solve took, never how long is
 * left. The page keys it by problem id, so each problem starts at 00:00, and
 * the clock freezes the moment the problem is solved.
 */
export function ProblemTimer({ solved }: ProblemTimerProps) {
  const startRef = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (solved) return;
    const tick = () => {
      const now = Date.now();
      if (startRef.current === null) startRef.current = now;
      setElapsed(Math.max(0, Math.floor((now - startRef.current) / 1000)));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [solved]);

  return (
    <span role="timer" className="text-sm tabular-nums text-[var(--muted-foreground)]">
      {formatClock(elapsed)}
    </span>
  );
}
