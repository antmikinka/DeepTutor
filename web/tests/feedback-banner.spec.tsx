import { act, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SequenceBanner,
  type SequenceVerdict,
} from "@/components/learning/sequence/SequenceBanner";
import { initI18n } from "@/i18n/init";

initI18n("en");

function source(name: string): string {
  return readFileSync(
    resolve(process.cwd(), `components/learning/sequence/${name}.tsx`),
    "utf8",
  );
}

describe("sequence banner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("auto-dismisses an incorrect verdict after exactly 3 s", () => {
    const onDismiss = vi.fn();
    render(<SequenceBanner verdict="incorrect" onDismiss={onDismiss} />);
    expect(screen.getByRole("status")).toHaveTextContent("Not quite. Try again.");
    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("keeps a correct verdict until the page clears it", () => {
    const onDismiss = vi.fn();
    render(<SequenceBanner verdict="correct" onDismiss={onDismiss} />);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("gives a re-triggered miss a fresh 3 s with no stale timer", () => {
    const onDismiss = vi.fn();
    function Harness({ verdict }: { verdict: SequenceVerdict | null }) {
      // The page renders the banner only while a verdict is set; clearing it
      // unmounts the component, which is what re-arms the timer.
      return verdict ? <SequenceBanner verdict={verdict} onDismiss={onDismiss} /> : null;
    }
    const { rerender } = render(<Harness verdict="incorrect" />);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    rerender(<Harness verdict={null} />);
    expect(screen.queryByRole("status")).toBeNull();
    rerender(<Harness verdict="incorrect" />);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole("status")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it("does not restart the timer when unrelated re-renders churn the callback", () => {
    const onDismiss = vi.fn();
    const { rerender } = render(
      <SequenceBanner verdict="incorrect" onDismiss={() => onDismiss()} />,
    );
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    // A new inline callback identity must not re-arm the auto-dismiss.
    rerender(<SequenceBanner verdict="incorrect" onDismiss={() => onDismiss()} />);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("rotates praise with the combo and keeps the practice sentence at 0", () => {
    const { rerender } = render(<SequenceBanner verdict="correct" combo={0} />);
    expect(screen.getByRole("status")).toHaveTextContent("Correct. Well done.");
    rerender(<SequenceBanner verdict="correct" combo={1} />);
    expect(screen.getByRole("status")).toHaveTextContent("Great placement.");
    rerender(<SequenceBanner verdict="correct" combo={2} />);
    expect(screen.getByRole("status")).toHaveTextContent("Nice — that step belongs there.");
    rerender(<SequenceBanner verdict="correct" combo={3} />);
    expect(screen.getByRole("status")).toHaveTextContent("Correct. Well done.");
  });

  it("keeps verdict, copy, and timing intact with prefers-reduced-motion on", () => {
    const original = window.matchMedia;
    // The shared setup installs matchMedia as a non-writable value property,
    // so the override has to go through defineProperty as well.
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn((query: string) => ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(() => false),
      })),
    });
    try {
      const onDismiss = vi.fn();
      render(<SequenceBanner verdict="incorrect" onDismiss={onDismiss} />);
      expect(screen.getByRole("status")).toHaveTextContent("Not quite. Try again.");
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(onDismiss).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, "matchMedia", { configurable: true, value: original });
    }
  });

  it("every animated hud component opts into the reduced-motion preference", () => {
    for (const name of ["ComboBadge", "ProgressRing", "SequenceBanner", "SolveCelebration"]) {
      expect(source(name), name).toMatch(/useReducedMotion|motion-reduce/);
    }
    // The timer never animates, so it never imports the motion library at all.
    expect(source("ProblemTimer")).not.toMatch(/framer-motion/);
  });
});
