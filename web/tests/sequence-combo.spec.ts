import { describe, expect, it } from "vitest";
import { initialCombo, nextCombo, type ComboEvent, type ComboState } from "@/lib/sequence-combo";

function run(events: ComboEvent[], state: ComboState = initialCombo): ComboState {
  return events.reduce(nextCombo, state);
}

describe("quest combo reducer", () => {
  it("counts consecutive accepted placements", () => {
    const state = run([{ type: "accept" }, { type: "accept" }, { type: "accept" }]);
    expect(state).toEqual({ combo: 3, peak: 3, frozen: false });
  });

  it("breaks the combo on a rejection but keeps the peak", () => {
    const state = run([{ type: "accept" }, { type: "accept" }, { type: "reject" }]);
    expect(state.combo).toBe(0);
    expect(state.peak).toBe(2);
  });

  it("breaks the combo on a removal", () => {
    const state = run([{ type: "accept" }, { type: "remove" }]);
    expect(state.combo).toBe(0);
    expect(state.peak).toBe(1);
  });

  it("restarts counting from one after a break", () => {
    const state = run([{ type: "reject" }, { type: "accept" }]);
    expect(state).toEqual({ combo: 1, peak: 1, frozen: false });
  });

  it("leaves the combo unchanged on a transport error", () => {
    const before = run([{ type: "accept" }, { type: "accept" }]);
    const after = nextCombo(before, { type: "transport-error" });
    expect(after).toBe(before);
    expect(after).toEqual({ combo: 2, peak: 2, frozen: false });
  });

  it("freezes at the peak once the problem is solved", () => {
    const solved = run([{ type: "accept" }, { type: "accept" }, { type: "solve" }]);
    expect(solved).toEqual({ combo: 2, peak: 2, frozen: true });
    // A frozen combo ignores later verdicts so the celebration cannot change.
    expect(nextCombo(solved, { type: "accept" })).toBe(solved);
    expect(nextCombo(solved, { type: "reject" })).toBe(solved);
    expect(nextCombo(solved, { type: "remove" })).toBe(solved);
    // A transport error never matters anyway.
    expect(nextCombo(solved, { type: "transport-error" })).toBe(solved);
  });

  it("solve without prior accepts freezes at zero", () => {
    expect(nextCombo(initialCombo, { type: "solve" })).toEqual({
      combo: 0,
      peak: 0,
      frozen: true,
    });
  });

  it("reset returns a fresh state for the next problem", () => {
    const state = run([{ type: "accept" }, { type: "accept" }, { type: "solve" }]);
    expect(nextCombo(state, { type: "reset" })).toEqual(initialCombo);
    expect(nextCombo(state, { type: "reset" })).toStrictEqual({ combo: 0, peak: 0, frozen: false });
  });

  it("tracks the peak across several breaks", () => {
    const state = run([
      { type: "accept" },
      { type: "accept" },
      { type: "accept" },
      { type: "reject" },
      { type: "accept" },
    ]);
    expect(state.combo).toBe(1);
    expect(state.peak).toBe(3);
  });

  it("never mutates the incoming state", () => {
    const before: ComboState = { combo: 2, peak: 4, frozen: false };
    const snapshot = { ...before };
    nextCombo(before, { type: "accept" });
    nextCombo(before, { type: "reject" });
    nextCombo(before, { type: "solve" });
    expect(before).toEqual(snapshot);
  });

  it("hides the badge at one: it shows only above combo 1 (v1 rule)", () => {
    // The reducer supplies the number; the visibility rule is combo > 1.
    const one = run([{ type: "accept" }]);
    const two = run([{ type: "accept" }, { type: "accept" }]);
    expect(one.combo > 1).toBe(false);
    expect(two.combo > 1).toBe(true);
  });
});
