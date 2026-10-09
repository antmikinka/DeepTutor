"use client";

import { m, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";

/**
 * Quest-mode combo badge. v1 visibility rule: it appears only above combo 1,
 * so a single placement never celebrates itself. The changing key remounts
 * the badge on every accepted placement, replaying the pop.
 */
export function ComboBadge({ combo }: { combo: number }) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  if (combo <= 1) return null;
  return (
    <m.span
      key={combo}
      role="status"
      className="inline-flex items-center rounded-full border border-[var(--success)] bg-[var(--success-surface)] px-3 py-1 text-sm font-semibold text-[var(--foreground)]"
      initial={reduceMotion ? false : { scale: 0.85 }}
      animate={reduceMotion ? undefined : { scale: [0.9, 1.12, 1] }}
      transition={{ duration: reduceMotion ? 0 : 0.25 }}
    >
      {t("Combo ×{{count}}", { count: combo })}
    </m.span>
  );
}
