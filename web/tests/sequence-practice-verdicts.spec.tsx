/**
 * Practice-mode live feedback: the auto-check setting, verdict memory on the
 * Available-steps bank, the build-progress ring, and practice-mode sounds.
 * The graded endpoint is faked with the same positional rules the server uses
 * (marks compare against the secret order; a full exact match solves once).
 */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps, ReactNode } from "react";
import { SequencePage } from "@/components/learning/sequence/SequencePage";
import { initI18n } from "@/i18n/init";
import * as knowledge from "@/features/knowledge/api/client";
import * as sequenceApi from "@/lib/sequence-api";
import * as sound from "@/lib/sequence-sound";
import { type SequenceCheckResult, type SequenceOutline } from "@/lib/sequence-api";
import {
  CORRECT_IDS,
  PRACTICE_PROBLEM,
  SOLVED_EXPLANATION,
} from "./helpers/sequence-mocks";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: ComponentProps<"a"> & { children?: ReactNode }) => (
    <a {...props}>{children}</a>
  ),
}));
vi.mock("next/dynamic", () => ({
  default:
    () =>
    ({ content }: { content: string }) => <div>{content}</div>,
}));
vi.mock("@/features/knowledge/api/client", () => ({
  listKnowledgeBases: vi.fn(),
}));
vi.mock("@/lib/sequence-sound", () => ({
  playBreak: vi.fn(),
  playCombo: vi.fn(),
  playSuccess: vi.fn(),
  setSoundEnabled: vi.fn(),
  soundEnabled: vi.fn(() => false),
  unlockAudio: vi.fn(),
}));
vi.mock("@/lib/sequence-api", async importOriginal => ({
  ...(await importOriginal<typeof sequenceApi>()),
  getSequenceOutline: vi.fn(),
  rebuildSequenceOutline: vi.fn(),
  createSequenceProblem: vi.fn(),
  placeSequenceStep: vi.fn(),
  removeSequenceStep: vi.fn(),
  checkSequenceAnswer: vi.fn(),
  requestSequenceHint: vi.fn(),
  explainSequenceStep: vi.fn(),
}));

initI18n("en");

const OUTLINE: SequenceOutline = {
  knowledge_base: "calculus",
  source: "files",
  modules: [
    { id: "m1", category: "Derivatives", name: "Chain rule", topic: "chain rule", solved: 2, goal: 5 },
  ],
};

const GREEN = "border-[var(--success)]";
const RED = "border-[var(--destructive)]";

/** Server-faithful fake of the graded practice check. */
function wireCheck() {
  vi.mocked(sequenceApi.checkSequenceAnswer).mockImplementation(
    async (_problemId: string, stepIds: readonly string[]): Promise<SequenceCheckResult> => {
      const marks = stepIds.map((id, index) =>
        CORRECT_IDS[index] === id ? "correct" : "incorrect",
      ) as Array<"correct" | "incorrect">;
      const solved = stepIds.length === CORRECT_IDS.length && marks.every(mark => mark === "correct");
      return {
        solved,
        marks,
        problem: solved
          ? {
              ...PRACTICE_PROBLEM,
              placed_ids: [...stepIds],
              solved: true,
              explanation: SOLVED_EXPLANATION,
              progress: { solved: 3, goal: 5 },
            }
          : PRACTICE_PROBLEM,
      };
    },
  );
}

async function flush(rounds = 4) {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }
}

/** Fire the parked 600 ms auto-check debounce and settle its request. */
async function settleAutocheck() {
  act(() => {
    vi.advanceTimersByTime(600);
  });
  await flush();
}

async function renderPage() {
  render(<SequencePage />);
  await flush();
}

async function openPractice() {
  fireEvent.click(screen.getByRole("button", { name: /chain rule/ }));
  await flush();
  expect(screen.getByRole("heading", { name: "Your solution" })).toBeInTheDocument();
}

