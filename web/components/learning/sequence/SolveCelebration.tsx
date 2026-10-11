"use client";

import { m, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import MarkdownRenderer from "@/components/common/MarkdownRenderer";
import { formatClock } from "@/components/learning/sequence/ProblemTimer";
import { Dialog } from "@/shared/ui/Dialog";

export interface SolveCelebrationProps {
  open: boolean;
  /** Seconds the solve took, from the count-up timer. */
  seconds: number;
  /** Frozen combo peak; the row hides at 1 or below (v1 rule). */
  peakCombo: number;
  progress: { solved: number; goal: number };
  explanation: string | null;
  onClose: () => void;
}

/**
 * Solved overlay for both modes: duration, best combo (quest only), topic
 * progress, and the full explanation once the server sends one. It takes no
 * step data — the order stays server-side, so the celebration cannot leak
 * which steps were the planted mistakes.
 */
export function SolveCelebration({
  open,
  seconds,
  peakCombo,
  progress,
  explanation,
  onClose,
}: SolveCelebrationProps) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  return (
    <Dialog
      open={open}
      title={t("Correct. Well done.")}
      onClose={onClose}
      closeLabel={t("Close")}
    >
      <m.div
        className="space-y-1 text-sm"
        initial={reduceMotion ? false : { opacity: 0, scale: 0.96 }}
        animate={reduceMotion ? undefined : { opacity: 1, scale: 1 }}
        transition={{ duration: reduceMotion ? 0 : 0.25 }}
      >
        <p className="text-base font-semibold">
          {t("Solved in {{time}}", { time: formatClock(seconds) })}
        </p>
        {peakCombo > 1 && <p>{t("Best combo ×{{count}}", { count: peakCombo })}</p>}
        <p>
          {t("Solved {{count}} of {{goal}}", {
            count: progress.solved,
            goal: progress.goal,
          })}
        </p>
      </m.div>
      {explanation !== null && (
        <section className="mt-4 border-t border-[var(--border)] pt-3">
          <h3 className="mb-2 text-sm font-semibold">{t("Full explanation")}</h3>
          <MarkdownRenderer content={explanation} enableMath />
        </section>
      )}
    </Dialog>
  );
}
