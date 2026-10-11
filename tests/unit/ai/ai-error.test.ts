// FeelingWise — Result<T, E> + AIFailure + parseRetryAfterMs unit tests.
//
// Locks the typed-error-handling primitives at src/ai/ai-error.ts. These are
// the load-bearing return types for the LLM cascade: callAI returns
// Result<string, AIFailure>, and Retry-After parsing decides whether the
// in-client retry layer respects the server's hint or falls back to a default
// backoff. Wrong number on Retry-After = wrong wait = either thrash (too
// short) or stall (too long).

import { describe, it, expect } from 'vitest';

import {
  Ok,
  Err,
  unwrapOrEmpty,
  parseRetryAfterMs,
  type AIFailure,
  type Result,
} from '../../../src/ai/ai-error';

describe('Ok / Err constructors', () => {
  it('Ok(value) produces { ok: true, value }', () => {
    const r = Ok('hello');
    expect(r).toEqual({ ok: true, value: 'hello' });
  });

  it('Err(error) produces { ok: false, error }', () => {
    const failure: AIFailure = { kind: 'rate-limit', retryAfterMs: 5000 };
    const r = Err(failure);
    expect(r).toEqual({ ok: false, error: failure });
  });
});

describe('unwrapOrEmpty', () => {
  it('returns the success value on Ok', () => {
    expect(unwrapOrEmpty(Ok('x'))).toBe('x');
  });

  it('returns "" on Err', () => {
    const failure: AIFailure = { kind: 'rate-limit', retryAfterMs: 5000 };
    expect(unwrapOrEmpty(Err(failure))).toBe('');
  });

  it('returns "" on Ok("") — success-with-empty-value still empty', () => {
    expect(unwrapOrEmpty(Ok(''))).toBe('');
  });
});

describe('parseRetryAfterMs', () => {
  it('parses a numeric-seconds value to milliseconds', () => {
    expect(parseRetryAfterMs('5')).toBe(5000);
  });

  it('parses "0" to 0', () => {
    expect(parseRetryAfterMs('0')).toBe(0);
  });

  it('trims surrounding whitespace before parsing', () => {
    expect(parseRetryAfterMs('   30  ')).toBe(30000);
  });

  it('returns a positive number for an HTTP-date in the future', () => {
    const result = parseRetryAfterMs('Wed, 21 Oct 2099 07:28:00 GMT');
    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThan(0);
  });

  it('clamps a past HTTP-date to 0', () => {
    expect(parseRetryAfterMs('Wed, 21 Oct 2000 07:28:00 GMT')).toBe(0);
  });

  it('returns undefined for non-numeric, non-date strings', () => {
    expect(parseRetryAfterMs('not-a-number')).toBeUndefined();
  });

  it('returns undefined for null', () => {
    expect(parseRetryAfterMs(null)).toBeUndefined();
  });

  it('returns undefined for undefined', () => {
    expect(parseRetryAfterMs(undefined)).toBeUndefined();
  });

  it('returns undefined for the empty string', () => {
    expect(parseRetryAfterMs('')).toBeUndefined();
  });
});

describe('AIFailure discriminated union narrowing', () => {
  // Every AIFailure variant flows through this exhaustive switch. The test
  // guarantees the union still discriminates by `kind` after edits — if a
  // new variant is added without updating this switch, TS will error at
  // compile time on the never-typed default branch.
  it('narrows by kind in a switch block (every variant exercised)', () => {
    const variants: AIFailure[] = [
      { kind: 'transient-http', status: 503 },
      { kind: 'transient-http', status: 502, retryAfterMs: 1000 },
      { kind: 'rate-limit', retryAfterMs: 5000 },
      { kind: 'json-refusal' },
      { kind: 'auth-refusal' },
      { kind: 'consent-required' },
      { kind: 'content-policy' },
      { kind: 'network' },
      { kind: 'network', message: 'fetch failed' },
      { kind: 'aborted' },
      { kind: 'cap-exhausted', cap: 'daily' },
      { kind: 'cap-exhausted', cap: 'monthly' },
      { kind: 'cap-exhausted', cap: 'tier-free' },
      { kind: 'pre-llm-circuit-breaker' },
      { kind: 'pre-llm-unsupported-language' },
      { kind: 'internal-error', status: 400, code: 'json_validate_failed' },
    ];

    for (const f of variants) {
      let label: string;
      switch (f.kind) {
        case 'transient-http':
          label = `transient ${f.status}`;
          break;
        case 'rate-limit':
          label = `rate-limit ${f.retryAfterMs}`;
          break;
        case 'json-refusal':
          label = 'json-refusal';
          break;
        case 'auth-refusal':
          label = 'auth-refusal';
          break;
        case 'consent-required':
          label = 'consent-required';
          break;
        case 'content-policy':
          label = 'content-policy';
          break;
        case 'network':
          label = `network ${f.message ?? ''}`;
          break;
        case 'aborted':
          label = 'aborted';
          break;
        case 'cap-exhausted':
          label = `cap-${f.cap}`;
          break;
        case 'pre-llm-circuit-breaker':
          label = 'pre-llm-circuit-breaker';
          break;
        case 'pre-llm-unsupported-language':
          label = 'pre-llm-unsupported-language';
          break;
        case 'coordinator-unavailable':
          label = 'coordinator-unavailable';
          break;
        case 'internal-error':
          label = `internal-error ${f.status} ${f.code ?? ''}`;
          break;
        default: {
          const exhaustive: never = f;
          throw new Error(`unreachable: ${String(exhaustive)}`);
        }
      }
      expect(typeof label).toBe('string');
    }
  });

  it('Result<T, E> narrows by .ok at the type level', () => {
    const ok: Result<string, AIFailure> = Ok('x');
    const err: Result<string, AIFailure> = Err({ kind: 'aborted' });

    if (ok.ok) {
      expect(ok.value).toBe('x');
    } else {
      throw new Error('Ok should narrow to ok=true branch');
    }

    if (!err.ok) {
      expect(err.error.kind).toBe('aborted');
    } else {
      throw new Error('Err should narrow to ok=false branch');
    }
  });
});
