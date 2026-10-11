import { act, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProblemTimer, formatClock } from "@/components/learning/sequence/ProblemTimer";

describe("problem timer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts up from zero in mm:ss", () => {
    render(<ProblemTimer solved={false} />);
    expect(screen.getByRole("timer")).toHaveTextContent("00:00");
    act(() => {
      vi.advanceTimersByTime(65_000);
    });
    expect(screen.getByRole("timer")).toHaveTextContent("01:05");
  });

  it("freezes the moment the problem is solved", () => {
    const { rerender } = render(<ProblemTimer solved={false} />);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    rerender(<ProblemTimer solved />);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByRole("timer")).toHaveTextContent("00:30");
  });

  it("shows hours past one hour", () => {
    render(<ProblemTimer solved={false} />);
    act(() => {
      vi.advanceTimersByTime(3_723_000);
    });
    expect(screen.getByRole("timer")).toHaveTextContent("1:02:03");
  });

  it("never renders a negative time", () => {
    expect(formatClock(-5)).toBe("00:00");
    expect(formatClock(-0.4)).toBe("00:00");
    render(<ProblemTimer solved />);
    expect(screen.getByRole("timer").textContent).not.toContain("-");
  });

  it("exposes exactly one prop, solved: quest time is measured, never allotted", () => {
    const source = readFileSync(
      resolve(process.cwd(), "components/learning/sequence/ProblemTimer.tsx"),
      "utf8",
    );
    const props = source.match(/export interface ProblemTimerProps \{([^}]*)\}/);
    expect(props).not.toBeNull();
    expect(props![1].replace(/\s+/g, " ").trim()).toBe("solved: boolean;");
    // A count-down would need one of these; none may ever appear.
    expect(source).not.toMatch(/countdown|deadline|timeLimit|endsAt|remaining/i);
  });
});
