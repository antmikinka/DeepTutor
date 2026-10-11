import { beforeEach, describe, expect, it } from "vitest";
import { autocheckEnabled, setAutocheckEnabled } from "@/lib/sequence-autocheck";

describe("sequence autocheck preference", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to on when nothing is stored", () => {
    expect(autocheckEnabled()).toBe(true);
  });

  it("round-trips the toggle through local storage", () => {
    setAutocheckEnabled(false);
    expect(autocheckEnabled()).toBe(false);
    expect(localStorage.getItem("deeptutor.sequence.autocheck")).toBe("0");
    setAutocheckEnabled(true);
    expect(autocheckEnabled()).toBe(true);
    expect(localStorage.getItem("deeptutor.sequence.autocheck")).toBe("1");
  });

  it("treats any non-1 value as off", () => {
    localStorage.setItem("deeptutor.sequence.autocheck", "0");
    expect(autocheckEnabled()).toBe(false);
    localStorage.setItem("deeptutor.sequence.autocheck", "garbage");
    expect(autocheckEnabled()).toBe(false);
  });
});
