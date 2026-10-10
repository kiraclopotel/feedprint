// One deadline for every network call a cover can wait on.
//
// Before this, the text proxy (callProxyOnce) had no timeout at all: one
// stalled socket held a concurrency slot for the rest of the tab's life, and
// in Child every later cover sat on
// "checking" with no verdict and nothing logged. The single-post path's own
// deadline and the licence probe's 5 s timer were the only bounded calls.
//
// The deadline is combined with the caller's signal so an upstream cancel
// still wins, and a timeout is reported as its own error class so the caller
// can name it (the text client maps it to a network failure, which the retry
// and cancel-record paths already understand).

export const PROXY_TEXT_DEADLINE_MS = 40_000;

export class DeadlineError extends Error {
  readonly name = 'DeadlineError';
  constructor(readonly deadlineMs: number) {
    super(`request exceeded the ${deadlineMs} ms deadline`);
  }
}

export async function fetchWithDeadline(
  input: string,
  init: RequestInit,
  deadlineMs: number,
  callerSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, deadlineMs);
  const onCallerAbort = (): void => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener('abort', onCallerAbort, { once: true });
  }
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    if (timedOut) throw new DeadlineError(deadlineMs);
    throw err;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', onCallerAbort);
  }
}
