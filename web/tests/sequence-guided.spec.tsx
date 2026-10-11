/**
 * Guided mode: the model demonstrates the worked solution first (an approach
 * intro, then one revealed step at a time), and "Your turn" hands the same
 * problem to the learner as a practice-style rebuild. The graded endpoint is
 * faked with the same positional rules the server uses.
 */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps, ReactNode } from "react";
import { SequencePage } from "@/components/learning/sequence/SequencePage";
import { initI18n } from "@/i18n/init";
import * as knowledge from "@/features/knowledge/api/client";
import * as sequenceApi from "@/lib/sequence-api";
import * as sound from "@/lib/sequence-sound";
import {
  type SequenceCheckResult,
  type SequenceMode,
  type WalkthroughReveal,
} from "@/lib/sequence-api";
import {
  CORRECT_IDS,
  GUIDED_PROBLEM,
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
  requestWalkthroughIntro: vi.fn(),
  requestWalkthroughReveal: vi.fn(),
}));

initI18n("en");

const OUTLINE: sequenceApi.SequenceOutline = {
  knowledge_base: "calculus",
  source: "files",
  modules: [
    { id: "m1", category: "Derivatives", name: "Chain rule", topic: "chain rule", solved: 2, goal: 5 },
  ],
};

const INTRO = "Identify the outer and inner functions before differentiating.";

/** Server-faithful reveal fakes: correct order, lazy per index, done at the end. */
const REVEALS: WalkthroughReveal[] = [
  {
    index: 0,
    step_id: CORRECT_IDS[0],
    math: "$\\sin(x^2)$",
    explanation: "Differentiate the outer function and keep the inner one.",
    done: false,
    total: 2,
  },
  {
    index: 1,
    step_id: CORRECT_IDS[1],
    math: "$2x\\cos(x^2)$",
    explanation: "Multiply by the derivative of the inner function.",
    done: true,
    total: 2,
  },
];

/** Server-faithful fake of the graded practice check. */
function wireCheck(problemId: string) {
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
              ...GUIDED_PROBLEM,
              problem_id: problemId,
              placed_ids: [...stepIds],
              solved: true,
              explanation: SOLVED_EXPLANATION,
              progress: { solved: 3, goal: 5 },
            }
          : { ...GUIDED_PROBLEM, problem_id: problemId },
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

async function pickMode(name: RegExp) {
  fireEvent.click(screen.getByRole("button", { name }));
  await flush();
}

async function openGuided(): Promise<void> {
  await pickMode(/^Guided$/);
  fireEvent.click(screen.getByRole("button", { name: /chain rule/ }));
  await flush();
  expect(screen.getByRole("heading", { name: "Walkthrough" })).toBeInTheDocument();
}

async function clickStep(name: RegExp) {
  fireEvent.click(screen.getByRole("button", { name }));
  await flush();
}

function walkthroughPanel(): HTMLElement {
  const panel = screen.getByRole("heading", { name: "Walkthrough" }).closest("section");
  if (!panel) throw new Error("walkthrough panel missing");
  return panel;
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  vi.mocked(knowledge.listKnowledgeBases).mockResolvedValue([{ name: "calculus" }]);
  vi.mocked(sequenceApi.getSequenceOutline).mockResolvedValue(OUTLINE);
  vi.mocked(sound.soundEnabled).mockReturnValue(false);
  wireCheck("g1");
  vi.mocked(sequenceApi.createSequenceProblem).mockImplementation(
    async (_kb: string, _topic: string, mode: SequenceMode = "practice") => ({
      ...(mode === "guided" ? GUIDED_PROBLEM : { ...GUIDED_PROBLEM, problem_id: "p1", mode }),
      placed_ids: [],
    }),
  );
  vi.mocked(sequenceApi.requestWalkthroughIntro).mockResolvedValue({ intro: INTRO, total: 2 });
  vi.mocked(sequenceApi.requestWalkthroughReveal).mockImplementation(
    async (_problemId: string, index: number) => REVEALS[index],
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("guided mode picker", () => {
  it("offers guided as a third mode and creates the problem in it", async () => {
    await renderPage();
    const guided = screen.getByRole("button", { name: /^Guided$/ });
    expect(guided).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(guided);
    await flush();
    expect(guided).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByText("Watch the model solve it first, then rebuild it yourself."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /chain rule/ }));
    await flush();
    expect(sequenceApi.createSequenceProblem).toHaveBeenCalledWith("calculus", "chain rule", "guided");
  });

  it("never starts a walkthrough for practice or quest problems", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /chain rule/ }));
    await flush();
    expect(sequenceApi.requestWalkthroughIntro).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Your solution" })).toBeInTheDocument();
  });
});

