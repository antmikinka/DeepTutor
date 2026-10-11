import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { SolveCelebration } from "@/components/learning/sequence/SolveCelebration";
import { initI18n } from "@/i18n/init";

vi.mock("next/dynamic", () => ({
  default:
    () =>
    ({ content }: { content: string }) => <div>{content}</div>,
}));

initI18n("en");

const PROGRESS = { solved: 3, goal: 5 };

describe("solve celebration", () => {
  it("shows the duration, the best combo, and the topic progress", () => {
    render(
      <SolveCelebration
        open
        seconds={125}
        peakCombo={4}
        progress={PROGRESS}
        explanation={null}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Correct. Well done.")).toBeInTheDocument();
    expect(screen.getByText("Solved in 02:05")).toBeInTheDocument();
    expect(screen.getByText("Best combo ×4")).toBeInTheDocument();
    expect(screen.getByText("Solved 3 of 5")).toBeInTheDocument();
  });

  it("hides the best-combo row at a peak of 1 or below", () => {
    const { rerender } = render(
      <SolveCelebration
        open
        seconds={61}
        peakCombo={1}
        progress={PROGRESS}
        explanation={null}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Best combo/)).toBeNull();
    rerender(
      <SolveCelebration
        open
        seconds={61}
        peakCombo={0}
        progress={PROGRESS}
        explanation={null}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Best combo/)).toBeNull();
  });

  it("renders the explanation section only when the server sent one", () => {
    const { rerender } = render(
      <SolveCelebration
        open
        seconds={10}
        peakCombo={2}
        progress={PROGRESS}
        explanation={null}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText("Full explanation")).toBeNull();
    rerender(
      <SolveCelebration
        open
        seconds={10}
        peakCombo={2}
        progress={PROGRESS}
        explanation="Because the inner function changes first."
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Full explanation")).toBeInTheDocument();
    expect(screen.getByText(/inner function changes first/)).toBeInTheDocument();
  });

  it("calls onClose from the dialog close button", () => {
    const onClose = vi.fn();
    render(
      <SolveCelebration
        open
        seconds={10}
        peakCombo={2}
        progress={PROGRESS}
        explanation={null}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders nothing while closed", () => {
    render(
      <SolveCelebration
        open={false}
        seconds={10}
        peakCombo={2}
        progress={PROGRESS}
        explanation="Hidden text."
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("Hidden text.")).toBeNull();
  });

  it("takes no answer-key data: the props carry nothing but the celebration", () => {
    const src = readFileSync(
      resolve(process.cwd(), "components/learning/sequence/SolveCelebration.tsx"),
      "utf8",
    );
    const props = src.match(/export interface SolveCelebrationProps \{([\s\S]*?)\n\}/);
    expect(props).not.toBeNull();
    expect(props![1]).not.toMatch(/steps|placed|marks|correct|distractor|evidence|role/i);
    const { container } = render(
      <SolveCelebration
        open
        seconds={10}
        peakCombo={2}
        progress={PROGRESS}
        explanation={null}
        onClose={vi.fn()}
      />,
    );
    expect(container.textContent ?? "").not.toMatch(/s_[a-z0-9]/);
  });
});
