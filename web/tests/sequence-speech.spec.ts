/**
 * The narration engine: preference defaults, server-prepared math speak with a
 * local degradation path, and the karaoke contract — boundary charIndex maps
 * to the right word, engines without boundaries get a paced timer, and a
 * manual stop never fires onEnd (the caller is driving).
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(),
  apiUrl: vi.fn((path: string) => path),
}));

import { apiFetch } from "@/lib/api";
import {
  isNarrating,
  localMathSpeak,
  narrationEnabled,
  prepareSpeech,
  setNarrationEnabled,
  speechSupported,
  startNarration,
  stopNarration,
  wordOffsets,
} from "@/lib/sequence-speech";

interface UtteranceMock {
  text: string;
  rate: number;
  lang: string;
  onboundary: ((event: { name?: string; charIndex: number }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

let utterances: UtteranceMock[];
let speakMock: Mock<(utterance: UtteranceMock) => void>;
let cancelMock: Mock<() => void>;

/** jsdom ships no speech engine; this is the minimal shape the helper needs. */
function stubSpeechEngine(): void {
  utterances = [];
  speakMock = vi.fn<(utterance: UtteranceMock) => void>();
  cancelMock = vi.fn<() => void>();
  speakMock.mockImplementation(utterance => {
    utterances.push(utterance);
  });
  class UtteranceStub implements UtteranceMock {
    text: string;
    rate = 1;
    lang = "";
    onboundary: UtteranceMock["onboundary"] = null;
    onend: UtteranceMock["onend"] = null;
    onerror: UtteranceMock["onerror"] = null;
    constructor(text: string) {
      this.text = text;
    }
  }
  vi.stubGlobal("SpeechSynthesisUtterance", UtteranceStub);
  vi.stubGlobal("speechSynthesis", { speak: speakMock, cancel: cancelMock });
}

function okSpeech(speech: string): void {
  vi.mocked(apiFetch).mockResolvedValue({
    ok: true,
    json: async () => ({ speech }),
  } as unknown as Response);
}

function callbacks() {
  return { onWord: vi.fn(), onEnd: vi.fn() };
}

beforeEach(() => {
  localStorage.clear();
  stubSpeechEngine();
});