async function clickStep(name: RegExp) {
  fireEvent.click(screen.getByRole("button", { name }));
  await flush();
}

function solutionPanel(): HTMLElement {
  const panel = screen.getByRole("heading", { name: "Your solution" }).closest("section");
  if (!panel) throw new Error("solution panel missing");
  return panel;
}

function autocheckButton(): HTMLElement {
  return screen.getByRole("button", { name: "Auto-check" });
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  vi.mocked(knowledge.listKnowledgeBases).mockResolvedValue([{ name: "calculus" }]);
  vi.mocked(sequenceApi.getSequenceOutline).mockResolvedValue(OUTLINE);
  vi.mocked(sound.soundEnabled).mockReturnValue(false);
  wireCheck();
  vi.mocked(sequenceApi.createSequenceProblem).mockImplementation(async () => ({
    ...PRACTICE_PROBLEM,
    placed_ids: [],
  }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("practice auto-check setting", () => {
  it("defaults on and grades the board after the learner pauses", async () => {
    await renderPage();
    expect(autocheckButton()).toHaveAttribute("aria-pressed", "true");
    await openPractice();

    await clickStep(/outer function/);
    // Nothing is graded before the debounce elapses.
    expect(sequenceApi.checkSequenceAnswer).not.toHaveBeenCalled();
    await settleAutocheck();

    expect(sequenceApi.checkSequenceAnswer).toHaveBeenCalledWith("p1", ["s_outer"]);
    // The live mark paints the placed step green without a manual check.
    expect(within(solutionPanel()).getByText(/outer function/).closest("li")?.className).toContain(GREEN);
    expect(screen.queryByRole("button", { name: "Check answer" })).toBeEnabled();
  });

  it("grades again after a removal and stays current with the board", async () => {
    await renderPage();
    await openPractice();

    await clickStep(/outer function/);
    await clickStep(/tempting mistake/);
    await settleAutocheck();
    expect(sequenceApi.checkSequenceAnswer).toHaveBeenLastCalledWith("p1", ["s_outer", "s_trap"]);

    fireEvent.click(screen.getAllByRole("button", { name: "Remove this step" })[1]);
    await flush();
    await settleAutocheck();
    expect(sequenceApi.checkSequenceAnswer).toHaveBeenLastCalledWith("p1", ["s_outer"]);
  });

  it("never fires when the setting is toggled off, and persists the choice", async () => {
    await renderPage();
    fireEvent.click(autocheckButton());
    await flush();
    expect(autocheckButton()).toHaveAttribute("aria-pressed", "false");
    expect(localStorage.getItem("deeptutor.sequence.autocheck")).toBe("0");

    await openPractice();
    await clickStep(/outer function/);
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    await flush();
    expect(sequenceApi.checkSequenceAnswer).not.toHaveBeenCalled();

    // The manual button is the only graded path while auto-check is off.
    fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
    await flush();
    expect(sequenceApi.checkSequenceAnswer).toHaveBeenCalledTimes(1);
  });

  it("rehydrates the persisted off state on the next visit", async () => {
    localStorage.setItem("deeptutor.sequence.autocheck", "0");
    await renderPage();
    expect(autocheckButton()).toHaveAttribute("aria-pressed", "false");
  });
});

describe("practice verdict memory on the bank", () => {
  it("greys a proven-wrong step in red and keeps a proven-right step green", async () => {
    await renderPage();
    await openPractice();

    await clickStep(/outer function/);
    await clickStep(/tempting mistake/);
    await settleAutocheck();
    expect(screen.getByText("Not quite. Try again.")).toBeInTheDocument();

    // Remove the wrong step: it returns to the bank wearing its verdict.
    fireEvent.click(screen.getAllByRole("button", { name: "Remove this step" })[1]);
    await flush();
    const trap = screen.getByRole("button", { name: /tempting mistake/ });
    expect(trap.className).toContain(RED);
    expect(trap.className).toContain("opacity-60");
    expect(within(trap).getByText("Previously marked incorrect")).toBeInTheDocument();
    // Still clickable: wrong THERE does not mean wrong everywhere.
    expect(trap).toBeEnabled();

    // Remove the correct step: it returns green.
    fireEvent.click(screen.getAllByRole("button", { name: "Remove this step" })[0]);
    await flush();
    const outer = screen.getByRole("button", { name: /outer function/ });
    expect(outer.className).toContain(GREEN);
    expect(within(outer).getByText("Previously marked correct")).toBeInTheDocument();
  });

  it("overwrites the memory when a later check proves the step right", async () => {
    await renderPage();
    await openPractice();

    // Trap first: proven wrong at position 0.
    await clickStep(/tempting mistake/);
    await settleAutocheck();
    fireEvent.click(screen.getAllByRole("button", { name: "Remove this step" })[0]);
    await flush();
    const trap = screen.getByRole("button", { name: /tempting mistake/ });
    expect(trap.className).toContain(RED);

    // outer + inner solves it; the last verdict for every graded step wins.
    await clickStep(/outer function/);
    await clickStep(/inner derivative/);
    await settleAutocheck();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /tempting mistake/ }).className).toContain(RED);
  });

  it("wipes the memory when the learner leaves the problem", async () => {
    await renderPage();
    await openPractice();
    await clickStep(/tempting mistake/);
    await settleAutocheck();
    fireEvent.click(screen.getAllByRole("button", { name: "Remove this step" })[0]);
    await flush();
    expect(screen.getByRole("button", { name: /tempting mistake/ }).className).toContain(RED);

    // Leaving the problem clears the bank memory; a fresh board starts clean.
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    await flush();
    await openPractice();
    const trap = screen.getByRole("button", { name: /tempting mistake/ });
    expect(trap.className).not.toContain(RED);
    expect(within(trap).queryByText("Previously marked incorrect")).toBeNull();
  });
});