describe("guided walkthrough demonstration", () => {
  it("explains the approach first and hides the board while demonstrating", async () => {
    await renderPage();
    await openGuided();
    expect(sequenceApi.requestWalkthroughIntro).toHaveBeenCalledWith("g1");
    const panel = walkthroughPanel();
    expect(within(panel).getByRole("heading", { name: "How to approach this problem" })).toBeInTheDocument();
    expect(within(panel).getByText(INTRO)).toBeInTheDocument();
    // The bank, the board, the timer and the ring stay off-screen until Your turn.
    expect(screen.queryByRole("heading", { name: "Your solution" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Available steps" })).toBeNull();
    expect(screen.queryByRole("timer")).toBeNull();
    expect(screen.queryByRole("button", { name: "Check answer" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Get a hint" })).toBeNull();
  });

  it("reveals the correct steps in order, one tap at a time", async () => {
    await renderPage();
    await openGuided();
    const next = screen.getByRole("button", { name: "Show next step" });

    fireEvent.click(next);
    await flush();
    expect(sequenceApi.requestWalkthroughReveal).toHaveBeenCalledWith("g1", 0);
    expect(screen.getByText("Step 1 of 2 demonstrated")).toBeInTheDocument();
    expect(screen.getByText(/Differentiate the outer function and keep the inner one\./)).toBeInTheDocument();
    // The next reveal is not pre-fetched: the learner controls the pace.
    expect(sequenceApi.requestWalkthroughReveal).toHaveBeenCalledTimes(1);

    fireEvent.click(next);
    await flush();
    expect(sequenceApi.requestWalkthroughReveal).toHaveBeenCalledWith("g1", 1);
    expect(screen.getByText("Step 2 of 2 demonstrated")).toBeInTheDocument();
    // The demonstration is complete: no more steps to show.
    expect(screen.getByRole("button", { name: "Show next step" })).toBeDisabled();
  });

  it("hands the same problem to the learner on Your turn", async () => {
    await renderPage();
    await openGuided();
    fireEvent.click(screen.getByRole("button", { name: "Show next step" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Your turn" }));
    await flush();

    // The walkthrough is gone and a practice-style board takes over.
    expect(screen.queryByRole("heading", { name: "Walkthrough" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Your solution" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Available steps" })).toBeInTheDocument();
    expect(screen.getByRole("timer")).toBeInTheDocument();
    // The full bank is back: the reveal history does not pre-place anything.
    expect(screen.getByRole("button", { name: /outer function/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /tempting mistake/ })).toBeEnabled();
  });

  it("skips straight to the rebuild with I've got this", async () => {
    await renderPage();
    await openGuided();
    expect(screen.queryByRole("button", { name: "Your turn" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "I've got this" }));
    await flush();
    expect(sequenceApi.requestWalkthroughReveal).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Your solution" })).toBeInTheDocument();
  });

  it("keeps the skip hatch when the intro fails", async () => {
    vi.mocked(sequenceApi.requestWalkthroughIntro).mockRejectedValue(
      new sequenceApi.SequenceRequestError(502, "The tutor could not introduce this problem yet. Try again."),
    );
    await renderPage();
    await openGuided();
    expect(
      screen.getByText("The tutor could not introduce this problem yet. Try again."),
    ).toBeInTheDocument();
    // No intro card, but the demonstration and the skip still work.
    expect(
      screen.queryByRole("heading", { name: "How to approach this problem" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show next step" }));
    await flush();
    expect(screen.getByText("Step 1 of 2 demonstrated")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Your turn" }));
    await flush();
    expect(screen.getByRole("heading", { name: "Your solution" })).toBeInTheDocument();
  });

  it("reports a failed reveal without losing the panel", async () => {
    vi.mocked(sequenceApi.requestWalkthroughReveal).mockRejectedValueOnce(
      new Error("boom"),
    );
    await renderPage();
    await openGuided();
    fireEvent.click(screen.getByRole("button", { name: "Show next step" }));
    await flush();
    expect(screen.getByText("boom")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Walkthrough" })).toBeInTheDocument();
    // The retry starts at the same index the failure ate.
    fireEvent.click(screen.getByRole("button", { name: "Show next step" }));
    await flush();
    expect(sequenceApi.requestWalkthroughReveal).toHaveBeenLastCalledWith("g1", 0);
    expect(screen.getByText("Step 1 of 2 demonstrated")).toBeInTheDocument();
  });
});

describe("guided rebuild", () => {
  it("grades the rebuild with auto-check, sounds, and the solve dialog", async () => {
    await renderPage();
    await openGuided();
    // Nothing was revealed, so the skip hatch hands over the board.
    fireEvent.click(screen.getByRole("button", { name: "I've got this" }));
    await flush();

    await clickStep(/outer function/);
    await settleAutocheck();
    expect(sequenceApi.checkSequenceAnswer).toHaveBeenCalledWith("g1", ["s_outer"]);
    expect(vi.mocked(sound.playCombo)).toHaveBeenCalledWith(1);
    expect(screen.getByText("Solution 50% built")).toBeInTheDocument();

    await clickStep(/inner derivative/);
    await settleAutocheck();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(vi.mocked(sound.playSuccess)).toHaveBeenCalledTimes(1);
  });

  it("restarts the walkthrough for the next guided problem", async () => {
    await renderPage();
    await openGuided();
    fireEvent.click(screen.getByRole("button", { name: "I've got this" }));
    await flush();

    // Leaving wipes the demonstration; the next problem starts from the intro.
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: /chain rule/ }));
    await flush();
    expect(screen.getByRole("heading", { name: "Walkthrough" })).toBeInTheDocument();
    expect(sequenceApi.requestWalkthroughIntro).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("heading", { name: "Your solution" })).toBeNull();
  });
});
