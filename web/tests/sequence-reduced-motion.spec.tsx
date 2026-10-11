/**
 * P1-18: with prefers-reduced-motion honored, the quest HUD keeps every
 * verdict and state but animates nothing. framer-motion is mocked the way the
 * preference behaves in the wild: useReducedMotion answers true and the `m`
 * factory drops all motion-only props, so anything still animating would have
 * to come from a hardcoded class — and those are asserted away too.
 */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComboBadge } from "@/components/learning/sequence/ComboBadge";
import { SequenceBanner } from "@/components/learning/sequence/SequenceBanner";
import { SequencePage } from "@/components/learning/sequence/SequencePage";
import { SolveCelebration } from "@/components/learning/sequence/SolveCelebration";
import { initI18n } from "@/i18n/init";
import * as knowledge from "@/features/knowledge/api/client";
import * as sequenceApi from "@/lib/sequence-api";
import * as sound from "@/lib/sequence-sound";
import type { SequenceOutline } from "@/lib/sequence-api";
import { makeSequenceServer } from "./helpers/sequence-mocks";

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
vi.mock("framer-motion", () => {
  const MOTION_ONLY = new Set([
    "initial",
    "animate",
    "exit",
    "transition",
    "variants",
    "whileHover",
    "whileTap",
    "whileFocus",
    "whileInView",
    "whileDrag",
    "layout",
    "layoutId",
    "drag",
    "dragConstraints",
  ]);
  const plain = (tag: string) => {
    const Component = (props: Record<string, unknown>) => {
      const clean: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(props)) {
        if (!MOTION_ONLY.has(key)) clean[key] = value;
      }
      return createElement(tag, clean as ComponentProps<"span">);
    };
    Component.displayName = `PlainMotion(${tag})`;
    return Component;
  };
  const m = new Proxy({} as Record<string, unknown>, {
    get: (_target, tag) => (typeof tag === "string" ? plain(tag) : undefined),
  });
  return { m, useReducedMotion: () => true };
});

initI18n("en");

const OUTLINE: SequenceOutline = {
  knowledge_base: "calculus",
  source: "files",
  modules: [
    { id: "m1", category: "Derivatives", name: "Chain rule", topic: "chain rule", solved: 2, goal: 5 },
  ],
};

async function flush(rounds = 4) {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }
}

describe("quest hud with prefers-reduced-motion", () => {
  it("keeps every component's content and drops all motion styling", () => {
    const badge = render(<ComboBadge combo={2} />);
    expect(screen.getByText("Combo ×2")).toBeInTheDocument();
    expect(badge.container.innerHTML).not.toMatch(/opacity|transform|transition/i);
    badge.unmount();

    const banner = render(<SequenceBanner verdict="incorrect" />);
    expect(screen.getByText("Not quite. Try again.")).toBeInTheDocument();
    expect(banner.container.innerHTML).not.toMatch(/opacity|transform|transition/i);
    banner.unmount();

    const celebration = render(
      <SolveCelebration
        open
        seconds={65}
        peakCombo={3}
        progress={{ solved: 1, goal: 5 }}
        explanation="Because the inner function changes first."
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Solved in 01:05")).toBeInTheDocument();
    expect(screen.getByText("Best combo ×3")).toBeInTheDocument();
    expect(screen.getByText(/inner function changes first/)).toBeInTheDocument();
    expect(celebration.container.innerHTML).not.toMatch(/opacity:|transform:/i);
    celebration.unmount();
  });

  describe("page", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.mocked(knowledge.listKnowledgeBases).mockResolvedValue([{ name: "calculus" }]);
      vi.mocked(sequenceApi.getSequenceOutline).mockResolvedValue(OUTLINE);
      vi.mocked(sound.soundEnabled).mockReturnValue(false);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("keeps the verdict glow as state but removes its transition", async () => {
      const server = makeSequenceServer();
      vi.mocked(sequenceApi.createSequenceProblem).mockImplementation(async () => server.snapshot());
      vi.mocked(sequenceApi.placeSequenceStep).mockImplementation(async (problemId, stepId, index) =>
        server.place(problemId, stepId, index),
      );
      render(<SequencePage />);
      await flush();
      fireEvent.click(screen.getByRole("button", { name: "Quest" }));
      fireEvent.click(screen.getByRole("button", { name: /chain rule/ }));
      await flush();

      const panel = screen.getByRole("heading", { name: "Your solution" }).closest("section");
      if (!panel) throw new Error("solution panel missing");
      // reduced motion: the page never adds the shadow transition class.
      expect(panel.className).not.toContain("transition-shadow");

      fireEvent.click(screen.getByRole("button", { name: /outer function/ }));
      await flush();
      // The verdict itself survives as plain state.
      expect(panel.className).toContain("shadow-[0_0_0_2px_var(--success)]");
      expect(screen.getByText("Great placement.")).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(panel.className).not.toContain("shadow-");
      expect(within(panel).getByText(/outer function/)).toBeInTheDocument();
    });
  });
});
