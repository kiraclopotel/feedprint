// FeelingWise - a breaker on an observer's own call rate.
//
// A MutationObserver on a streaming surface (a live chat, a live comment
// stream, a tray that refreshes) fires thousands of times a minute for as
// long as the tab lives, and every callback is work: node accumulation, a
// drain, extraction, the batch judge. The surface inventory (surfaces.ts)
// names the streams it knows and stands down; this breaker is the guard for
// the ones it does not know yet, and for a known page that turns into one.
//
// The rule: count callbacks in a sliding minute. When the count stays at or
// above the threshold for a whole sustain period, trip: the owner disconnects
// its observer, notes a gap (the record says the recorder stood down here and
// for how many callbacks), and re-arms after the cooldown. A burst that ends
// inside the sustain period never trips: page hydration is a burst, a stream
// is not. Pure, clock-injected, one instance per observer.

export interface ChurnBreakerOptions {
  /** Callbacks per sliding minute at or above which the observer is considered hot. */
  maxPerMinute: number;
  /** How long the rate must stay hot before the breaker trips. */
  sustainMs: number;
  /** How long the breaker stays open (observer disconnected) after a trip. */
  cooldownMs: number;
  now?: () => number;
}

export interface ChurnNote {
  /** True on the one call that trips the breaker. */
  tripped: boolean;
  /** Callbacks counted in the minute that tripped it; 0 otherwise. */
  count: number;
}

const MINUTE_MS = 60_000;

export class ChurnBreaker {
  private readonly opts: Required<ChurnBreakerOptions>;
  private stamps: number[] = [];
  private hotSince: number | null = null;
  private openUntil = 0;
  private trips = 0;

  constructor(opts: ChurnBreakerOptions) {
    this.opts = { now: () => Date.now(), ...opts };
  }

  /** One observer callback. Cheap: a push, a trim from the front, a comparison. */
  note(): ChurnNote {
    const now = this.opts.now();
    if (now < this.openUntil) return { tripped: false, count: 0 };
    this.stamps.push(now);
    const cutoff = now - MINUTE_MS;
    let drop = 0;
    while (drop < this.stamps.length && this.stamps[drop] < cutoff) drop++;
    if (drop > 0) this.stamps.splice(0, drop);
    const count = this.stamps.length;
    if (count < this.opts.maxPerMinute) {
      this.hotSince = null;
      return { tripped: false, count: 0 };
    }
    if (this.hotSince === null) this.hotSince = now;
    if (now - this.hotSince < this.opts.sustainMs) return { tripped: false, count: 0 };
    this.openUntil = now + this.opts.cooldownMs;
    this.hotSince = null;
    this.stamps = [];
    this.trips++;
    return { tripped: true, count };
  }

  /** True while the observer should stay disconnected. */
  isOpen(): boolean {
    return this.opts.now() < this.openUntil;
  }

  /** Milliseconds until the breaker closes; 0 when closed. */
  remainingMs(): number {
    return Math.max(0, this.openUntil - this.opts.now());
  }

  get tripCount(): number {
    return this.trips;
  }
}
