"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import InlineMarkdown from "@/components/common/InlineMarkdown";
import MarkdownRenderer from "@/components/common/MarkdownRenderer";
import { LearningShell } from "@/components/learning/LearningShell";
import { ComboBadge } from "@/components/learning/sequence/ComboBadge";
import { ProblemTimer } from "@/components/learning/sequence/ProblemTimer";
import { ProgressRing } from "@/components/learning/sequence/ProgressRing";
import { SequenceBanner } from "@/components/learning/sequence/SequenceBanner";
import { SequenceModules } from "@/components/learning/sequence/SequenceModules";
import { SolutionRing } from "@/components/learning/sequence/SolutionRing";
import { SolveCelebration } from "@/components/learning/sequence/SolveCelebration";
import { selectClass, selectOptionClass } from "@/components/settings/shared";
import { listKnowledgeBases, type KnowledgeBaseSummary } from "@/features/knowledge/api/client";
import { knowledgeBaseRef } from "@/lib/knowledge-helpers";
import {
  checkSequenceAnswer,
  createSequenceProblem,
  explainSequenceStep,
  getSequenceOutline,
  placeSequenceStep,
  rebuildSequenceOutline,
  removeSequenceStep,
  requestSequenceHint,
  SequenceRequestError,
  type SequenceCheckResult,
  type SequenceMode,
  type SequenceOutline,
  type SequenceProblem,
  type SequenceStep,
} from "@/lib/sequence-api";
import { autocheckEnabled, setAutocheckEnabled } from "@/lib/sequence-autocheck";
import { initialCombo, nextCombo, type ComboEvent, type ComboState } from "@/lib/sequence-combo";
import {
  playBreak,
  playCombo,
  playSuccess,
  setSoundEnabled,
  soundEnabled,
  unlockAudio,
} from "@/lib/sequence-sound";
import { Dialog } from "@/shared/ui/Dialog";

type StepStyle = "word" | "symbol";
type StepMark = "correct" | "incorrect";
type OutlinePhase = "idle" | "loading" | "reading" | "ready" | "error";

interface CelebrationData {
  seconds: number;
  peakCombo: number;
  progress: { solved: number; goal: number };
  explanation: string | null;
}

function stepText(step: SequenceStep, style: StepStyle): string {
  if (style === "symbol") return step.math;
  return `${step.explanation} ${step.math}`;
}

function placedClass(mark: StepMark | undefined): string {
  if (mark === "correct") return "border-[var(--success)] bg-[var(--success-surface)]";
  if (mark === "incorrect") {
    return "border-[var(--destructive)] bg-[color-mix(in_srgb,var(--destructive)_14%,var(--background))]";
  }
  return "border-[var(--border)] bg-[var(--background)]";
}

/**
 * Verdict memory for the Available-steps bank: a step a past check proved
 * wrong is greyed behind a red edge, a step it proved right wears green.
 * Both stay clickable — a step wrong at one position can be right at another.
 */
function bankClass(verdict: StepMark | undefined): string {
  const base = "w-full rounded-lg border p-3 text-left disabled:opacity-60";
  if (verdict === "correct") return `${base} border-[var(--success)] bg-[var(--success-surface)]`;
  if (verdict === "incorrect") {
    return `${base} border-[var(--destructive)] bg-[color-mix(in_srgb,var(--destructive)_14%,var(--background))] opacity-60 hover:opacity-100`;
  }
  return `${base} border-[var(--border)] bg-[var(--background)] hover:bg-[var(--muted)]`;
}

