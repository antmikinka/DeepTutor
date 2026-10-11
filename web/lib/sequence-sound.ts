/**
 * Tiny Web Audio cues for quest mode. Default OFF; the toggle lives in the
 * guided-practice HUD and persists through the shared storage boundary.
 * While disabled, no AudioContext is ever constructed.
 *
 * v2 patches: a combo is a bright "ping" — the semitone-ladder fundamental
 * plus a quiet octave overtone for bell-like bloom. A break is a soft
 * descending minor third on triangle waves (a "duun", never a harsh buzzer).
 * A solve is a four-note rising arpeggio whose top note blooms with an
 * overtone and a longer release. Envelopes use short attacks and exponential
 * decays so nothing clicks, and peaks stay modest so rapid combos never clip.
 */

import { browserStorage } from "@/shared/storage";

const KEY = "deeptutor.sequence.sound";

let ctx: AudioContext | null = null;

export function soundEnabled(): boolean {
  return browserStorage.readRaw("local", KEY) === "1";
}

export function setSoundEnabled(on: boolean): void {
  browserStorage.writeRaw("local", KEY, on ? "1" : "0");
}

/** Never constructs an AudioContext while sound is disabled. */
function ensure(): AudioContext | null {
  if (!soundEnabled()) return null;
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

/** Call from the first pointerdown/keydown on the page (browser autoplay rule). */
export function unlockAudio(): void {
  const context = ensure();
  if (context && context.state === "suspended") void context.resume();
}

/** One shaped oscillator: quick attack, exponential decay, no click. */
function voice(
  context: AudioContext,
  freq: number,
  at: number,
  dur: number,
  type: OscillatorType,
  peak: number,
): void {
  const osc = context.createOscillator();
  const gain = context.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, context.currentTime + at);
  gain.gain.exponentialRampToValueAtTime(peak, context.currentTime + at + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + at + dur);
  osc.connect(gain).connect(context.destination);
  osc.start(context.currentTime + at);
  osc.stop(context.currentTime + at + dur + 0.05);
}

interface NoteOptions {
  type?: OscillatorType;
  peak?: number;
  /** Fraction of the peak re-voiced one octave up; 0/undefined = no overtone. */
  overtone?: number;
}

function note(
  context: AudioContext,
  freq: number,
  at: number,
  dur: number,
  options: NoteOptions = {},
): void {
  const type = options.type ?? "sine";
  const peak = options.peak ?? 0.18;
  voice(context, freq, at, dur, type, peak);
  if (options.overtone) {
    voice(context, freq * 2, at, dur * 0.7, "sine", peak * options.overtone);
  }
}

/** v2 combo ping: semitone ladder, each rung a bell with an octave shimmer. */
export function playCombo(n: number): void {
  const context = ensure();
  if (context) {
    note(context, 440 * Math.pow(2, (n - 1) / 12), 0, 0.16, {
      type: "sine",
      peak: 0.2,
      overtone: 0.3,
    });
  }
}

/** v2 break cue: a soft descending minor third — audible, never harsh. */
export function playBreak(): void {
  const context = ensure();
  if (!context) return;
  note(context, 311.13, 0, 0.12, { type: "triangle", peak: 0.14 }); // Eb4
  note(context, 233.08, 0.1, 0.2, { type: "triangle", peak: 0.14 }); // Bb3
}

/** v2 fanfare: C5-E5-G5-C6 arpeggio; the top note blooms and holds. */
export function playSuccess(): void {
  const context = ensure();
  if (!context) return;
  note(context, 523.25, 0, 0.16, { peak: 0.18 }); // C5
  note(context, 659.25, 0.09, 0.16, { peak: 0.18 }); // E5
  note(context, 783.99, 0.18, 0.16, { peak: 0.18 }); // G5
  note(context, 1046.5, 0.3, 0.34, { peak: 0.2, overtone: 0.25 }); // C6
}
