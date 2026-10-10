import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/forensics/delivery-outbox', () => ({
  getNextForensicDelivery: vi.fn(),
  markForensicDeliveryFailure: vi.fn(async () => undefined),
}));

vi.mock('../../../src/forensics/logger', () => ({
  logForensicEvent: vi.fn(async () => undefined),
  logPassEvent: vi.fn(async () => undefined),
  logEnvironmentEvent: vi.fn(async () => undefined),
  logCancelEvent: vi.fn(async () => undefined),
  logBlockedEvent: vi.fn(async () => undefined),
}));

import {
  getNextForensicDelivery,
  markForensicDeliveryFailure,
  type ForensicDeliveryEntry,
} from '../../../src/forensics/delivery-outbox';
import {
  logForensicEvent,
  logPassEvent,
  logEnvironmentEvent,
  logCancelEvent,
  logBlockedEvent,
} from '../../../src/forensics/logger';
import {
  kickForensicDeliveryPump,
  _resetForensicDeliveryPumpForTesting,
} from '../../../src/forensics/forensic-delivery-pump';

const mockedNext = vi.mocked(getNextForensicDelivery);
const mockedMarkFailure = vi.mocked(markForensicDeliveryFailure);

function entry(type: ForensicDeliveryEntry['type'], id = `delivery-${type}`): ForensicDeliveryEntry {
  return {
    deliveryId: id,
    type,
    payload: { originalText: id },
    enqueuedAt: '2026-07-11T10:00:00.000Z',
    attempts: 0,
  } as ForensicDeliveryEntry;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedNext.mockResolvedValue(null);
  mockedMarkFailure.mockResolvedValue('retrying');
  _resetForensicDeliveryPumpForTesting();
});

afterEach(() => {
  _resetForensicDeliveryPumpForTesting();
  vi.useRealTimers();
});

describe('SW forensic delivery pump', () => {
  it.each([
    ['FORENSIC_LOG', logForensicEvent],
    ['PASS_LOG', logPassEvent],
    ['ENVIRONMENT_LOG', logEnvironmentEvent],
    ['CANCEL_LOG', logCancelEvent],
    ['BLOCKED_LOG', logBlockedEvent],
  ] as const)('routes %s through its logger with the stable delivery id', async (type, logger) => {
    const queued = entry(type);
    mockedNext.mockResolvedValueOnce(queued).mockResolvedValueOnce(null);

    await kickForensicDeliveryPump();

    expect(logger).toHaveBeenCalledWith(
      queued.payload,
      queued.deliveryId,
      queued.enqueuedAt,
      queued.disposition,
    );
    expect(mockedMarkFailure).not.toHaveBeenCalled();
  });

  it('stops after the first persistence failure and records durable failure metadata', async () => {
    const first = entry('FORENSIC_LOG', 'delivery-first');
    const second = entry('PASS_LOG', 'delivery-second');
    mockedNext.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    vi.mocked(logForensicEvent).mockRejectedValueOnce(new Error('signing storage unavailable'));

    await kickForensicDeliveryPump();

    expect(logForensicEvent).toHaveBeenCalledTimes(1);
    expect(logPassEvent).not.toHaveBeenCalled();
    expect(mockedNext).toHaveBeenCalledTimes(1);
    expect(mockedMarkFailure).toHaveBeenCalledWith(
      first.deliveryId,
      'signing storage unavailable',
      expect.any(String),
    );
  });

  it('coalesces overlapping kicks into one global SW drain', async () => {
    const queued = entry('FORENSIC_LOG', 'delivery-one-flight');
    mockedNext.mockResolvedValueOnce(queued).mockResolvedValueOnce(null);
    let release!: () => void;
    vi.mocked(logForensicEvent).mockImplementationOnce(
      () => new Promise<void>((resolve) => { release = resolve; }),
    );

    const first = kickForensicDeliveryPump();
    await vi.waitFor(() => expect(logForensicEvent).toHaveBeenCalledTimes(1));
    const overlapping = kickForensicDeliveryPump();
    await Promise.resolve();

    expect(logForensicEvent).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, overlapping]);
  });

  it('does not retry an entry before its persisted next-attempt time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-11T10:00:00.000Z'));
    const queued = {
      ...entry('FORENSIC_LOG', 'delivery-backoff'),
      nextAttemptAt: '2026-07-11T10:00:04.000Z',
    };
    mockedNext.mockResolvedValueOnce(queued).mockResolvedValueOnce(queued).mockResolvedValueOnce(null);

    const initial = kickForensicDeliveryPump();
    await initial;
    expect(logForensicEvent).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(4_000);
    expect(logForensicEvent).toHaveBeenCalledTimes(1);
  });

  it('contains an outbox read failure and schedules recovery', async () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedNext.mockRejectedValueOnce(new Error('IDB read unavailable')).mockResolvedValueOnce(null);

    await expect(kickForensicDeliveryPump()).resolves.toBeUndefined();
    expect(mockedNext).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(4_000);
    expect(mockedNext).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
