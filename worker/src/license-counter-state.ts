export interface CounterReservation {
  calls: number;
  tokens: number;
  dailyResetAt: string;
  monthlyResetAt: string;
  /**
   * Reservation birth stamp for the TTL reaper. Reservations are meant to
   * live for one request round-trip; reconcile removes them. When reconcile
   * never arrives (isolate evicted, DO call failed and was swallowed by the
   * caller's catch, request cancelled), the reservation used to hold cap for
   * the REST OF THE PERIOD, and enough of them pinned a paying customer at
   * the monthly cap. Absent on records written before the field existed;
   * those are treated as already expired (releases at most one in-flight
   * request per license across the deploy boundary, which under-meters once
   * rather than pinning forever).
   */
  createdAt?: string;
}

/**
 * How long a reservation may sit un-reconciled before the reaper releases
 * its hold. Upstream fetches complete or fail in well under a minute; ten
 * minutes leaves margin for retries inside the same request while bounding
 * the leak window.
 */
export const RESERVATION_TTL_MS = 10 * 60 * 1000;

export interface LicenseCounterState {
  dailyCalls: number;
  dailyResetAt: string;
  monthlyTokens: number;
  monthlyResetAt: string;
  reservations: Record<string, CounterReservation>;
  /**
   * Operator visibility (2026-08-23). The period counters answer "is this
   * licence at cap"; they cannot answer "has this licence ever been used",
   * because a period roll zeroes them and the KV mirror only fires on
   * material drift. These three fields never reset: the stamp of the most
   * recent reserve or reconcile, and lifetime totals of accepted calls and
   * reconciled tokens. Absent on state written before the field existed.
   */
  lastSeenAt?: string;
  totalCalls?: number;
  totalTokens?: number;
  /**
   * The day the key was paid for (its issue time). The monthly period rolls on this day each
   * month, so a first paid month cannot see two budgets. Absent on state written before the field
   * existed until the next reserve brings it; without it the period is the calendar month.
   */
  periodAnchor?: string;
}

export interface ReserveCounterInput {
  requestId: string;
  calls: number;
  tokens: number;
  dailyLimit: number;
  monthlyLimit: number;
  nowIso: string;
  dailyResetAt: string;
  monthlyResetAt: string;
  baselineDailyCalls?: number;
  baselineMonthlyTokens?: number;
  /** The key's issue time; see LicenseCounterState.periodAnchor. */
  periodAnchor?: string;
}

export interface ReconcileCounterInput {
  requestId: string;
  calls: number;
  tokens: number;
  nowIso: string;
}

export type ReserveCounterResult =
  | { ok: true }
  | { ok: false; cap: 'daily' | 'monthly' };

function nextUtcMidnightIso(now: Date): string {
  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  )).toISOString();
}

function nextUtcMonthStartIso(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

/** `anchor` moved `months` months on, on the month's last day when that month is shorter. */
function addMonthsClamped(anchor: Date, months: number): Date {
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(
    year, month, Math.min(anchor.getUTCDate(), lastDay),
    anchor.getUTCHours(), anchor.getUTCMinutes(), anchor.getUTCSeconds(), anchor.getUTCMilliseconds(),
  ));
}

/**
 * The start of the next monthly period after `now`, counted from the day the key was paid for
 * (`anchorIso`): the same day of each month, strictly after now. Without a readable anchor, or with
 * one in the future, the next calendar month, as before anchors existed.
 */
export function nextPeriodStartIso(anchorIso: string | undefined, now: Date): string {
  const anchor = anchorIso ? new Date(anchorIso) : null;
  if (!anchor || !Number.isFinite(anchor.getTime()) || anchor.getTime() > now.getTime()) {
    return nextUtcMonthStartIso(now);
  }
  const monthsBetween = (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12
    + (now.getUTCMonth() - anchor.getUTCMonth());
  for (let k = Math.max(1, monthsBetween); ; k++) {
    const candidate = addMonthsClamped(anchor, k);
    if (candidate.getTime() > now.getTime()) return candidate.toISOString();
  }
}

function nonNegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`invalid_${field}`);
  }
  return value;
}

function resetExpiredPeriods(state: LicenseCounterState, nowIso: string): LicenseCounterState {
  const now = new Date(nowIso);
  if (!Number.isFinite(now.getTime())) throw new Error('invalid_now');

  const next = { ...state };
  let periodRolled = false;
  if (new Date(state.dailyResetAt).getTime() <= now.getTime()) {
    next.dailyCalls = 0;
    next.dailyResetAt = nextUtcMidnightIso(now);
    periodRolled = true;
  }
  if (new Date(state.monthlyResetAt).getTime() <= now.getTime()) {
    next.monthlyTokens = 0;
    next.monthlyResetAt = nextPeriodStartIso(state.periodAnchor, now);
    periodRolled = true;
  }
  if (periodRolled) {
    next.reservations = Object.fromEntries(
      Object.entries(state.reservations).filter(([, reservation]) =>
        reservation.dailyResetAt === next.dailyResetAt
        || reservation.monthlyResetAt === next.monthlyResetAt),
    );
  }
  return next;
}

