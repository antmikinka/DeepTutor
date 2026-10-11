import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SolutionRing } from "@/components/learning/sequence/SolutionRing";
import { initI18n } from "@/i18n/init";

initI18n("en");

const RADIUS = 18;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** The first circle is the track; the second carries the build-progress arc. */
function progressArc(container: HTMLElement): SVGCircleElement {
  const circles = container.querySelectorAll("circle");
  expect(circles).toHaveLength(2);
  return circles[1];
}

describe("solution ring", () => {
  it("maps built/total onto the dashoffset and shows the percentage", () => {
    const { container } = render(<SolutionRing built={1} total={4} />);
    const arc = progressArc(container);
    expect(arc.getAttribute("r")).toBe(String(RADIUS));
    expect(Number(arc.getAttribute("stroke-dasharray"))).toBeCloseTo(CIRCUMFERENCE, 6);
    expect(Number(arc.getAttribute("stroke-dashoffset"))).toBeCloseTo(CIRCUMFERENCE * 0.75, 6);
    expect(screen.getByText("25%")).toBeInTheDocument();
  });

  it("renders an empty ring at total zero instead of NaN", () => {
    const { container } = render(<SolutionRing built={0} total={0} />);
    const offset = Number(progressArc(container).getAttribute("stroke-dashoffset"));
    expect(Number.isNaN(offset)).toBe(false);
    expect(offset).toBeCloseTo(CIRCUMFERENCE, 6);
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("clamps to a full ring when built runs past total", () => {
    const { container } = render(<SolutionRing built={9} total={5} />);
    expect(Number(progressArc(container).getAttribute("stroke-dashoffset"))).toBeCloseTo(0, 6);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("rounds a repeating fraction to a whole percent", () => {
    render(<SolutionRing built={1} total={3} />);
    expect(screen.getByText("33%")).toBeInTheDocument();
  });

  it("announces the build percentage to screen readers", () => {
    render(<SolutionRing built={3} total={4} />);
    expect(screen.getByText("Solution 75% built")).toBeInTheDocument();
  });
});
