/**
 * Quest-mode page behavior end to end (blueprint P1-8..P1-17, P1-19, P1-20
 * and RT-1..RT-9). The page runs against a stateful fake of the graded
 * endpoints (helpers/sequence-mocks) so acceptance, solve-once, and the 409
 * invariants come from server truth, and against a latent queue whenever a
 * test has to choose the arrival order of responses.
 *
 * The Playwright runner in this repo only executes *.audit.ts files against a
 * live server, so the blueprint's browser rows are reproduced here as vitest
 * component tests over the real SequencePage.
 */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps, ReactNode } from "react";
import { SequencePage } from "@/components/learning/sequence/SequencePage";
import { initI18n } from "@/i18n/init";
import * as knowledge from "@/features/knowledge/api/client";
import * as sequenceApi from "@/lib/sequence-api";
import * as sound from "@/lib/sequence-sound";
import {
  SequenceRequestError,
  type PlaceResult,
  type SequenceOutline,
  type SequenceProblem,
} from "@/lib/sequence-api";
import {
  CORRECT_IDS,
  PRACTICE_PROBLEM,
  QUEST_PROBLEM,
  SOLVED_CONFLICT,
  SOLVED_EXPLANATION,
  makeLatentQueue,
  makeSequenceServer,
  type SequenceServer,
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
    { id: "m2", category: "Derivatives", name: "Limits", topic: "limits", solved: 0, goal: 5 },
  ],
};

/** A longer solve so the combo-break and latency tests never trip the goal. */
const FOUR_PROBLEM: SequenceProblem = {
  ...QUEST_PROBLEM,
  problem_id: "q4",
  steps: [
    { id: "s_a", explanation: "First move", math: "$a$" },
    { id: "s_b", explanation: "Second move", math: "$b$" },
    { id: "s_c", explanation: "Third move", math: "$c$" },
    { id: "s_d", explanation: "Fourth move", math: "$d$" },
    { id: "s_trap", explanation: "A tempting mistake", math: "$t$" },
  ],
};
const FOUR_IDS = ["s_a", "s_b", "s_c", "s_d"];

const ACCEPT_GLOW = "shadow-[0_0_0_2px_var(--success)]";
const REJECT_GLOW = "shadow-[0_0_0_2px_var(--destructive)]";

/** Fake timers everywhere: ProblemTimer, the aura, and the banner all tick. */
async function flush(rounds = 4) {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }
}

async function renderPage() {
  render(<SequencePage />);
  await flush();
}

async function openProblem(mode: "quest" | "practice") {
  if (mode === "quest") {
    fireEvent.click(screen.getByRole("button", { name: "Quest" }));
  }
  fireEvent.click(screen.getByRole("button", { name: /chain rule/ }));
  await flush();
  expect(screen.getByRole("heading", { name: "Your solution" })).toBeInTheDocument();
}

/** Place a step from the bank through the real click path. */
async function clickStep(name: RegExp) {
  fireEvent.click(screen.getByRole("button", { name }));
  await flush();
}

function wireServer(server: SequenceServer) {
  vi.mocked(sequenceApi.createSequenceProblem).mockImplementation(async () => server.snapshot());
  vi.mocked(sequenceApi.placeSequenceStep).mockImplementation(async (problemId, stepId, index) =>
    server.place(problemId, stepId, index),
  );
  vi.mocked(sequenceApi.removeSequenceStep).mockImplementation(async (problemId, stepId) =>
    server.remove(problemId, stepId),
  );
}

function solutionPanel(): HTMLElement {
  const panel = screen.getByRole("heading", { name: "Your solution" }).closest("section");
  if (!panel) throw new Error("solution panel missing");
  return panel;
}