/**
 * TTL reaper for reservations whose reconcile never arrived. Releases the
 * held amounts back into the current-period counters (only the dimensions
 * whose period still matches; a rolled period already zeroed its counter).
 * Without this, a swallowed reconcile failure held cap until the period
 * flipped, and month-scoped holds could pin a paying customer at the
 * monthly cap for weeks. Reservations with no createdAt stamp (written
 * before the field existed) are treated as expired.
 */
function pruneExpiredReservations(state: LicenseCounterState, nowIso: string): LicenseCounterState {
  const nowMs = new Date(nowIso).getTime();
  let dailyRelease = 0;
  let monthlyRelease = 0;
  const survivors: Record<string, CounterReservation> = {};
  let pruned = false;
  for (const [id, reservation] of Object.entries(state.reservations)) {
    const createdMs = reservation.createdAt ? new Date(reservation.createdAt).getTime() : NaN;
    const expired = !Number.isFinite(createdMs) || nowMs - createdMs > RESERVATION_TTL_MS;
    if (!expired) {
      survivors[id] = reservation;
      continue;
    }
    pruned = true;
    if (reservation.dailyResetAt === state.dailyResetAt) dailyRelease += reservation.calls;
    if (reservation.monthlyResetAt === state.monthlyResetAt) monthlyRelease += reservation.tokens;
  }
  if (!pruned) return state;
  return {
    ...state,
    dailyCalls: Math.max(0, state.dailyCalls - dailyRelease),
    monthlyTokens: Math.max(0, state.monthlyTokens - monthlyRelease),
    reservations: survivors,
  };
}

export function reserveCounterState(
  stored: LicenseCounterState | null,
  input: ReserveCounterInput,
): { state: LicenseCounterState; result: ReserveCounterResult } {
  const calls = nonNegativeInteger(input.calls, 'calls');
  const tokens = nonNegativeInteger(input.tokens, 'tokens');
  const dailyLimit = nonNegativeInteger(input.dailyLimit, 'daily_limit');
  const monthlyLimit = nonNegativeInteger(input.monthlyLimit, 'monthly_limit');
  const initial: LicenseCounterState = stored ?? {
    dailyCalls: nonNegativeInteger(input.baselineDailyCalls ?? 0, 'baseline_daily_calls'),
    dailyResetAt: input.dailyResetAt,
    monthlyTokens: nonNegativeInteger(input.baselineMonthlyTokens ?? 0, 'baseline_monthly_tokens'),
    monthlyResetAt: input.monthlyResetAt,
    reservations: {},
    ...(input.periodAnchor ? { periodAnchor: input.periodAnchor } : {}),
  };
  // A counter written before anchors existed learns its anchor here. Its current period keeps the
  // reset it already has; the next one is counted from the anchor.
  const anchored = input.periodAnchor && !initial.periodAnchor
    ? { ...initial, periodAnchor: input.periodAnchor }
    : initial;
  const current = pruneExpiredReservations(
    resetExpiredPeriods(anchored, input.nowIso),
    input.nowIso,
  );

  if (current.reservations[input.requestId]) {
    return { state: current, result: { ok: true } };
  }
  if (current.dailyCalls + calls > dailyLimit) {
    return { state: current, result: { ok: false, cap: 'daily' } };
  }
  if (current.monthlyTokens + tokens > monthlyLimit) {
    return { state: current, result: { ok: false, cap: 'monthly' } };
  }

  return {
    state: {
      ...current,
      dailyCalls: current.dailyCalls + calls,
      monthlyTokens: current.monthlyTokens + tokens,
      lastSeenAt: input.nowIso,
      totalCalls: (current.totalCalls ?? 0) + calls,
      reservations: {
        ...current.reservations,
        [input.requestId]: {
          calls,
          tokens,
          dailyResetAt: current.dailyResetAt,
          monthlyResetAt: current.monthlyResetAt,
          createdAt: input.nowIso,
        },
      },
    },
    result: { ok: true },
  };
}

export function reconcileCounterState(
  stored: LicenseCounterState,
  input: ReconcileCounterInput,
): LicenseCounterState {
  const calls = nonNegativeInteger(input.calls, 'calls');
  const tokens = nonNegativeInteger(input.tokens, 'tokens');
  const current = pruneExpiredReservations(
    resetExpiredPeriods(stored, input.nowIso),
    input.nowIso,
  );
  const reserved = current.reservations[input.requestId];
  if (!reserved) return current;

  const reservations = { ...current.reservations };
  delete reservations[input.requestId];
  // A reservation whose period rolled bills its actuals into the NEW
  // period. Deliberate conservative choice, locked by the cross-reset case
  // in worker-license-counter.test.ts: the rollover zeroed the old period,
  // so crediting nowhere would let boundary-straddling requests escape the
  // caps entirely; billing them forward keeps the solvency guarantee.
  const dailyCalls = reserved.dailyResetAt === current.dailyResetAt
    ? current.dailyCalls + calls - reserved.calls
    : current.dailyCalls + calls;
  const monthlyTokens = reserved.monthlyResetAt === current.monthlyResetAt
    ? current.monthlyTokens + tokens - reserved.tokens
    : current.monthlyTokens + tokens;
  if (dailyCalls < 0 || monthlyTokens < 0) throw new Error('counter_underflow');

  return {
    ...current,
    dailyCalls,
    monthlyTokens,
    reservations,
    lastSeenAt: input.nowIso,
    totalTokens: (current.totalTokens ?? 0) + tokens,
  };
}