describe("practice build-progress ring", () => {
  it("rises with verified steps and hits 100% on the solve", async () => {
    await renderPage();
    await openPractice();
    expect(screen.getByText("0%")).toBeInTheDocument();

    await clickStep(/outer function/);
    await settleAutocheck();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("Solution 50% built")).toBeInTheDocument();

    await clickStep(/inner derivative/);
    await settleAutocheck();
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(vi.mocked(sound.playSuccess)).toHaveBeenCalledTimes(1);
  });

  it("counts a wrong build against the solution size, not past it", async () => {
    await renderPage();
    await openPractice();
    // The trap is a distractor: placed but never verified, so the ring stays
    // at the placed count and never exceeds the solution length.
    await clickStep(/tempting mistake/);
    await flush();
    expect(screen.getByText("50%")).toBeInTheDocument();
    await settleAutocheck();
    // Graded wrong: 0 of 2 verified.
    expect(screen.getByText("0%")).toBeInTheDocument();
  });
});

describe("practice sounds", () => {
  it("plays the ladder for a correct build and the break tone for a miss", async () => {
    await renderPage();
    await openPractice();

    await clickStep(/outer function/);
    await settleAutocheck();
    expect(vi.mocked(sound.playCombo)).toHaveBeenCalledWith(1);
    expect(vi.mocked(sound.playBreak)).not.toHaveBeenCalled();

    await clickStep(/tempting mistake/);
    await settleAutocheck();
    expect(vi.mocked(sound.playBreak)).toHaveBeenCalledTimes(1);
  });

  it("proves the sound button works with a confirmation blip", async () => {
    await renderPage();
    await openPractice();

    const soundButton = screen.getByRole("button", { name: "Sound" });
    expect(soundButton).toHaveAttribute("title", "Play sounds for right and wrong steps");
    fireEvent.click(soundButton);
    await flush();
    expect(vi.mocked(sound.unlockAudio)).toHaveBeenCalled();
    expect(vi.mocked(sound.playCombo)).toHaveBeenCalledWith(1);
  });
});