afterEach(() => {
  stopNarration();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("narration preference", () => {
  it("is on by default — guided practice is meant to talk", () => {
    expect(narrationEnabled()).toBe(true);
  });

  it("persists an explicit opt-out and opt-in", () => {
    setNarrationEnabled(false);
    expect(narrationEnabled()).toBe(false);
    expect(localStorage.getItem("deeptutor.sequence.narration")).toBe("0");
    setNarrationEnabled(true);
    expect(narrationEnabled()).toBe(true);
    expect(localStorage.getItem("deeptutor.sequence.narration")).toBe("1");
  });

  it("reports engine support from the stubbed globals", () => {
    expect(speechSupported()).toBe(true);
    vi.unstubAllGlobals();
    expect(speechSupported()).toBe(false);
  });
});

describe("prepareSpeech", () => {
  it("uses the server's spoken form when the endpoint answers", async () => {
    okSpeech("1 over 2 sine of x squared");
    const speech = await prepareSpeech("$\\frac{1}{2}\\sin(x^2)$");
    expect(speech).toBe("1 over 2 sine of x squared");
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/voice/speak-text",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("degrades to the local cleaner when the endpoint fails", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error("offline"));
    const speech = await prepareSpeech("Solve $\\frac{1}{2} \\le x$.");
    expect(speech).toContain("1 over 2");
    expect(speech).toContain("less than or equal to");
    expect(speech).not.toContain("\\");
  });

  it("degrades to the local cleaner on a non-ok response", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ ok: false } as unknown as Response);
    const speech = await prepareSpeech("$x^{2}$");
    expect(speech).toContain("squared");
  });

  it("skips the network entirely for blank text", async () => {
    await expect(prepareSpeech("   ")).resolves.toBe("");
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

describe("localMathSpeak", () => {
  it("speaks fractions, powers, subscripts and relations", () => {
    const speech = localMathSpeak("If $\\frac{1}{2}x_{0}^{2} \\le 4$ then $x \\ne 0$.");
    expect(speech).toContain("1 over 2");
    expect(speech).toContain("sub 0");
    expect(speech).toContain("squared");
    expect(speech).toContain("less than or equal to");
    expect(speech).toContain("not equal to");
    expect(speech).not.toContain("\\");
    expect(speech).not.toContain("$");
  });

  it("strips markdown marks and unicode math", () => {
    expect(localMathSpeak("**bold** `code` x ≤ y → z")).toBe("bold code x less than or equal to y to z");
  });

  it("strips flattened rules and heading hashes mid-line", () => {
    const speech = localMathSpeak("Approach the problem. --- ### Solution 1. Identify it.");
    expect(speech).not.toContain("---");
    expect(speech).not.toContain("#");
    expect(speech).toContain("Approach the problem.");
    expect(speech).toContain("Solution 1. Identify it.");
  });
});

describe("wordOffsets", () => {
  it("returns the char offset of every whitespace-delimited word", () => {
    expect(wordOffsets("alpha beta  gamma")).toEqual([0, 6, 12]);
    expect(wordOffsets("")).toEqual([]);
  });
});

describe("startNarration", () => {
  it("returns false without an engine and never speaks", () => {
    vi.unstubAllGlobals();
    const { onWord, onEnd } = callbacks();
    expect(startNarration("alpha beta", { onWord, onEnd })).toBe(false);
    expect(onWord).not.toHaveBeenCalled();
  });

  it("speaks at 0.95 rate and maps boundary charIndex to word indices", () => {
    const { onWord, onEnd } = callbacks();
    expect(startNarration("alpha beta gamma", { onWord, onEnd })).toBe(true);
    expect(utterances).toHaveLength(1);
    expect(utterances[0].text).toBe("alpha beta gamma");
    expect(utterances[0].rate).toBe(0.95);
    expect(speakMock).toHaveBeenCalledTimes(1);
    expect(isNarrating()).toBe(true);

    utterances[0].onboundary?.({ name: "word", charIndex: 6 });
    expect(onWord).toHaveBeenLastCalledWith(1);
    // Mid-word offsets still land on the word that contains them.
    utterances[0].onboundary?.({ name: "word", charIndex: 13 });
    expect(onWord).toHaveBeenLastCalledWith(2);

    utterances[0].onend?.();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(isNarrating()).toBe(false);
  });

  it("ignores sentence boundaries and late events after the end", () => {
    const { onWord, onEnd } = callbacks();
    startNarration("alpha beta", { onWord, onEnd });
    utterances[0].onboundary?.({ name: "sentence", charIndex: 0 });
    expect(onWord).not.toHaveBeenCalled();
    utterances[0].onend?.();
    // A second end (some engines double-fire) must not double-call onEnd.
    utterances[0].onend?.();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("paces the highlight with a ~175 wpm timer when no boundaries arrive", () => {
    vi.useFakeTimers();
    const { onWord } = callbacks();
    startNarration("one two three", { onWord, onEnd: vi.fn() });
    const tick = Math.round(60000 / 175 / 0.95);
    vi.advanceTimersByTime(tick);
    expect(onWord).toHaveBeenLastCalledWith(0);
    vi.advanceTimersByTime(tick);
    expect(onWord).toHaveBeenLastCalledWith(1);
    vi.advanceTimersByTime(tick);
    expect(onWord).toHaveBeenLastCalledWith(2);
    // Past the last word the timer retires instead of looping.
    vi.advanceTimersByTime(tick * 3);
    expect(onWord).toHaveBeenCalledTimes(3);
  });

  it("hands over to real boundaries once the engine emits them", () => {
    vi.useFakeTimers();
    const { onWord } = callbacks();
    startNarration("one two three", { onWord, onEnd: vi.fn() });
    const tick = Math.round(60000 / 175 / 0.95);
    vi.advanceTimersByTime(tick);
    expect(onWord).toHaveBeenLastCalledWith(0);
    utterances[0].onboundary?.({ name: "word", charIndex: 4 });
    expect(onWord).toHaveBeenLastCalledWith(1);
    vi.advanceTimersByTime(tick * 5);
    expect(onWord).toHaveBeenCalledTimes(2);
  });

  it("stopNarration cancels the engine without firing onEnd", () => {
    const { onEnd } = callbacks();
    startNarration("alpha beta", { onWord: vi.fn(), onEnd });
    stopNarration();
    expect(cancelMock).toHaveBeenCalledTimes(1);
    expect(onEnd).not.toHaveBeenCalled();
    expect(isNarrating()).toBe(false);
    // Handlers were detached: a late engine event cannot reach the caller.
    expect(utterances[0].onend).toBeNull();
    expect(utterances[0].onboundary).toBeNull();
  });

  it("starting a new utterance silently retires the previous one", () => {
    const first = callbacks();
    const second = callbacks();
    startNarration("alpha", first);
    startNarration("beta", second);
    expect(cancelMock).toHaveBeenCalledTimes(1);
    expect(first.onEnd).not.toHaveBeenCalled();
    expect(utterances).toHaveLength(2);
    utterances[1].onend?.();
    expect(second.onEnd).toHaveBeenCalledTimes(1);
    expect(first.onEnd).not.toHaveBeenCalled();
  });

  it("never speaks blank text", () => {
    const { onEnd } = callbacks();
    expect(startNarration("   ", { onWord: vi.fn(), onEnd })).toBe(false);
    expect(speakMock).not.toHaveBeenCalled();
  });
});