/** The HUD row that carries the ring, the timer, and the sound toggle. */
function hud(): HTMLElement {
  const row = screen.getByRole("timer").parentElement;
  if (!row) throw new Error("hud row missing");
  return row;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(knowledge.listKnowledgeBases).mockResolvedValue([{ name: "calculus" }]);
  vi.mocked(sequenceApi.getSequenceOutline).mockResolvedValue(OUTLINE);
  vi.mocked(sound.soundEnabled).mockReturnValue(false);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("quest mode graded flow", () => {
  it("P1-8: rewards a clean solve with combo, glow, celebration, and server progress", async () => {
    const server = makeSequenceServer();
    wireServer(server);
    await renderPage();

    // The toggle starts on practice with its helper sentence.
    expect(screen.getByRole("button", { name: "Practice" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Quest" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Assemble the whole solution, then check it.")).toBeInTheDocument();

    await openProblem("quest");
    expect(screen.getByText("Place one step at a time and build a combo.")).toBeInTheDocument();
    // Quest grades per placement, so the whole-answer check disappears.
    expect(screen.queryByRole("button", { name: "Check answer" })).toBeNull();
    expect(screen.getByRole("timer")).toHaveTextContent("00:00");

    await clickStep(/outer function/);
    expect(sequenceApi.placeSequenceStep).toHaveBeenCalledWith("q1", "s_outer", 0);
    expect(within(solutionPanel()).getByText(/outer function/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /outer function/ })).toBeNull();
    expect(screen.getByText("Great placement.")).toBeInTheDocument();
    // The badge stays hidden at combo 1 so a placement never celebrates itself.
    expect(screen.queryByText(/^Combo ×/)).toBeNull();
    expect(solutionPanel().className).toContain(ACCEPT_GLOW);
    expect(vi.mocked(sound.playCombo)).toHaveBeenCalledWith(1);

    // The glow is a 600 ms flash, not a permanent state.
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(solutionPanel().className).not.toContain(ACCEPT_GLOW);

    await clickStep(/inner derivative/);
    expect(sequenceApi.placeSequenceStep).toHaveBeenCalledWith("q1", "s_inner", 1);

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Correct. Well done.")).toBeInTheDocument();
    expect(within(dialog).getByText("Solved in 00:00")).toBeInTheDocument();
    expect(within(dialog).getByText("Best combo ×2")).toBeInTheDocument();
    expect(within(dialog).getByText("Solved 3 of 5")).toBeInTheDocument();
    expect(within(dialog).getByText("Full explanation")).toBeInTheDocument();
    expect(within(dialog).getByText(SOLVED_EXPLANATION)).toBeInTheDocument();
    expect(vi.mocked(sound.playSuccess)).toHaveBeenCalledTimes(1);

    // The frozen combo keeps the badge lit behind the celebration.
    expect(screen.getByText("Combo ×2")).toBeInTheDocument();
    // Ring and card show the SERVER payload's progress, never a local count.
    expect(within(hud()).getByText("Solved 3 of 5")).toBeInTheDocument();
    expect(screen.getByText("Solved 3 of 5 for this topic")).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveTextContent("00:00");

    // Leaving folds the server progress into the outline exactly once.
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    await flush();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: /chain rule/ })).toHaveTextContent("Solved 3 of 5");
    expect(screen.getByRole("button", { name: /limits/ })).toHaveTextContent("Solved 0 of 5");
  });

  it("P1-9: a rejection drops the badge, flashes destructive, and re-arms at combo 1", async () => {
    const server = makeSequenceServer(FOUR_PROBLEM, FOUR_IDS);
    wireServer(server);
    await renderPage();
    await openProblem("quest");

    await clickStep(/First move/);
    await clickStep(/Second move/);
    expect(screen.getByText("Combo ×2")).toBeInTheDocument();
    expect(screen.getByText("Nice — that step belongs there.")).toBeInTheDocument();

    await clickStep(/tempting mistake/);
    expect(sequenceApi.placeSequenceStep).toHaveBeenLastCalledWith("q4", "s_trap", 2);
    expect(screen.queryByText(/^Combo ×/)).toBeNull();
    expect(solutionPanel().className).toContain(REJECT_GLOW);
    expect(screen.getByText("Not quite. Try again.")).toBeInTheDocument();
    expect(vi.mocked(sound.playBreak)).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(solutionPanel().className).not.toContain(REJECT_GLOW);
    // The miss dismisses itself after exactly its 3 s lifetime.
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByText("Not quite. Try again.")).toBeNull();

    // The next accept re-arms at combo 1: praise, glow, and no badge yet.
    await clickStep(/Third move/);
    expect(screen.getByText("Great placement.")).toBeInTheDocument();
    expect(screen.queryByText(/^Combo ×/)).toBeNull();
    expect(solutionPanel().className).toContain(ACCEPT_GLOW);
  });

  it("P1-10: removing a step truncates the board server-side and zeroes the combo", async () => {
    const server = makeSequenceServer(FOUR_PROBLEM, FOUR_IDS);
    wireServer(server);
    await renderPage();
    await openProblem("quest");

    await clickStep(/First move/);
    await clickStep(/Second move/);
    expect(screen.getByText("Combo ×2")).toBeInTheDocument();

    const removeButtons = screen.getAllByRole("button", { name: "Remove this step" });
    expect(removeButtons).toHaveLength(2);
    fireEvent.click(removeButtons[0]);
    await flush();

    expect(sequenceApi.removeSequenceStep).toHaveBeenCalledWith("q4", "s_a");
    // Removing s_a truncates everything after it on the server record.
    expect(within(solutionPanel()).queryByText(/First move|Second move/)).toBeNull();
    expect(within(solutionPanel()).getByText(/Click a step to add it/)).toBeInTheDocument();
    expect(screen.queryByText(/^Combo ×/)).toBeNull();
    expect(vi.mocked(sound.playBreak)).toHaveBeenCalledTimes(1);
    // Both steps are back in the bank.
    expect(screen.getByRole("button", { name: /First move/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Second move/ })).toBeInTheDocument();
  });

  it("P1-11: a 409 is absorbed silently and the real solve still celebrates once", async () => {
    const server = makeSequenceServer();
    wireServer(server);
    await renderPage();
    await openProblem("quest");

    // The server moved on (solved elsewhere); the client board does not know.
    vi.mocked(sequenceApi.placeSequenceStep).mockRejectedValueOnce(
      new SequenceRequestError(409, SOLVED_CONFLICT),
    );
    await clickStep(/outer function/);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Could not check that step.")).toBeNull();
    expect(screen.queryByText(SOLVED_CONFLICT)).toBeNull();
    expect(screen.queryByText("Great placement.")).toBeNull();
    expect(screen.queryByText(/^Combo ×/)).toBeNull();
    expect(vi.mocked(sound.playCombo)).not.toHaveBeenCalled();
    expect(vi.mocked(sound.playBreak)).not.toHaveBeenCalled();
    expect(vi.mocked(sound.playSuccess)).not.toHaveBeenCalled();

    // Solving for real afterwards still celebrates exactly once.
    await clickStep(/outer function/);
    await clickStep(/inner derivative/);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(vi.mocked(sound.playSuccess)).toHaveBeenCalledTimes(1);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Solved 3 of 5")).toBeInTheDocument();
    expect(within(hud()).getByText("Solved 3 of 5")).toBeInTheDocument();
  });

  it("P1-12: practice mode is untouched — local assembly, zero place/remove calls", async () => {
    const server = makeSequenceServer(PRACTICE_PROBLEM);
    wireServer(server);
    vi.mocked(sequenceApi.checkSequenceAnswer).mockResolvedValue({
      solved: true,
      marks: ["correct", "correct"],
      problem: {
        ...PRACTICE_PROBLEM,
        placed_ids: [...CORRECT_IDS],
        solved: true,
        explanation: SOLVED_EXPLANATION,
        progress: { solved: 3, goal: 5 },
      },
    });
    vi.mocked(sequenceApi.requestSequenceHint).mockResolvedValue({
      hint: "Start with the outer function.",
    });
    await renderPage();
    await openProblem("practice");
    expect(sequenceApi.createSequenceProblem).toHaveBeenCalledWith("calculus", "chain rule", "practice");

    // No combo surfaces at all in practice.
    expect(screen.queryByText(/^Combo ×/)).toBeNull();
    const check = screen.getByRole("button", { name: "Check answer" });
    expect(check).toBeDisabled();

    await clickStep(/outer function/);
    await clickStep(/inner derivative/);
    expect(check).toBeEnabled();
    expect(sequenceApi.placeSequenceStep).not.toHaveBeenCalled();

    // Practice hints still carry the assembled list.
    fireEvent.click(screen.getByRole("button", { name: "Get a hint" }));
    await flush();
    expect(sequenceApi.requestSequenceHint).toHaveBeenCalledWith("p1", ["s_outer", "s_inner"]);
    expect(screen.getByText("Start with the outer function.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await flush();

    // Removing is local, too.
    fireEvent.click(screen.getAllByRole("button", { name: "Remove this step" })[1]);
    await flush();
    expect(sequenceApi.removeSequenceStep).not.toHaveBeenCalled();
    expect(within(solutionPanel()).queryByText(/inner derivative/)).toBeNull();

    await clickStep(/inner derivative/);
    fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
    await flush();
    expect(sequenceApi.checkSequenceAnswer).toHaveBeenCalledWith("p1", ["s_outer", "s_inner"]);

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Solved in 00:00")).toBeInTheDocument();
    // Practice has no combo, so the celebration hides the best-combo row.
    expect(within(dialog).queryByText(/Best combo/)).toBeNull();
    expect(within(dialog).getByText("Solved 3 of 5")).toBeInTheDocument();
    expect(vi.mocked(sound.playSuccess)).toHaveBeenCalledTimes(1);
    // The solved board keeps the graded marks and the inline explanation.
    expect(screen.getByRole("heading", { level: 2, name: "Full explanation" })).toBeInTheDocument();
    expect(sequenceApi.placeSequenceStep).not.toHaveBeenCalled();
    expect(sequenceApi.removeSequenceStep).not.toHaveBeenCalled();
  });

  it("P1-13: the mode toggle locks while a problem is open and the next problem carries it", async () => {
    wireServer(makeSequenceServer());
    await renderPage();
    await openProblem("quest");

    expect(screen.getByRole("button", { name: "Practice" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Quest" })).toBeDisabled();

    await clickStep(/outer function/);
    await clickStep(/inner derivative/);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    wireServer(makeSequenceServer({ ...QUEST_PROBLEM, problem_id: "q2" }));
    fireEvent.click(screen.getByRole("button", { name: "Next problem" }));
    await flush();

    expect(screen.getByRole("heading", { name: "Your solution" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("timer")).toHaveTextContent("00:00");
    expect(within(solutionPanel()).getByText(/Click a step to add it/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Practice" })).toBeDisabled();
    expect(vi.mocked(sequenceApi.createSequenceProblem).mock.calls).toEqual([
      ["calculus", "chain rule", "quest"],
      ["calculus", "chain rule", "quest"],
    ]);
  });

  it("P1-14 + RT-8: no combo, timing, or scoring data ever leaves the client", async () => {
    const server = makeSequenceServer(FOUR_PROBLEM, FOUR_IDS);
    wireServer(server);
    vi.mocked(sequenceApi.requestSequenceHint).mockResolvedValue({ hint: "One step at a time." });
    await renderPage();
    await openProblem("quest");
    await clickStep(/First move/);
    await clickStep(/tempting mistake/);
    fireEvent.click(screen.getAllByRole("button", { name: "Remove this step" })[0]);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Get a hint" }));
    await flush();

    // Switch to practice so the check body is covered as well.
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Practice" }));
    wireServer(makeSequenceServer(PRACTICE_PROBLEM));
    vi.mocked(sequenceApi.checkSequenceAnswer).mockResolvedValue({
      solved: false,
      marks: ["correct", "incorrect"],
      problem: PRACTICE_PROBLEM,
    });
    await openProblem("practice");
    await clickStep(/outer function/);
    await clickStep(/inner derivative/);
    fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
    await flush();

    const bodies = [
      ...vi.mocked(sequenceApi.createSequenceProblem).mock.calls,
      ...vi.mocked(sequenceApi.placeSequenceStep).mock.calls,
      ...vi.mocked(sequenceApi.removeSequenceStep).mock.calls,
      ...vi.mocked(sequenceApi.requestSequenceHint).mock.calls,
      ...vi.mocked(sequenceApi.checkSequenceAnswer).mock.calls,
    ].map(call => JSON.stringify(call));
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      // P1-14: game feel stays client-side.
      expect(body).not.toMatch(/combo|duration|timer|xp|score|peak|sound/i);
      // RT-8: no timing data in any request.
      expect(body).not.toMatch(/elapsed|seconds|millis|started|timestamp|time/i);
    }
  });

  it("P1-15: the combo comes only from the reducer, never from response data", () => {
    const pageSrc = readFileSync(
      resolve(process.cwd(), "components/learning/sequence/SequencePage.tsx"),
      "utf8",
    );
    const apiSrc = readFileSync(resolve(process.cwd(), "lib/sequence-api.ts"), "utf8");

    // Attempts and placement history stay server-side: the client cannot
    // recompute or replay the combo from them.
    expect(pageSrc).not.toMatch(/attempts|placement_events/);
    expect(apiSrc).not.toMatch(/attempts|placement_events/);

    // The combo state moves through exactly one site: the pure reducer.
    expect(pageSrc.match(/setCombo\(/g)).toHaveLength(1);
    expect(pageSrc).toMatch(/nextCombo\(comboRef\.current, event\)/);

    // The click handler itself is feedback-free; everything happens in the
    // response path after the server answered.
    const addStep = pageSrc.match(/function addStep[\s\S]*?\n {2}\}/)?.[0] ?? "";
    expect(addStep).not.toMatch(/comboDispatch|setCombo|playCombo|playBreak|flashAura|setBanner/);
  });

  it("P1-16: badge, banner, ring, timer, and sound toggle are assistive-tech readable", async () => {
    const server = makeSequenceServer(FOUR_PROBLEM, FOUR_IDS);
    wireServer(server);
    await renderPage();
    await openProblem("quest");
    await clickStep(/First move/);
    await clickStep(/Second move/);

    const badge = screen.getByText("Combo ×2");
    expect(badge).toHaveAttribute("role", "status");
    expect(badge).toHaveAttribute("aria-live", "polite");

    expect(screen.getByText("Nice — that step belongs there.")).toHaveAttribute("role", "status");

    const ring = hud().querySelector("svg");
    expect(ring).not.toBeNull();
    expect(ring).toHaveAttribute("aria-hidden", "true");
    const ringText = within(hud()).getByText("Solved 2 of 5");
    expect(ringText.className).toContain("sr-only");

    expect(screen.getByRole("timer")).toHaveTextContent("00:00");

    const soundButton = screen.getByRole("button", { name: "Sound" });
    expect(soundButton).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(soundButton);
    await flush();
    expect(soundButton).toHaveAttribute("aria-pressed", "true");
  });

  it("P1-17: the hint dialog sends no board in quest and Escape returns focus", async () => {
    const server = makeSequenceServer();
    wireServer(server);
    vi.mocked(sequenceApi.requestSequenceHint).mockResolvedValue({
      hint: "Look at the inner function.",
    });
    await renderPage();
    await openProblem("quest");

    const hintButton = screen.getByRole("button", { name: "Get a hint" });
    // A real click focuses first; jsdom's dispatchEvent does not.
    hintButton.focus();
    fireEvent.click(hintButton);
    await flush();

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Hint")).toBeInTheDocument();
    expect(within(dialog).getByText("Look at the inner function.")).toBeInTheDocument();
    // Quest keeps its board on the server: the hint request carries no list.
    expect(sequenceApi.requestSequenceHint).toHaveBeenCalledWith("q1", undefined);

    fireEvent.keyDown(window, { key: "Escape" });
    await flush();
    expect(screen.queryByRole("dialog")).toBeNull();
    // Focus returns to the control that opened the dialog.
    expect(document.activeElement).toBe(hintButton);
  });
});

describe("quest mode realtime behavior", () => {
  it("RT-1: a stale response resolving after a newer one cannot rewind the board", async () => {
    const server = makeSequenceServer();
    const queue = makeLatentQueue<[string, string, number], PlaceResult>();
    wireServer(server);
    vi.mocked(sequenceApi.placeSequenceStep).mockImplementation(queue.fn);
    await renderPage();
    await openProblem("quest");

    // First view: a placement parks in flight, then the learner leaves.
    fireEvent.click(screen.getByRole("button", { name: /outer function/ }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    await flush();

    // Re-enter the same problem and place again; this response is newer.
    fireEvent.click(screen.getByRole("button", { name: /chain rule/ }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: /outer function/ }));
    await flush();
    expect(queue.pending).toHaveLength(2);

    await act(async () => {
      queue.pending[1].settle((problemId, stepId, index) => server.place(problemId, stepId, index));
    });
    await flush();
    expect(screen.getByText("Great placement.")).toBeInTheDocument();
    expect(within(solutionPanel()).getByText(/outer function/)).toBeInTheDocument();

    // The abandoned view's response lands late with a contradicting payload.
    await act(async () => {
      queue.pending[0].resolve({ accepted: false, problem: { ...QUEST_PROBLEM, placed_ids: [] } });
    });
    await flush();

    // Both guards (view + placement sequence) drop it.
    expect(within(solutionPanel()).getByText(/outer function/)).toBeInTheDocument();
    expect(screen.getByText("Great placement.")).toBeInTheDocument();
    expect(screen.queryByText("Not quite. Try again.")).toBeNull();
    expect(solutionPanel().className).not.toContain(REJECT_GLOW);
    expect(vi.mocked(sound.playBreak)).not.toHaveBeenCalled();
  });

  it("RT-2: a response arriving after leaving the problem changes nothing", async () => {
    const server = makeSequenceServer();
    const queue = makeLatentQueue<[string, string, number], PlaceResult>();
    wireServer(server);
    vi.mocked(sequenceApi.placeSequenceStep).mockImplementation(queue.fn);
    await renderPage();
    await openProblem("quest");

    fireEvent.click(screen.getByRole("button", { name: /outer function/ }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    await flush();
    expect(screen.queryByRole("heading", { name: "Your solution" })).toBeNull();

    await act(async () => {
      queue.pending[0].settle((problemId, stepId, index) => server.place(problemId, stepId, index));
    });
    await flush();

    expect(screen.queryByRole("heading", { name: "Your solution" })).toBeNull();
    expect(screen.queryByText("Great placement.")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(vi.mocked(sound.playCombo)).not.toHaveBeenCalled();
    // The outline is still intact and usable.
    expect(screen.getByRole("button", { name: /chain rule/ })).toBeInTheDocument();
  });

  it("RT-3: a response from the old topic cannot paint the new problem", async () => {
    const server = makeSequenceServer();
    const queue = makeLatentQueue<[string, string, number], PlaceResult>();
    const limitsProblem: SequenceProblem = { ...QUEST_PROBLEM, problem_id: "l1" };
    vi.mocked(sequenceApi.createSequenceProblem).mockImplementation(async (_kb, topic) =>
      topic === "limits" ? { ...limitsProblem } : server.snapshot(),
    );
    vi.mocked(sequenceApi.placeSequenceStep).mockImplementation(queue.fn);
    await renderPage();
    await openProblem("quest");

    fireEvent.click(screen.getByRole("button", { name: /outer function/ }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: /limits/ }));
    await flush();
    expect(screen.getByRole("heading", { name: "Your solution" })).toBeInTheDocument();
    expect(within(solutionPanel()).getByText(/Click a step to add it/)).toBeInTheDocument();

    // The chain-rule response lands while the limits problem is on screen.
    await act(async () => {
      queue.pending[0].settle((problemId, stepId, index) => server.place(problemId, stepId, index));
    });
    await flush();

    expect(within(solutionPanel()).queryByText(/outer function/)).toBeNull();
    expect(screen.queryByText("Great placement.")).toBeNull();
    expect(vi.mocked(sound.playCombo)).not.toHaveBeenCalled();
    // The old topic's outline is gone; the new problem owns the screen.
    expect(screen.queryByRole("button", { name: /chain rule/ })).toBeNull();
  });

  it("RT-4: a double click fires exactly one placement and disarms the bank", async () => {
    const server = makeSequenceServer();
    const queue = makeLatentQueue<[string, string, number], PlaceResult>();
    wireServer(server);
    vi.mocked(sequenceApi.placeSequenceStep).mockImplementation(queue.fn);
    await renderPage();
    await openProblem("quest");

    const bankButton = screen.getByRole("button", { name: /outer function/ });
    // Same-tick double click: the busy ref swallows the second handler run.
    act(() => {
      fireEvent.click(bankButton);
      fireEvent.click(bankButton);
    });
    expect(queue.pending).toHaveLength(1);

    // After the re-render the whole bank is disabled while in flight.
    expect(bankButton).toBeDisabled();
    fireEvent.click(bankButton);
    expect(queue.pending).toHaveLength(1);

    await act(async () => {
      queue.pending[0].settle((problemId, stepId, index) => server.place(problemId, stepId, index));
    });
    await flush();
    expect(within(solutionPanel()).getByText(/outer function/)).toBeInTheDocument();
    expect(vi.mocked(sound.playCombo)).toHaveBeenCalledTimes(1);
  });

  it("RT-5: the solve celebration fires once per problem and re-arms for the next", async () => {
    wireServer(makeSequenceServer());
    await renderPage();
    await openProblem("quest");

    await clickStep(/outer function/);
    await clickStep(/inner derivative/);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    // The accept and the solve land in the same response; no double fanfare.
    expect(vi.mocked(sound.playSuccess)).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await flush();
    expect(screen.queryByRole("dialog")).toBeNull();

    wireServer(makeSequenceServer({ ...QUEST_PROBLEM, problem_id: "q2" }));
    fireEvent.click(screen.getByRole("button", { name: "Next problem" }));
    await flush();
    expect(screen.getByRole("heading", { name: "Your solution" })).toBeInTheDocument();

    await clickStep(/outer function/);
    await clickStep(/inner derivative/);
    // The guard was reset by startTopic: the second problem celebrates too.
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(vi.mocked(sound.playSuccess)).toHaveBeenCalledTimes(2);
    expect(within(screen.getByRole("dialog")).getByText("Best combo ×2")).toBeInTheDocument();
  });

  it("RT-6: nothing increments optimistically while a placement is in flight", async () => {
    const server = makeSequenceServer(FOUR_PROBLEM, FOUR_IDS);
    const queue = makeLatentQueue<[string, string, number], PlaceResult>();
    wireServer(server);
    vi.mocked(sequenceApi.placeSequenceStep).mockImplementation(queue.fn);
    await renderPage();
    await openProblem("quest");

    fireEvent.click(screen.getByRole("button", { name: /First move/ }));
    await flush();
    act(() => {
      vi.advanceTimersByTime(400);
    });
    // t = 400 ms with no response: no badge, no banner, no glow, no sound.
    expect(queue.pending).toHaveLength(1);
    expect(screen.queryByText(/^Combo ×/)).toBeNull();
    expect(screen.queryByText("Great placement.")).toBeNull();
    expect(solutionPanel().className).not.toContain("shadow-");
    expect(vi.mocked(sound.playCombo)).not.toHaveBeenCalled();
    expect(within(solutionPanel()).queryByText(/First move/)).toBeNull();

    await act(async () => {
      queue.pending[0].settle((problemId, stepId, index) => server.place(problemId, stepId, index));
    });
    await flush();
    expect(screen.getByText("Great placement.")).toBeInTheDocument();
    expect(vi.mocked(sound.playCombo)).toHaveBeenCalledWith(1);
    expect(solutionPanel().className).toContain(ACCEPT_GLOW);

    // The badge appears only once the second response has actually landed.
    fireEvent.click(screen.getByRole("button", { name: /Second move/ }));
    await flush();
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.queryByText("Combo ×2")).toBeNull();
    await act(async () => {
      queue.pending[1].settle((problemId, stepId, index) => server.place(problemId, stepId, index));
    });
    await flush();
    expect(screen.getByText("Combo ×2")).toBeInTheDocument();
  });

  it("RT-7: a transport failure is not a wrong answer", async () => {
    const server = makeSequenceServer(FOUR_PROBLEM, FOUR_IDS);
    wireServer(server);
    await renderPage();
    await openProblem("quest");

    await clickStep(/First move/);
    await clickStep(/Second move/);
    expect(screen.getByText("Combo ×2")).toBeInTheDocument();

    vi.mocked(sequenceApi.placeSequenceStep).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await clickStep(/Third move/);

    expect(screen.getByText("Failed to fetch")).toBeInTheDocument();
    // The combo survives the outage untouched — no break sound, no miss copy.
    expect(screen.getByText("Combo ×2")).toBeInTheDocument();
    expect(screen.queryByText("Not quite. Try again.")).toBeNull();
    expect(solutionPanel().className).not.toContain(REJECT_GLOW);
    expect(vi.mocked(sound.playBreak)).not.toHaveBeenCalled();

    // Retrying the same step succeeds and the ladder continues from 2.
    await clickStep(/Third move/);
    expect(screen.queryByText("Failed to fetch")).toBeNull();
    expect(screen.getByText("Combo ×3")).toBeInTheDocument();
    expect(vi.mocked(sound.playCombo)).toHaveBeenLastCalledWith(3);
    expect(screen.getByText("Correct. Well done.")).toBeInTheDocument();
  });

  it("RT-9: glow and sound fire per verdict, never per render", async () => {
    const server = makeSequenceServer(FOUR_PROBLEM, FOUR_IDS);
    wireServer(server);
    await renderPage();
    await openProblem("quest");

    await clickStep(/First move/);
    expect(solutionPanel().className).toContain(ACCEPT_GLOW);
    expect(vi.mocked(sound.playCombo)).toHaveBeenCalledTimes(1);

    // An unrelated re-render (style toggle) replays nothing.
    fireEvent.click(screen.getByRole("button", { name: "Symbol only" }));
    await flush();
    expect(vi.mocked(sound.playCombo)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sound.playBreak)).not.toHaveBeenCalled();
    // The aura is time-based, not render-based.
    expect(solutionPanel().className).toContain(ACCEPT_GLOW);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(solutionPanel().className).not.toContain("shadow-");
    fireEvent.click(screen.getByRole("button", { name: "Word and symbol" }));
    await flush();
    expect(solutionPanel().className).not.toContain("shadow-");
    expect(vi.mocked(sound.playCombo)).toHaveBeenCalledTimes(1);

    // The reject paints its own one-shot feedback.
    await clickStep(/tempting mistake/);
    expect(solutionPanel().className).toContain(REJECT_GLOW);
    expect(vi.mocked(sound.playBreak)).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Symbol only" }));
    await flush();
    expect(vi.mocked(sound.playBreak)).toHaveBeenCalledTimes(1);
    expect(solutionPanel().className).toContain(REJECT_GLOW);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(solutionPanel().className).not.toContain("shadow-");
  });

  it("wires the sound toggle through persistence and the autoplay unlock", async () => {
    wireServer(makeSequenceServer());
    await renderPage();
    await openProblem("quest");

    const soundButton = screen.getByRole("button", { name: "Sound" });
    expect(soundButton).toHaveAttribute("aria-pressed", "false");
    expect(vi.mocked(sound.unlockAudio)).not.toHaveBeenCalled();

    // The toggle click is itself the gesture the autoplay rule asks for.
    fireEvent.click(soundButton);
    await flush();
    expect(soundButton).toHaveAttribute("aria-pressed", "true");
    expect(vi.mocked(sound.setSoundEnabled)).toHaveBeenCalledWith(true);
    expect(vi.mocked(sound.unlockAudio)).toHaveBeenCalledTimes(1);

    // The first pointerdown anywhere unlocks once; later ones are ignored.
    fireEvent.pointerDown(screen.getByRole("heading", { name: "Your solution" }));
    await flush();
    expect(vi.mocked(sound.unlockAudio)).toHaveBeenCalledTimes(2);
    fireEvent.pointerDown(soundButton);
    await flush();
    expect(vi.mocked(sound.unlockAudio)).toHaveBeenCalledTimes(2);

    fireEvent.click(soundButton);
    await flush();
    expect(soundButton).toHaveAttribute("aria-pressed", "false");
    expect(vi.mocked(sound.setSoundEnabled)).toHaveBeenLastCalledWith(false);
  });
});

describe("phase-1 audits", () => {
  const LOCALES = ["en", "zh", "de", "fr", "pl", "uk"] as const;
  const PHASE_ONE_KEYS = [
    "Quest",
    "Practice",
    "Sound",
    "Combo ×{{count}}",
    "Best combo ×{{count}}",
    "Solved in {{time}}",
    "Solved {{count}} of {{goal}}",
    "Solved {{count}} of {{goal}} for this topic",
    "Great placement.",
    "Nice — that step belongs there.",
    "Not quite. Try again.",
    "Correct. Well done.",
    "Full explanation",
    "Close",
    "One moment.",
    "Hint",
    "Why this step",
    "Assemble the whole solution, then check it.",
    "Place one step at a time and build a combo.",
    "This problem is checked as a whole. Use quest mode to place single steps.",
    "This problem is solved step by step. Remove a step or place the next one.",
    "Could not check that step.",
  ];

  function readLocale(name: string): Record<string, string> {
    return JSON.parse(readFileSync(resolve(process.cwd(), `locales/${name}/app.json`), "utf8"));
  }

  it("P1-19: every phase-1 key ships in all six locales with matching placeholders", () => {
    const bundles = Object.fromEntries(LOCALES.map(locale => [locale, readLocale(locale)]));
    for (const locale of LOCALES) {
      for (const key of PHASE_ONE_KEYS) {
        const value = bundles[locale][key];
        expect(typeof value, `${locale} is missing "${key}"`).toBe("string");
        const enPlaceholders = (bundles.en[key].match(/{{\w+}}/g) ?? []).sort();
        const localePlaceholders = (value.match(/{{\w+}}/g) ?? []).sort();
        expect(localePlaceholders, `${locale} placeholders for "${key}"`).toEqual(enPlaceholders);
      }
    }
  });

  it("P1-19: en and zh keep full key-set parity", () => {
    const en = Object.keys(readLocale("en"));
    const zh = Object.keys(readLocale("zh"));
    expect(zh).toHaveLength(en.length);
    expect(new Set(zh)).toEqual(new Set(en));
  });

  it("P1-20: no sequence component renders a bare JSX text node", () => {
    const dir = resolve(process.cwd(), "components/learning/sequence");
    const files = readdirSync(dir).filter(name => name.endsWith(".tsx"));
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const text = readFileSync(resolve(dir, name), "utf8");
      const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const stray: string[] = [];
      const walk = (node: ts.Node) => {
        if (ts.isJsxText(node) && /[A-Za-z]/.test(node.text)) stray.push(node.text.trim());
        node.forEachChild(walk);
      };
      walk(source);
      expect(stray, `${name} renders untranslated text`).toEqual([]);
    }
  });
});
