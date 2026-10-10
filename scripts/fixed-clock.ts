// Runs a generator with `new Date()` and `Date.now()` reading one fixed instant, so the files it
// writes carry the same made-at time on every run and a rebuild's diff shows only what changed.
// Dates built from an argument are untouched.

export async function underFixedClock<T>(iso: string, fn: () => Promise<T>): Promise<T> {
  const RealDate = Date;
  const fixed = RealDate.parse(iso);
  if (Number.isNaN(fixed)) throw new Error(`not a time: ${iso}`);
  class FixedDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(fixed);
      else super(...(args as [string | number | Date]));
    }
    static now(): number { return fixed; }
  }
  globalThis.Date = FixedDate as DateConstructor;
  try { return await fn(); } finally { globalThis.Date = RealDate; }
}
