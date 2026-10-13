import { DurableObject } from 'cloudflare:workers';
import type { Env } from './proxy';
import {
  reconcileCounterState,
  reserveCounterState,
  type LicenseCounterState,
  type ReconcileCounterInput,
  type ReserveCounterInput,
  type ReserveCounterResult,
} from './license-counter-state';

const COUNTER_STORAGE_KEY = 'counter';

export class LicenseCounter extends DurableObject<Env> {
  private readonly storage: DurableObjectStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.storage = ctx.storage;
  }

  async reserve(input: ReserveCounterInput): Promise<ReserveCounterResult> {
    const stored = await this.storage.get<LicenseCounterState>(COUNTER_STORAGE_KEY) ?? null;
    const transition = reserveCounterState(stored, input);
    await this.storage.put(COUNTER_STORAGE_KEY, transition.state);
    return transition.result;
  }

  /**
   * Q18 KV mirror: returns the post-reconcile counter snapshot so the proxy
   * can mirror the Durable Object's truth back into the KV license record
   * (KV counters were otherwise dead for all paid traffic, and a recreated
   * counter would re-seed its baseline from stale KV zeros). Null when no
   * counter state exists yet.
   */
  /**
   * Operator read (2026-08-23): the counter truth without mutating it.
   * Periods are reported as stored; a counter whose period has lapsed still
   * shows the old period's figures, and the caller reads `dailyResetAt` /
   * `monthlyResetAt` to know that. Null when the licence has never reached
   * the reserve path, which is itself the answer "never used".
   */
  async inspect(): Promise<CounterInspection | null> {
    const stored = await this.storage.get<LicenseCounterState>(COUNTER_STORAGE_KEY);
    if (!stored) return null;
    return {
      dailyCalls: stored.dailyCalls,
      dailyResetAt: stored.dailyResetAt,
      monthlyTokens: stored.monthlyTokens,
      monthlyResetAt: stored.monthlyResetAt,
      lastSeenAt: stored.lastSeenAt ?? null,
      totalCalls: stored.totalCalls ?? 0,
      totalTokens: stored.totalTokens ?? 0,
      pendingReservations: Object.keys(stored.reservations).length,
    };
  }

  async reconcile(input: ReconcileCounterInput): Promise<CounterSnapshot | null> {
    const stored = await this.storage.get<LicenseCounterState>(COUNTER_STORAGE_KEY);
    if (!stored) return null;
    const reconciled = reconcileCounterState(stored, input);
    await this.storage.put(COUNTER_STORAGE_KEY, reconciled);
    return {
      dailyCalls: reconciled.dailyCalls,
      dailyResetAt: reconciled.dailyResetAt,
      monthlyTokens: reconciled.monthlyTokens,
      monthlyResetAt: reconciled.monthlyResetAt,
    };
  }
}

/** Post-reconcile counter truth, as mirrored into the KV license record. */
export interface CounterSnapshot {
  dailyCalls: number;
  dailyResetAt: string;
  monthlyTokens: number;
  monthlyResetAt: string;
}

/** Read-only operator view of one counter, from `inspect()`. */
export interface CounterInspection extends CounterSnapshot {
  lastSeenAt: string | null;
  totalCalls: number;
  totalTokens: number;
  pendingReservations: number;
}
