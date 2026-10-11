"use client";

import { useTranslation } from "react-i18next";

const RADIUS = 18;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Solved-topics ring for the HUD. A goal of zero renders an empty ring
 * instead of NaN, and an over-full solved count clamps to a full ring.
 * The exact number lives in the sr-only text next to it.
 */
export function ProgressRing({ solved, goal }: { solved: number; goal: number }) {
  const { t } = useTranslation();
  const ratio = goal > 0 ? Math.min(1, Math.max(0, solved / goal)) : 0;
  return (
    <span className="relative inline-flex h-11 w-11 items-center justify-center">
      <svg viewBox="0 0 44 44" className="h-11 w-11 -rotate-90" aria-hidden="true" focusable="false">
        <circle cx="22" cy="22" r={RADIUS} fill="none" strokeWidth="4" stroke="var(--border)" />
        <circle
          cx="22"
          cy="22"
          r={RADIUS}
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          stroke="var(--success)"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - ratio)}
          className="transition-[stroke-dashoffset] duration-300 motion-reduce:transition-none"
        />
      </svg>
      <span className="sr-only">{t("Solved {{count}} of {{goal}}", { count: solved, goal })}</span>
    </span>
  );
}