export function SequencePage() {
  const { t } = useTranslation();
  const outlineRequest = useRef(0);
  const writingRef = useRef(false);
  const view = useRef(0);
  const [bases, setBases] = useState<KnowledgeBaseSummary[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [knowledgeBase, setKnowledgeBase] = useState("");
  const [customTopic, setCustomTopic] = useState("");
  const [activeTopic, setActiveTopic] = useState("");
  const [outline, setOutline] = useState<SequenceOutline | null>(null);
  const [outlinePhase, setOutlinePhase] = useState<OutlinePhase>("idle");
  const [mode, setMode] = useState<SequenceMode>("practice");
  const [problem, setProblem] = useState<SequenceProblem | null>(null);
  const [assembled, setAssembled] = useState<string[]>([]);
  const [marks, setMarks] = useState<StepMark[] | null>(null);
  // Verdict memory: the last proven mark per step id, surviving edits and
  // removals so a returned bank step keeps its red/green history. Keyed by
  // step id, wiped only on a new problem / leave / knowledge-base change.
  const [verdicts, setVerdicts] = useState<Record<string, StepMark>>({});
  const [autocheck, setAutocheck] = useState(false);
  const [autoInFlight, setAutoInFlight] = useState(false);
  const [banner, setBanner] = useState<StepMark | null>(null);
  const [writing, setWriting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [style, setStyle] = useState<StepStyle>("word");
  const [dialog, setDialog] = useState<{ title: string; body: string } | null>(null);
  const [combo, setCombo] = useState<ComboState>(initialCombo);
  const [aura, setAura] = useState<"accept" | "reject" | null>(null);
  const [celebration, setCelebration] = useState<CelebrationData | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const comboRef = useRef<ComboState>(initialCombo);
  const busyRef = useRef(false);
  const auraTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const solvedCalledRef = useRef(false);
  const placementSeq = useRef(0);
  const startedAt = useRef(0);
  // Auto-check debounce state: a timer handle plus a monotonic sequence so a
  // slow response from an abandoned board is dropped like a stale placement.
  const autocheckRef = useRef(false);
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSeq = useRef(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    // Read the persisted sound and auto-check preferences after mount so
    // server and client render the same initial toggle states.
    setSoundOn(soundEnabled());
    const savedAutocheck = autocheckEnabled();
    autocheckRef.current = savedAutocheck;
    setAutocheck(savedAutocheck);
    return () => {
      if (auraTimer.current) clearTimeout(auraTimer.current);
      if (autoTimer.current) clearTimeout(autoTimer.current);
    };
  }, []);

  useEffect(() => {
    // The browser only resumes audio after a user gesture; arm the unlock on
    // the first pointerdown while sound is on.
    if (!soundOn) return;
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, [soundOn]);

  useEffect(() => {
    let cancelled = false;
    listKnowledgeBases()
      .then(rows => {
        if (cancelled) return;
        setBases(rows);
        if (rows.length === 1) setKnowledgeBase(knowledgeBaseRef(rows[0]));
      })
      .catch(() => {
        if (!cancelled) setLoadError(t("Could not load knowledge bases."));
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    view.current += 1;
    writingRef.current = false;
    setWriting(false);
    if (!knowledgeBase) {
      setOutline(null);
      setOutlinePhase("idle");
      return;
    }
    const id = ++outlineRequest.current;
    let cancelled = false;
    setOutline(null);
    setOutlinePhase("loading");
    setProblem(null);
    setAssembled([]);
    setMarks(null);
    setVerdicts({});
    setAutoInFlight(false);
    autoSeq.current += 1;
    if (autoTimer.current) clearTimeout(autoTimer.current);
    setBanner(null);
    setMessage("");

    void (async () => {
      const current = () => !cancelled && outlineRequest.current === id;
      try {
        const saved = await getSequenceOutline(knowledgeBase);
        if (!current()) return;
        if (saved) {
          setOutline(saved);
          setOutlinePhase("ready");
          return;
        }
        setOutlinePhase("reading");
        const built = await rebuildSequenceOutline(knowledgeBase);
        if (!current()) return;
        setOutline(built);
        setOutlinePhase("ready");
      } catch {
        if (current()) setOutlinePhase("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [knowledgeBase]);

  const byId = useMemo(() => {
    const map = new Map<string, SequenceStep>();
    problem?.steps.forEach(step => map.set(step.id, step));
    return map;
  }, [problem]);

  function comboDispatch(event: ComboEvent): ComboState {
    const next = nextCombo(comboRef.current, event);
    comboRef.current = next;
    setCombo(next);
    return next;
  }

  function flashAura(kind: "accept" | "reject") {
    setAura(kind);
    if (auraTimer.current) clearTimeout(auraTimer.current);
    auraTimer.current = setTimeout(() => setAura(null), 600);
  }

  function enterBusy(): boolean {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    return true;
  }

  function releaseBusy() {
    busyRef.current = false;
    setBusy(false);
  }

  function toggleSound() {
    const next = !soundOn;
    setSoundEnabled(next);
    setSoundOn(next);
    // The toggle click is itself the gesture the autoplay rule asks for, and a
    // one-note blip proves the button did something the instant it is enabled.
    if (next) {
      unlockAudio();
      playCombo(1);
    }
  }

  function toggleAutocheck() {
    const next = !autocheck;
    setAutocheckEnabled(next);
    autocheckRef.current = next;
    setAutocheck(next);
    if (next) scheduleAutocheck(assembled);
    else cancelAutocheck();
  }

  /** Kill any parked auto-check so a late response cannot repaint the board. */
  function cancelAutocheck() {
    autoSeq.current += 1;
    if (autoTimer.current) clearTimeout(autoTimer.current);
    autoTimer.current = null;
    setAutoInFlight(false);
  }

  /** Runs exactly once per problem, whichever response reports the solve. */
  function celebrate(solvedProblem: SequenceProblem) {
    if (solvedCalledRef.current) return;
    solvedCalledRef.current = true;
    const state = comboDispatch({ type: "solve" });
    setCelebration({
      seconds: Math.max(0, Math.floor((Date.now() - startedAt.current) / 1000)),
      peakCombo: state.peak,
      progress: solvedProblem.progress,
      explanation: solvedProblem.explanation,
    });
    playSuccess();
  }

  function refreshOutlineProgress(progress: { solved: number; goal: number }) {
    setOutline(current =>
      current && {
        ...current,
        modules: current.modules.map(module =>
          module.topic.trim() === activeTopic.trim()
            ? { ...module, solved: progress.solved, goal: progress.goal }
            : module,
        ),
      },
    );
  }

  async function readAgain() {
    if (!knowledgeBase || outlinePhase === "loading" || outlinePhase === "reading") return;
    const id = ++outlineRequest.current;
    setOutlinePhase("reading");
    try {
      const built = await rebuildSequenceOutline(knowledgeBase);
      if (outlineRequest.current !== id) return;
      setOutline(built);
      setOutlinePhase("ready");
    } catch {
      if (outlineRequest.current === id) setOutlinePhase("error");
    }
  }

  async function startTopic(nextTopic: string) {
    const topic = nextTopic.trim();
    if (!knowledgeBase) {
      setMessage(t("Select a knowledge base first."));
      return;
    }
    if (!topic) {
      setMessage(t("Enter a topic first."));
      return;
    }
    if (writingRef.current) return;
    const viewId = ++view.current;
    placementSeq.current += 1;
    writingRef.current = true;
    setWriting(true);
    setMessage("");
    try {
      const next = await createSequenceProblem(knowledgeBase, topic, mode);
      if (view.current !== viewId) return;
      setActiveTopic(topic);
      setProblem(next);
      setAssembled([]);
      setMarks(null);
      setVerdicts({});
      cancelAutocheck();
      setBanner(null);
      setCelebration(null);
      setAura(null);
      comboDispatch({ type: "reset" });
      solvedCalledRef.current = false;
      startedAt.current = Date.now();
    } catch (error) {
      if (view.current !== viewId) return;
      // The server answers with fixed English sentences that double as i18n
      // keys; a model-authored detail has no key and passes through as-is.
      setMessage(
        error instanceof Error && error.message
          ? t(error.message)
          : t("Could not write a problem from that material. Try a more specific topic."),
      );
    } finally {
      if (view.current === viewId) {
        writingRef.current = false;
        setWriting(false);
      }
    }
  }

  function clearVerdict() {
    setMarks(null);
    setBanner(null);
  }

  /**
   * Remember each graded step's verdict, keyed by id. Later checks overwrite
   * earlier ones, so a step proven wrong at one position and right at another
   * ends up green. This map is the bank's memory; `marks` stays per-check.
   */
  function recordVerdicts(ids: readonly string[], graded: readonly StepMark[]) {
    setVerdicts(previous => {
      const next = { ...previous };
      ids.forEach((id, index) => {
        const mark = graded[index];
        if (mark) next[id] = mark;
      });
      return next;
    });
  }

  /** Shared landing for every graded practice check — manual button or auto. */
  function applyCheckResult(result: SequenceCheckResult, ids: readonly string[]) {
    const solved = result.solved || result.problem.solved;
    const anyWrong = result.marks.includes("incorrect");
    setProblem({ ...result.problem, solved });
    setMarks(result.marks);
    // A partial build with no misses is praise, not "not quite" — the banner
    // and the sound must tell the same story on every auto-check.
    setBanner(anyWrong ? "incorrect" : "correct");
    recordVerdicts(ids, result.marks);
    if (solved) {
      celebrate({ ...result.problem, solved });
      refreshOutlineProgress(result.problem.progress);
    } else if (anyWrong) {
      playBreak();
    } else if (result.marks.length > 0) {
      // The whole build is correct so far: the ladder rises as it grows.
      playCombo(result.marks.length);
    }
  }

  /**
   * Practice-mode auto-check: after the learner pauses, grade the board they
   * have built and paint marks live. Deliberately avoids the busy guard so
   * placements never block; staleness is handled by view + autoSeq instead.
   */
  function scheduleAutocheck(ids: readonly string[]) {
    if (autoTimer.current) clearTimeout(autoTimer.current);
    autoSeq.current += 1;
    if (!autocheckRef.current || ids.length === 0) {
      setAutoInFlight(false);
      return;
    }
    const viewId = view.current;
    const seq = autoSeq.current;
    const snapshot = [...ids];
    setAutoInFlight(true);
    autoTimer.current = setTimeout(() => {
      autoTimer.current = null;
      void runAutocheck(snapshot, viewId, seq);
    }, 600);
  }

  async function runAutocheck(ids: string[], viewId: number, seq: number) {
    const fresh = () => view.current === viewId && seq === autoSeq.current;
    if (!fresh() || !autocheckRef.current) return;
    if (!problem || problem.mode !== "practice" || problem.solved || busyRef.current) return;
    try {
      const result = await checkSequenceAnswer(problem.problem_id, ids);
      if (!fresh()) return;
      setAutoInFlight(false);
      applyCheckResult(result, ids);
    } catch {
      // An auto-check failure stays quiet: the manual Check button is right
      // there, and a transport blip must not shout over the learner's flow.
      if (fresh()) setAutoInFlight(false);
    }
  }

  async function placeQuestStep(stepId: string) {
    if (!problem || problem.solved) return;
    if (!enterBusy()) return;
    const viewId = view.current;
    const seq = ++placementSeq.current;
    // A response only counts while this problem view is on screen AND no
    // newer placement has been fired — out-of-order arrivals reconcile to
    // the last server payload that passes both checks.
    const fresh = () => view.current === viewId && seq === placementSeq.current;
    setMessage("");
    setBanner(null);
    try {
      // v1 appends at the end: the prefix rule makes the tail the only
      // accepting index for a correct next step.
      const result = await placeSequenceStep(problem.problem_id, stepId, problem.placed_ids.length);
      if (!fresh()) return;
      // The server payload is the only reconciliation source for the board.
      setProblem(result.problem);
      const state = comboDispatch({ type: result.accepted ? "accept" : "reject" });
      flashAura(result.accepted ? "accept" : "reject");
      setBanner(result.accepted ? "correct" : "incorrect");
      if (result.accepted) playCombo(state.combo);
      else playBreak();
      if (result.problem.solved) {
        celebrate(result.problem);
        refreshOutlineProgress(result.problem.progress);
      }
    } catch (error) {
      if (!fresh()) return;
      // 409 means the server moved on (solved elsewhere, or the step is
      // already placed); absorb it instead of shouting at the learner.
      if (error instanceof SequenceRequestError && error.status === 409) return;
      // A transport failure is not a wrong answer: the combo stays as-is.
      setMessage(
        error instanceof Error && error.message ? t(error.message) : t("Could not check that step."),
      );
    } finally {
      releaseBusy();
    }
  }

  async function removeQuestStep(stepId: string) {
    if (!problem || problem.solved) return;
    if (!enterBusy()) return;
    const viewId = view.current;
    const seq = ++placementSeq.current;
    const fresh = () => view.current === viewId && seq === placementSeq.current;
    setMessage("");
    try {
      const updated = await removeSequenceStep(problem.problem_id, stepId);
      if (!fresh()) return;
      // Remove answers with the bare problem, not the place wrapper.
      setProblem(updated);
      comboDispatch({ type: "remove" });
      playBreak();
    } catch (error) {
      if (!fresh()) return;
      if (error instanceof SequenceRequestError && error.status === 409 && solvedCalledRef.current) {
        return;
      }
      setMessage(
        error instanceof Error && error.message ? t(error.message) : t("Could not check that step."),
      );
    } finally {
      releaseBusy();
    }
  }

  function addStep(stepId: string) {
    if (!problem || problem.solved || busy) return;
    if (problem.mode === "quest") {
      void placeQuestStep(stepId);
      return;
    }
    if (assembled.includes(stepId)) return;
    const next = [...assembled, stepId];
    setAssembled(next);
    clearVerdict();
    scheduleAutocheck(next);
  }

  function removePlaced(stepId: string) {
    if (!problem || problem.solved || busy) return;
    if (problem.mode === "quest") {
      void removeQuestStep(stepId);
      return;
    }
    const next = assembled.filter(id => id !== stepId);
    setAssembled(next);
    clearVerdict();
    scheduleAutocheck(next);
  }

  function leaveProblem() {
    view.current += 1;
    placementSeq.current += 1;
    writingRef.current = false;
    setWriting(false);
    releaseBusy();
    cancelAutocheck();
    setProblem(null);
    setAssembled([]);
    setMarks(null);
    setVerdicts({});
    setBanner(null);
    setMessage("");
    setDialog(null);
    setCelebration(null);
    setAura(null);
    comboDispatch({ type: "reset" });
    solvedCalledRef.current = false;
  }

  async function checkAnswer() {
    if (!problem || problem.solved || busy || assembled.length === 0) return;
    // A manual check supersedes any parked auto-check for the same board.
    cancelAutocheck();
    const viewId = view.current;
    const ids = [...assembled];
    enterBusy();
    setMessage("");
    setBanner(null);
    try {
      const result = await checkSequenceAnswer(problem.problem_id, ids);
      if (view.current !== viewId) return;
      applyCheckResult(result, ids);
    } catch (error) {
      if (view.current !== viewId) return;
      if (error instanceof SequenceRequestError && error.status === 409 && solvedCalledRef.current) {
        return;
      }
      setMessage(
        error instanceof Error && error.message ? t(error.message) : t("Could not check that step."),
      );
    } finally {
      releaseBusy();
    }
  }

  async function showHint() {
    if (!problem || busy) return;
    const viewId = view.current;
    setDialog({ title: t("Hint"), body: "" });
    try {
      // Quest keeps its board on the server, so the hint request carries no
      // assembled list there; practice still sends what the learner built.
      const result = await requestSequenceHint(
        problem.problem_id,
        problem.mode === "quest" ? undefined : assembled,
      );
      if (view.current !== viewId) return;
      setDialog({ title: t("Hint"), body: result.hint });
    } catch {
      if (view.current !== viewId) return;
      setDialog({ title: t("Hint"), body: t("Could not get a hint.") });
    }
  }

  async function showWhy(stepId: string) {
    if (!problem?.solved) return;
    const viewId = view.current;
    setDialog({ title: t("Why this step"), body: "" });
    try {
      const result = await explainSequenceStep(problem.problem_id, stepId);
      if (view.current !== viewId) return;
      setDialog({ title: t("Why this step"), body: result.explanation });
    } catch {
      if (view.current !== viewId) return;
      setDialog({ title: t("Why this step"), body: t("Could not explain this step.") });
    }
  }

  const questMode = problem?.mode === "quest";
  const orderedIds = problem ? (questMode ? problem.placed_ids : assembled) : [];
  const bank = problem?.steps.filter(step => !orderedIds.includes(step.id)) ?? [];
  // Ring denominator: the server's correct-step count when it ships one, else
  // the whole tile box (never zero-divide, never exceed what is knowable).
  const solutionTotal = problem
    ? problem.solution_length && problem.solution_length > 0
      ? problem.solution_length
      : problem.steps.length
    : 0;
  // Numerator: verified-correct steps once a check has graded the board;
  // before any check, quest counts its accepted prefix and practice counts
  // what the learner has placed so far.
  const builtCount = Math.min(
    marks ? marks.filter(mark => mark === "correct").length : orderedIds.length,
    solutionTotal,
  );
  const placed = orderedIds
    .map((id, index) => {
      const step = byId.get(id);
      return step ? { step, mark: marks?.[index] } : null;
    })
    .filter((item): item is { step: SequenceStep; mark: StepMark | undefined } => !!item);
  const showOutline =
    !problem &&
    outlinePhase !== "idle" &&
    outlinePhase !== "loading" &&
    !(outlinePhase === "reading" && outline === null);
  const auraClass =
    aura === "accept"
      ? "shadow-[0_0_0_2px_var(--success)]"
      : aura === "reject"
        ? "shadow-[0_0_0_2px_var(--destructive)]"
        : "";

  return (
    <LearningShell
      title={t("Guided practice")}
      subtitle={t(
        "Choose a knowledge base. DeepTutor reads its modules, then you rebuild one worked solution and check every step.",
      )}
    >
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end">
        <label className="grid min-w-0 flex-1 gap-1 text-sm">
          <span>{t("Knowledge base")}</span>
          <select
            className={selectClass}
            value={knowledgeBase}
            onChange={event => setKnowledgeBase(event.target.value)}
            disabled={!bases}
          >
            <option className={selectOptionClass} value="">
              {bases ? t("Knowledge base") : t("Loading knowledge bases…")}
            </option>
            {(bases ?? []).map(base => (
              <option key={knowledgeBaseRef(base)} className={selectOptionClass} value={knowledgeBaseRef(base)}>
                {base.name}
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-1">
          <div className="flex gap-1 rounded-lg border border-[var(--border)] p-1">
            <button
              type="button"
              className={styleButton(mode === "practice")}
              aria-pressed={mode === "practice"}
              disabled={!!problem}
              onClick={() => setMode("practice")}
            >
              {t("Practice")}
            </button>
            <button
              type="button"
              className={styleButton(mode === "quest")}
              aria-pressed={mode === "quest"}
              disabled={!!problem}
              onClick={() => setMode("quest")}
            >
              {t("Quest")}
            </button>
          </div>
          <p className="text-xs text-[var(--muted-foreground)]">
            {mode === "practice"
              ? t("Assemble the whole solution, then check it.")
              : t("Place one step at a time and build a combo.")}
          </p>
          {mode === "practice" && (
            <button
              type="button"
              aria-pressed={autocheck}
              title={t("Check each step as you place it.")}
              className={`mt-1 justify-self-start rounded-lg border px-3 py-1 text-xs ${
                autocheck
                  ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
                  : "border-[var(--border)] bg-[var(--background)] text-[var(--foreground)]"
              }`}
              onClick={toggleAutocheck}
            >
              {t("Auto-check")}
            </button>
          )}
        </div>
        {knowledgeBase && outlinePhase !== "idle" && (
          <button
            type="button"
            className="min-h-10 rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 text-sm text-[var(--foreground)] disabled:opacity-60"
            onClick={() => void readAgain()}
            disabled={outlinePhase === "loading" || outlinePhase === "reading"}
          >
            {t("Read again")}
          </button>
        )}
      </div>

      {loadError && (
        <p role="alert" className="mb-4 text-sm text-[var(--destructive)]">
          {loadError}
        </p>
      )}
      {bases && bases.length === 0 && (
        <p className="mb-4 text-sm text-[var(--muted-foreground)]">
          {t("No knowledge base is ready. Add one in Knowledge, then come back.")}
        </p>
      )}
      {outlinePhase === "reading" && (
        <p role="status" className="mb-4 text-sm text-[var(--muted-foreground)]">
          {t("Reading the modules in this knowledge base…")}
        </p>
      )}
      {outlinePhase === "error" && (
        <p role="alert" className="mb-4 text-sm text-[var(--destructive)]">
          {t("Could not read the modules in that knowledge base.")}
        </p>
      )}
      {writing && (
        <p role="status" className="mb-4 text-sm text-[var(--muted-foreground)]">
          {t("Reading your knowledge base and writing a problem…")}
        </p>
      )}
      {message && (
        <p role="status" className="mb-4 text-sm">
          {message}
        </p>
      )}

      {showOutline && (
        <SequenceModules
          modules={outline?.modules ?? []}
          topic={customTopic}
          disabled={writing || outlinePhase === "reading"}
          onTopicChange={setCustomTopic}
          onSelect={topic => void startTopic(topic)}
          onCreate={() => void startTopic(customTopic)}
        />
      )}

      {problem && (
        <div className="space-y-5">
          <button type="button" className="text-sm text-[var(--muted-foreground)] underline" onClick={leaveProblem}>
            {t("Go back")}
          </button>
          <section className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-5">
            {activeTopic && <p className="mb-2 text-sm font-semibold text-[var(--primary)]">{activeTopic}</p>}
            <MarkdownRenderer content={problem.question} enableMath />
            {problem.formulas.length > 0 && (
              <div className="mt-4 border-t border-[var(--border)] pt-3">
                <h2 className="mb-2 text-sm font-semibold">{t("Key formulas")}</h2>
                <ul className="space-y-1">
                  {problem.formulas.map(formula => (
                    <li key={formula}>
                      <InlineMarkdown content={formula} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {problem.sources.length > 0 && (
              <p className="mt-3 text-xs text-[var(--muted-foreground)]">
                {t("Sources")}: {problem.sources.map(source => source.title).join(", ")}
              </p>
            )}
            <p className="mt-3 text-sm">
              {t("Solved {{count}} of {{goal}} for this topic", {
                count: problem.progress.solved,
                goal: problem.progress.goal,
              })}
            </p>
          </section>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-4">
              <ProgressRing solved={problem.progress.solved} goal={problem.progress.goal} />
              <ProblemTimer key={problem.problem_id} solved={problem.solved} />
              <SolutionRing built={builtCount} total={solutionTotal} />
              <button
                type="button"
                aria-pressed={soundOn}
                title={t("Play sounds for right and wrong steps")}
                className={`rounded-lg border px-3 py-1 text-sm ${
                  soundOn
                    ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
                    : "border-[var(--border)] bg-[var(--background)] text-[var(--foreground)]"
                }`}
                onClick={toggleSound}
              >
                {t("Sound")}
              </button>
            </div>
            <div className="flex gap-1 rounded-lg border border-[var(--border)] p-1">
              <button type="button" className={styleButton(style === "word")} onClick={() => setStyle("word")}>
                {t("Word and symbol")}
              </button>
              <button type="button" className={styleButton(style === "symbol")} onClick={() => setStyle("symbol")}>
                {t("Symbol only")}
              </button>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section
              className={`rounded-xl border border-[var(--border)] bg-[var(--background)] p-4 ${auraClass} ${
                reduceMotion ? "" : "transition-shadow duration-200"
              }`}
            >
              <div className="mb-3 flex items-center justify-center gap-2">
                <h2 className="text-center text-sm font-semibold">{t("Your solution")}</h2>
                {questMode && <ComboBadge combo={combo.combo} />}
              </div>
              {placed.length === 0 && (
                <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">
                  {t("Click a step to add it. A step that does not belong stays until you remove it.")}
                </p>
              )}
              <ol className="space-y-2">
                {placed.map(({ step, mark }) => (
                  <li key={step.id} className={`flex items-start gap-2 rounded-lg border p-3 ${placedClass(mark)}`}>
                    <div className="min-w-0 flex-1">
                      <InlineMarkdown content={stepText(step, style)} />
                    </div>
                    {problem.solved ? (
                      <button
                        type="button"
                        className="text-xs underline"
                        onClick={() => void showWhy(step.id)}
                        disabled={busy}
                      >
                        {t("Why this step")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="text-xs underline"
                        onClick={() => removePlaced(step.id)}
                        disabled={busy}
                      >
                        {t("Remove this step")}
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            </section>
            <section className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
              <h2 className="mb-3 text-center text-sm font-semibold">{t("Available steps")}</h2>
              <ul className="space-y-2">
                {bank.map(step => {
                  const verdict = verdicts[step.id];
                  return (
                    <li key={step.id}>
                      <button
                        type="button"
                        className={bankClass(verdict)}
                        onClick={() => addStep(step.id)}
                        disabled={busy || problem.solved}
                      >
                        <InlineMarkdown content={stepText(step, style)} />
                        <span className="sr-only">{t("Add this step to your solution")}</span>
                        {verdict === "incorrect" && (
                          <span className="sr-only">{t("Previously marked incorrect")}</span>
                        )}
                        {verdict === "correct" && (
                          <span className="sr-only">{t("Previously marked correct")}</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>

          {autoInFlight && (
            <p role="status" className="text-xs text-[var(--muted-foreground)]">
              {t("Checking…")}
            </p>
          )}

          {banner && <SequenceBanner verdict={banner} combo={combo.combo} onDismiss={() => setBanner(null)} />}

          <div className="flex flex-wrap justify-end gap-3">
            {!problem.solved && (
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-sm"
                onClick={() => void showHint()}
                disabled={busy}
              >
                {t("Get a hint")}
              </button>
            )}
            {!problem.solved && !questMode && (
              <button
                type="button"
                className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm text-[var(--primary-foreground)] disabled:opacity-60"
                onClick={() => void checkAnswer()}
                disabled={busy || assembled.length === 0}
              >
                {t("Check answer")}
              </button>
            )}
            {problem.solved && (
              <button
                type="button"
                className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm text-[var(--primary-foreground)] disabled:opacity-60"
                onClick={() => void startTopic(activeTopic)}
                disabled={writing}
              >
                {t("Next problem")}
              </button>
            )}
          </div>

          {problem.solved && problem.explanation && (
            <section className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-5">
              <h2 className="mb-2 text-base font-semibold">{t("Full explanation")}</h2>
              <MarkdownRenderer content={problem.explanation} enableMath />
            </section>
          )}
        </div>
      )}

      <SolveCelebration
        open={celebration !== null}
        seconds={celebration?.seconds ?? 0}
        peakCombo={celebration?.peakCombo ?? 0}
        progress={celebration?.progress ?? { solved: 0, goal: 0 }}
        explanation={celebration?.explanation ?? null}
        onClose={() => setCelebration(null)}
      />

      <Dialog
        open={dialog !== null}
        title={dialog?.title ?? ""}
        onClose={() => setDialog(null)}
        closeLabel={t("Close")}
      >
        {dialog?.body ? <MarkdownRenderer content={dialog.body} enableMath /> : <p>{t("One moment.")}</p>}
      </Dialog>
    </LearningShell>
  );
}

function styleButton(active: boolean): string {
  return `rounded-md px-3 py-1 text-sm disabled:opacity-60 ${
    active ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : ""
  }`;
}
