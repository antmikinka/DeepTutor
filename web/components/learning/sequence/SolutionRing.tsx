"use client";

import { useTranslation } from "react-i18next";

const RADIUS = 18;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export interface SolutionRingProps {
  /** Steps currently confirmed as part of the solution. */
  built: number;
  /** Size of the finished solution. Zero or less renders an empty ring. */
  total: number;
}

/**
 * Build-progress ring for the HUD: how much of *this* solution the learner has
 * assembled, as a radial percentage. Distinct from ProgressRing (which counts
 * solved topics toward a goal). A non-positive total renders an empty ring
 * instead of NaN, and the fraction clamps to [0, 1]. The digits are shown for
 * sighted learners and mirrored as an sr-only sentence for screen readers.
 */
export function SolutionRing({ built, total }: SolutionRingProps) {
  const { t } = useTranslation();
  const safeTotal = total > 0 ? total : 0;
  const ratio = safeTotal > 0 ? Math.min(1, Math.max(0, built / safeTotal)) : 0;
  const percent = Math.round(ratio * 100);
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
          stroke="var(--primary)"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - ratio)}
          className="transition-[stroke-dashoffset] duration-300 motion-reduce:transition-none"
        />
      </svg>
      <span className="text-[11px] font-semibold tabular-nums text-[var(--foreground)]" aria-hidden="true">
        {percent}%
      </span>
      <span className="sr-only">{t("Solution {{percent}}% built", { percent })}</span>
    </span>
  );
}
