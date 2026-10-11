import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ComboBadge } from "@/components/learning/sequence/ComboBadge";
import { initI18n } from "@/i18n/init";

initI18n("en");

describe("combo badge", () => {
  it("hides at combo 0 and at combo 1 (v1 rule: visible only above 1)", () => {
    const zero = render(<ComboBadge combo={0} />);
    expect(zero.container).toBeEmptyDOMElement();
    const one = render(<ComboBadge combo={1} />);
    expect(one.container).toBeEmptyDOMElement();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the count with the multiplication sign above combo 1", () => {
    render(<ComboBadge combo={2} />);
    expect(screen.getByRole("status")).toHaveTextContent("Combo ×2");
  });

  it("updates as the combo grows", () => {
    const { rerender } = render(<ComboBadge combo={2} />);
    rerender(<ComboBadge combo={5} />);
    expect(screen.getByRole("status")).toHaveTextContent("Combo ×5");
  });

  it("disappears again when the combo breaks", () => {
    const { rerender } = render(<ComboBadge combo={3} />);
    rerender(<ComboBadge combo={0} />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
