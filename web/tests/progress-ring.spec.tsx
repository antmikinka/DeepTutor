import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgressRing } from "@/components/learning/sequence/ProgressRing";
import { initI18n } from "@/i18n/init";

initI18n("en");

const RADIUS = 18;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** The first circle is the track; the second carries the progress arc. */
function progressArc(container: HTMLElement): SVGCircleElement {
  const circles = container.querySelectorAll("circle");
  expect(circles).toHaveLength(2);
  return circles[1];
}

describe("progress ring", () => {
  it("maps solved/goal onto the dashoffset of a 2πr arc", () => {
    const { container } = render(<ProgressRing solved={1} goal={4} />);
    const arc = progressArc(container);
    expect(arc.getAttribute("r")).toBe(String(RADIUS));
    expect(Number(arc.getAttribute("stroke-dasharray"))).toBeCloseTo(CIRCUMFERENCE, 6);
    expect(Number(arc.getAttribute("stroke-dashoffset"))).toBeCloseTo(CIRCUMFERENCE * 0.75, 6);
  });

  it("renders an empty ring at goal zero instead of NaN", () => {
    const { container } = render(<ProgressRing solved={0} goal={0} />);
    const offset = Number(progressArc(container).getAttribute("stroke-dashoffset"));
    expect(Number.isNaN(offset)).toBe(false);
    expect(offset).toBeCloseTo(CIRCUMFERENCE, 6);
  });

  it("clamps to a full ring when solved runs past the goal", () => {
    const { container } = render(<ProgressRing solved={9} goal={5} />);
    expect(Number(progressArc(container).getAttribute("stroke-dashoffset"))).toBeCloseTo(0, 6);
  });

  it("announces the exact count to screen readers", () => {
    render(<ProgressRing solved={3} goal={5} />);
    expect(screen.getByText("Solved 3 of 5")).toBeInTheDocument();
  });
});
