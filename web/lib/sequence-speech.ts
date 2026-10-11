/**
 * Narration for the sequence board: "math speak" text prepared by the server,
 * voiced by the browser.
 *
 * The server's speech-text layer (the same Markdown+LaTeX reducer the TTS
 * pipeline uses) turns `$\frac{1}{2}$` into "1 over 2" so nobody ever hears
 * "dollar backslash frac". The browser's speechSynthesis then voices that
 * prepared string and emits word-boundary events, which drive the karaoke
 * highlight — server audio could not do that, and costs a provider call.
 * If the endpoint is unreachable, a small local cleaner degrades the prep but
 * narration never dies. While narration is off, no utterance is ever built.
 */

import { apiFetch, apiUrl } from "@/lib/api";
import { browserStorage } from "@/shared/storage";

const NARRATION_KEY = "deeptutor.sequence.narration";
const SPEAK_TEXT_PATH = "/api/voice/speak-text";

/** Default ON: guided practice is meant to talk; opt out, not in. */
export function narrationEnabled(): boolean {
  return browserStorage.readRaw("local", NARRATION_KEY) !== "0";
}

export function setNarrationEnabled(on: boolean): void {
  browserStorage.writeRaw("local", NARRATION_KEY, on ? "1" : "0");
}

export function speechSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof window.SpeechSynthesisUtterance === "function"
  );
}

/**
 * Fallback prep when the server cannot be reached: unwrap math delimiters and
 * the highest-frequency TeX so the browser voice still says something sane.
 * Deliberately tiny — the server verbalizer is the real engine.
 */
export function localMathSpeak(text: string): string {
  const symbols: Array<[RegExp, string]> = [
    [/\$\$|\\\[|\\\]|\$|\\\(|\\\)/g, " "],
    [/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, " $1 over $2 "],
    [/\\sqrt\{([^{}]*)\}/g, " square root of $1 "],
    [/\^\{?2\}?/g, " squared "],
    [/\^\{?3\}?/g, " cubed "],
    [/\^\{([^{}]*)\}/g, " to the $1 "],
    [/_\{([^{}]*)\}/g, " sub $1 "],
    [/\\le(?:q)?\b/g, " less than or equal to "],
    [/\\ge(?:q)?\b/g, " greater than or equal to "],
    [/\\neq?\b/g, " not equal to "],
    [/\\times\b/g, " times "],
    [/\\cdot\b/g, " times "],
    [/\\pm\b/g, " plus or minus "],
    [/\\infty\b/g, " infinity "],
    [/\\alpha\b/g, " alpha "],
    [/\\beta\b/g, " beta "],
    [/\\pi\b/g, " pi "],
    [/\\theta\b/g, " theta "],
    [/\\sin\b/g, " sine "],
    [/\\cos\b/g, " cosine "],
    [/\\tan\b/g, " tangent "],
    [/\\log\b/g, " log "],
    [/\\ln\b/g, " natural log "],
    [/\\sum\b/g, " sum "],
    [/\\int\b/g, " integral "],
    [/\\[a-zA-Z]+/g, " "],
    [/[{}\\]/g, " "],
    [/≤/g, " less than or equal to "],
    [/≥/g, " greater than or equal to "],
    [/≠/g, " not equal to "],
    [/∞/g, " infinity "],
    [/×/g, " times "],
    [/±/g, " plus or minus "],
    [/→/g, " to "],
    [/\*\*|__|\*|`|#|>/g, " "],
    [/\s{2,}/g, " "],
  ];
  let out = text;
  for (const [pattern, replacement] of symbols) out = out.replace(pattern, replacement);
  return out.trim();
}

/** Ask the server to reduce Markdown/LaTeX to speakable prose. */
export async function prepareSpeech(text: string): Promise<string> {
  if (!text.trim()) return "";
  try {
    const response = await apiFetch(apiUrl(SPEAK_TEXT_PATH), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (response.ok) {
      const data = await response.json();
      if (typeof data?.speech === "string" && data.speech.trim()) return data.speech;
    }
  } catch {
    /* The local cleaner below is the degradation path. */
  }
  return localMathSpeak(text);
}

export interface NarrationCallbacks {
  /** Index of the word (0-based, whitespace-split) currently being spoken. */
  onWord: (index: number) => void;
  /** Fired on natural end only; stopNarration never calls it. */
  onEnd: () => void;
  lang?: string;
}

interface ActiveNarration {
  token: number;
  utterance: SpeechSynthesisUtterance;
  fallbackTimer: ReturnType<typeof setInterval> | null;
}

let active: ActiveNarration | null = null;
let tokenSeq = 0;

/** Character offsets of every whitespace-delimited word, for boundary math. */
export function wordOffsets(text: string): number[] {
  const offsets: number[] = [];
  const pattern = /\S+/g;
  let match = pattern.exec(text);
  while (match) {
    offsets.push(match.index);
    match = pattern.exec(text);
  }
  return offsets;
}

function wordIndexAt(offsets: readonly number[], charIndex: number): number {
  let low = 0;
  let high = offsets.length - 1;
  let best = 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (offsets[mid] <= charIndex) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}

function clearFallback(narration: ActiveNarration): void {
  if (narration.fallbackTimer !== null) {
    clearInterval(narration.fallbackTimer);
    narration.fallbackTimer = null;
  }
}

/**
 * Speak `text` with karaoke callbacks, cancelling whatever was speaking.
 * Returns false when the browser has no speech engine; the caller then keeps
 * its UI in the silent state. Word highlights come from onboundary events;
 * engines that never fire them (Firefox) get a timer paced at ~175 wpm.
 */
export function startNarration(text: string, callbacks: NarrationCallbacks): boolean {
  stopNarration();
  if (!text.trim() || !speechSupported()) return false;
  const token = ++tokenSeq;
  const offsets = wordOffsets(text);
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.95;
  if (callbacks.lang) utterance.lang = callbacks.lang;

  const narration: ActiveNarration = { token, utterance, fallbackTimer: null };
  let boundariesSeen = false;

  const finish = () => {
    if (active !== narration) return;
    clearFallback(narration);
    active = null;
    callbacks.onEnd();
  };

  utterance.onboundary = event => {
    if (event.name && event.name !== "word") return;
    boundariesSeen = true;
    clearFallback(narration);
    if (active === narration) callbacks.onWord(wordIndexAt(offsets, event.charIndex));
  };
  utterance.onend = finish;
  utterance.onerror = finish;

  // Boundary-less engines still get a moving highlight, paced to the rate.
  let paced = -1;
  narration.fallbackTimer = setInterval(() => {
    if (boundariesSeen || active !== narration) {
      clearFallback(narration);
      return;
    }
    paced += 1;
    if (paced >= offsets.length) {
      clearFallback(narration);
      return;
    }
    callbacks.onWord(paced);
  }, Math.round(60000 / 175 / utterance.rate));

  active = narration;
  window.speechSynthesis.speak(utterance);
  return true;
}

/** Cancel any speech immediately; onEnd is NOT fired (the caller is driving). */
export function stopNarration(): void {
  const narration = active;
  active = null;
  tokenSeq += 1;
  if (!narration) return;
  clearFallback(narration);
  narration.utterance.onend = null;
  narration.utterance.onerror = null;
  narration.utterance.onboundary = null;
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* Some engines throw when nothing is queued; stopping is still done. */
  }
}

/** True while an utterance owned by this module is playing. */
export function isNarrating(): boolean {
  return active !== null;
}
