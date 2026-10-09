/**
 * Tiny Web Audio cues for quest mode. Default OFF; the toggle lives in the
 * guided-practice HUD and persists through the shared storage boundary.
 * While disabled, no AudioContext is ever constructed.
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

function tone(context: AudioContext, freq: number, at: number, dur: number): void {
  const osc = context.createOscillator();
  const gain = context.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, context.currentTime + at);
  gain.gain.exponentialRampToValueAtTime(0.2, context.currentTime + at + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + at + dur);
  osc.connect(gain).connect(context.destination);
  osc.start(context.currentTime + at);
  osc.stop(context.currentTime + at + dur + 0.05);
}

/** v1 semitone ladder: each combo step sounds one semitone higher. */
export function playCombo(n: number): void {
  const context = ensure();
  if (context) tone(context, 440 * Math.pow(2, (n - 1) / 12), 0, 0.12);
}

export function playBreak(): void {
  const context = ensure();
  if (context) tone(context, 130.81, 0, 0.2); // C3
}

export function playSuccess(): void {
  const context = ensure();
  if (!context) return;
  tone(context, 523.25, 0, 0.18); // C5
  tone(context, 659.25, 0.09, 0.18); // E5
  tone(context, 783.99, 0.18, 0.24); // G5
}
