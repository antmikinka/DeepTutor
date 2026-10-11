/**
 * Shared fakes for the sequence specs: one factory reproduces the real
 * response invariants (place answers with { accepted, problem }, remove with
 * the bare problem, a solve flips solved + explanation + progress exactly
 * once, and every post-solve mutation is a 409), and a deferred queue lets a
 * test decide when — and in which order — those responses land.
 */

import {
  SequenceRequestError,
  type PlaceResult,
  type SequenceProblem,
} from "@/lib/sequence-api";

export const SOLVED_CONFLICT = "This solution is already complete.";

export const QUEST_PROBLEM: SequenceProblem = {
  problem_id: "q1",
  question: "Rebuild the solution for $\\cos(x^2)$.",
  formulas: ["$\\cos(x^2)$"],
  steps: [
    { id: "s_outer", explanation: "Differentiate the outer function", math: "$\\sin(x^2)$" },
    { id: "s_inner", explanation: "Multiply by the inner derivative", math: "$2x\\cos(x^2)$" },
    { id: "s_trap", explanation: "A tempting mistake", math: "$2x\\cos(x)$" },
  ],
  solution_length: 2,
  placed_ids: [],
  solved: false,
  mode: "quest",
  explanation: null,
  progress: { solved: 2, goal: 5 },
  sources: [{ title: "calculus/chain_rule.pdf" }],
};

export const PRACTICE_PROBLEM: SequenceProblem = {
  ...QUEST_PROBLEM,
  problem_id: "p1",
  mode: "practice",
};

export const GUIDED_PROBLEM: SequenceProblem = {
  ...QUEST_PROBLEM,
  problem_id: "g1",
  mode: "guided",
};

/** The server-side truth the client must never see: which order solves it. */
export const CORRECT_IDS = ["s_outer", "s_inner"];

export const SOLVED_EXPLANATION = "Outer function first, then the inner derivative.";

export interface SequenceServer {
  place(problemId: string, stepId: string, index: number): PlaceResult;
  remove(problemId: string, stepId: string): SequenceProblem;
  snapshot(): SequenceProblem;
}

/**
 * Stateful fake of the graded quest endpoints. Acceptance follows the prefix
 * rule: only the exact next correct step at the tail is accepted.
 */
export function makeSequenceServer(
  initial: SequenceProblem = QUEST_PROBLEM,
  correctIds: readonly string[] = CORRECT_IDS,
): SequenceServer {
  let record: SequenceProblem = { ...initial, placed_ids: [...initial.placed_ids] };

  function guardSolved(): void {
    if (record.solved) throw new SequenceRequestError(409, SOLVED_CONFLICT);
  }

  return {
    place(problemId: string, stepId: string, index: number): PlaceResult {
      guardSolved();
      if (problemId !== record.problem_id) {
        throw new SequenceRequestError(404, "That problem is no longer available.");
      }
      if (record.placed_ids.includes(stepId)) {
        throw new SequenceRequestError(409, "That step is already in your solution.");
      }
      const accepted = stepId === correctIds[record.placed_ids.length] && index === record.placed_ids.length;
      if (accepted) {
        const placedIds = [...record.placed_ids, stepId];
        const solved = placedIds.length === correctIds.length;
        record = {
          ...record,
          placed_ids: placedIds,
          solved,
          explanation: solved ? SOLVED_EXPLANATION : record.explanation,
          progress: solved
            ? { solved: record.progress.solved + 1, goal: record.progress.goal }
            : record.progress,
        };
      }
      return { accepted, problem: { ...record, placed_ids: [...record.placed_ids] } };
    },
    remove(problemId: string, stepId: string): SequenceProblem {
      guardSolved();
      if (problemId !== record.problem_id) {
        throw new SequenceRequestError(404, "That problem is no longer available.");
      }
      const cut = record.placed_ids.indexOf(stepId);
      if (cut >= 0) record = { ...record, placed_ids: record.placed_ids.slice(0, cut) };
      return { ...record, placed_ids: [...record.placed_ids] };
    },
    snapshot(): SequenceProblem {
      return { ...record, placed_ids: [...record.placed_ids] };
    },
  };
}

export interface LatentCall<Args extends unknown[], Result> {
  args: Args;
  /** Run the real server fake with the parked arguments and settle with it. */
  settle: (impl: (...args: Args) => Result) => void;
  resolve: (value: Result) => void;
  reject: (reason: unknown) => void;
}

export interface LatentQueue<Args extends unknown[], Result> {
  /** Hand this to mockImplementation; every call parks on the queue. */
  fn: (...args: Args) => Promise<Result>;
  pending: LatentCall<Args, Result>[];
}

/**
 * Deferred queue: calls never resolve on their own, so a test controls the
 * exact arrival order (RT-1), staleness (RT-2/RT-3), and latency (RT-6).
 */
export function makeLatentQueue<Args extends unknown[], Result>(): LatentQueue<Args, Result> {
  const pending: LatentCall<Args, Result>[] = [];
  const fn = (...args: Args): Promise<Result> =>
    new Promise<Result>((resolve, reject) => {
      pending.push({
        args,
        settle: impl => {
          try {
            resolve(impl(...args));
          } catch (error) {
            reject(error);
          }
        },
        resolve,
        reject,
      });
    });
  return { fn, pending };
}

export function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
