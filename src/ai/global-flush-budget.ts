const HOLD_THRESHOLD_FAILS = 3;
const HOLD_WINDOW_MS = 10_000;
const HOLD_DURATION_MS = 15_000;

const failureLog: number[] = [];
let holdUntil = 0;

function pruneOldFailures(now: number): void {
  const cutoff = now - HOLD_WINDOW_MS;
  while (failureLog.length > 0 && failureLog[0] < cutoff) {
    failureLog.shift();
  }
}

export function recordFailure(now: number = Date.now()): void {
  failureLog.push(now);
  pruneOldFailures(now);
  if (failureLog.length >= HOLD_THRESHOLD_FAILS) {
    holdUntil = now + HOLD_DURATION_MS;
  }
}

export function isHolding(now: number = Date.now()): boolean {
  return now < holdUntil;
}

export function holdRemainingMs(now: number = Date.now()): number {
  return Math.max(0, holdUntil - now);
}

export function _resetForTests(): void {
  failureLog.length = 0;
  holdUntil = 0;
}
