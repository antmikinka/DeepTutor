import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

interface GainMock {
  gain: {
    setValueAtTime: Mock<(value: number, time: number) => void>;
    exponentialRampToValueAtTime: Mock<(value: number, time: number) => void>;
  };
  connect: Mock<(destination: unknown) => unknown>;
}

interface OscillatorMock {
  type: string;
  frequency: { value: number };
  connect: Mock<(destination: unknown) => unknown>;
  start: Mock<(when: number) => void>;
  stop: Mock<(when: number) => void>;
}

interface AudioContextMock {
  state: string;
  currentTime: number;
  destination: object;
  resume: Mock<() => Promise<void>>;
  createOscillator: Mock<() => OscillatorMock>;
  createGain: Mock<() => GainMock>;
}

function makeAudioContext(): AudioContextMock {
  const context: AudioContextMock = {
    state: "suspended",
    currentTime: 0,
    destination: {},
    resume: vi.fn<() => Promise<void>>(),
    createOscillator: vi.fn<() => OscillatorMock>(),
    createGain: vi.fn<() => GainMock>(),
  };
  context.resume.mockImplementation(async () => {
    context.state = "running";
  });
  context.createGain.mockImplementation(() => {
    const gain: GainMock = {
      gain: {
        setValueAtTime: vi.fn<(value: number, time: number) => void>(),
        exponentialRampToValueAtTime: vi.fn<(value: number, time: number) => void>(),
      },
      connect: vi.fn<(destination: unknown) => unknown>(),
    };
    gain.connect.mockReturnValue(context.destination);
    return gain;
  });
  return context;
}

let oscillators: OscillatorMock[];
let contextMock: AudioContextMock;
let audioContextSpy: Mock<() => AudioContextMock>;
let sound: typeof import("@/lib/sequence-sound");

/** Fresh module state per test: the helper caches its AudioContext. */
async function freshModule(): Promise<void> {
  vi.resetModules();
  oscillators = [];
  contextMock = makeAudioContext();
  // osc.connect(gain).connect(destination) — record every oscillator made.
  contextMock.createOscillator.mockImplementation(() => {
    const osc: OscillatorMock = {
      type: "",
      frequency: { value: 0 },
      connect: vi.fn<(destination: unknown) => unknown>(),
      start: vi.fn<(when: number) => void>(),
      stop: vi.fn<(when: number) => void>(),
    };
    osc.connect.mockImplementation(() => contextMock.createGain());
    oscillators.push(osc);
    return osc;
  });
  // A non-arrow function so `new AudioContext()` works and yields the mock.
  audioContextSpy = vi.fn(function construct() {
    return contextMock;
  });
  vi.stubGlobal("AudioContext", audioContextSpy);
  sound = await import("@/lib/sequence-sound");
}

beforeEach(async () => {
  localStorage.clear();
  await freshModule();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sequence sound gating", () => {
  it("is off by default and never constructs an AudioContext while off", () => {
    expect(sound.soundEnabled()).toBe(false);
    sound.playCombo(3);
    sound.playBreak();
    sound.playSuccess();
    sound.unlockAudio();
    expect(audioContextSpy).not.toHaveBeenCalled();
    expect(oscillators).toHaveLength(0);
  });

  it("stays silent after the toggle is switched back off", () => {
    sound.setSoundEnabled(true);
    sound.unlockAudio();
    expect(audioContextSpy).toHaveBeenCalledTimes(1);
    sound.setSoundEnabled(false);
    expect(sound.soundEnabled()).toBe(false);
    const scheduled = oscillators.length;
    sound.playCombo(2);
    sound.playBreak();
    sound.playSuccess();
    expect(audioContextSpy).toHaveBeenCalledTimes(1);
    expect(oscillators).toHaveLength(scheduled);
  });

  it("resumes only through the user-gesture unlock, not while playing", () => {
    sound.setSoundEnabled(true);
    sound.playCombo(1);
    expect(contextMock.state).toBe("suspended");
    expect(contextMock.resume).not.toHaveBeenCalled();
    sound.unlockAudio();
    expect(contextMock.resume).toHaveBeenCalledTimes(1);
    expect(contextMock.state).toBe("running");
    // A second unlock on a running context does not resume again.
    sound.unlockAudio();
    expect(contextMock.resume).toHaveBeenCalledTimes(1);
  });

  it("reuses one AudioContext across cues", () => {
    sound.setSoundEnabled(true);
    sound.playCombo(1);
    sound.playCombo(2);
    sound.playSuccess();
    expect(audioContextSpy).toHaveBeenCalledTimes(1);
  });
});

describe("sequence sound cues", () => {
  beforeEach(() => {
    sound.setSoundEnabled(true);
  });

  it("plays the semitone ladder for combos", () => {
    sound.playCombo(3);
    expect(oscillators).toHaveLength(1);
    expect(oscillators[0].type).toBe("sine");
    expect(oscillators[0].frequency.value).toBeCloseTo(440 * Math.pow(2, 2 / 12), 6);
    expect(oscillators[0].start).toHaveBeenCalledTimes(1);
    expect(oscillators[0].stop).toHaveBeenCalledTimes(1);
  });

  it("plays one low tone when the combo breaks", () => {
    sound.playBreak();
    expect(oscillators).toHaveLength(1);
    expect(oscillators[0].frequency.value).toBeCloseTo(130.81, 6);
  });

  it("plays exactly three rising tones on success", () => {
    sound.playSuccess();
    expect(oscillators).toHaveLength(3);
    expect(oscillators.map(oscillator => oscillator.frequency.value)).toEqual([
      523.25, 659.25, 783.99,
    ]);
  });
});
