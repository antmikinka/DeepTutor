/**
 * The practice-mode "check as I build" preference. Persisted through the same
 * shared storage boundary as the sound toggle so a learner's choice survives a
 * reload. This is a pure key/value helper — no React, no I/O beyond storage —
 * so it is trivially testable and safe to call during render hydration.
 */

import { browserStorage } from "@/shared/storage";

const KEY = "deeptutor.sequence.autocheck";

/** Default ON: auto-checking is the headline practice-mode experience. */
export function autocheckEnabled(): boolean {
  const raw = browserStorage.readRaw("local", KEY);
  return raw === null ? true : raw === "1";
}

export function setAutocheckEnabled(on: boolean): void {
  browserStorage.writeRaw("local", KEY, on ? "1" : "0");
}
