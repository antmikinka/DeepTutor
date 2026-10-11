"use client";

import { m, useReducedMotion } from "framer-motion";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

export type SequenceVerdict = "correct" | "incorrect";

export interface SequenceBannerProps {
  verdict: SequenceVerdict;
  /** Current quest combo; rotates the praise line on a correct verdict. */
  combo?: number;
  /** Fired 3 s after an incorrect verdict appears. */
  onDismiss?: () => void;
}

/**
 * Verdict banner. Incorrect fades itself away after three seconds so a miss
 * never nags; correct stays until the next action clears it. The page
 * unmounts the banner between verdicts, so every appearance gets a fresh
 * timer, and the dismiss callback lives in a ref so unrelated re-renders
 * (busy flags, combo changes) cannot restart it.
 */
export function SequenceBanner({ verdict, combo = 0, onDismiss }: SequenceBannerProps) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (verdict !== "incorrect") return;
    const id = setTimeout(() => dismissRef.current?.(), 3000);
    return () => clearTimeout(id);
  }, [verdict]);

  // Praise rotates with the combo; practice mode (combo 0) keeps the
  // original sentence, so nothing changes for existing learners.
  const message =
    verdict === "incorrect"
      ? t("Not quite. Try again.")
      : combo % 3 === 1
        ? t("Great placement.")
        : combo % 3 === 2
          ? t("Nice — that step belongs there.")
          : t("Correct. Well done.");

  return (
    <m.p
      role="status"
      className={`rounded-lg border px-4 py-3 text-sm font-semibold text-[var(--foreground)] ${
        verdict === "correct"
          ? "border-[var(--success)] bg-[var(--success-surface)]"
          : "border-[var(--destructive)] bg-[color-mix(in_srgb,var(--destructive)_14%,var(--background))]"
      }`}
      initial={reduceMotion ? false : { opacity: 0, y: -4 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.18 }}
    >
      {message}
    </m.p>
  );
}
