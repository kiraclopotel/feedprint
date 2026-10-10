// Q77 (wiring W68): the poison-outbox dead-letter.
//
// One deterministically failing delivery used to retry forever while the
// pump stopped at the head: every later record was ACKed 'pending' but
// never committed, and month rotation returned pending-deliveries for as
// long as the row existed. Now attempts cap at
// FORENSIC_DELIVERY_ATTEMPT_CEILING; the row is QUARANTINED - kept in the
// outbox as evidence, never deleted (VISION 1.1: loud, not silent) - the
// pump walks past it, pendingCount excludes it (unblocking rotation), and
// the Issues tab shows the held count.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deleteDb as deleteSharedDb } from '../../helpers/indexeddb';
import {
  enqueueForensicDelivery,
  getForensicDeliveryStatus,
  getNextForensicDelivery,
  markForensicDeliveryFailure,
  FORENSIC_DELIVERY_ATTEMPT_CEILING,
} from '../../../src/forensics/delivery-outbox';

const DB_NAME = 'feelingwise-forensics';
const PUMP_PATH = 'src/forensics/forensic-delivery-pump.ts';
const OPERATIONAL_EVENTS_PANEL_PATH = 'src/ui/dashboard/components/OperationalEventsPanel.tsx';

/** The chain database, torn down through the shared helper. */
const deleteDb = (): Promise<void> => deleteSharedDb(DB_NAME);

async function enqueue(id: string): Promise<void> {
  await enqueueForensicDelivery({
    deliveryId: id,
    type: 'FORENSIC_LOG',
    payload: { marker: id },
    enqueuedAt: '2026-08-11T07:00:00.000Z',
  });
}

beforeEach(async () => {
  await deleteDb();
});

describe('Q77 — attempt ceiling quarantines the head and frees the queue', () => {
  it('below the ceiling the row keeps retrying', async () => {
    await enqueue('poison');
    for (let i = 1; i < FORENSIC_DELIVERY_ATTEMPT_CEILING; i++) {
      expect(await markForensicDeliveryFailure('poison', `boom ${i}`)).toBe('retrying');
    }
    const status = await getForensicDeliveryStatus();
    expect(status.quarantinedCount).toBe(0);
    expect(status.pendingCount).toBe(1);
  });

  it('at the ceiling the row is quarantined and the next row becomes the head', async () => {
    await enqueue('poison');
    await enqueue('healthy');
    for (let i = 0; i < FORENSIC_DELIVERY_ATTEMPT_CEILING; i++) {
      await markForensicDeliveryFailure('poison', 'deterministic failure');
    }
    // The pump's next read walks past the quarantined head.
    const next = await getNextForensicDelivery();
    expect(next?.deliveryId).toBe('healthy');

    const status = await getForensicDeliveryStatus();
    // pendingCount excludes the quarantined row, so the rotation gate
    // (pendingCount > 0 -> pending-deliveries) unblocks once 'healthy'
    // commits; the held row gets its own count for the Issues card.
    expect(status.quarantinedCount).toBe(1);
    expect(status.pendingCount).toBe(1);
  });

  it('the quarantined row is KEPT as evidence, never deleted', async () => {
    await enqueue('poison');
    for (let i = 0; i < FORENSIC_DELIVERY_ATTEMPT_CEILING; i++) {
      await markForensicDeliveryFailure('poison', 'deterministic failure');
    }
    const status = await getForensicDeliveryStatus();
    expect(status.quarantinedCount).toBe(1);
    expect(status.byType.FORENSIC_LOG).toBe(1); // still in the outbox
    expect(status.lastError).toBe('deterministic failure');
  });

  it('an unknown deliveryId reports missing', async () => {
    expect(await markForensicDeliveryFailure('ghost', 'x')).toBe('missing');
  });
});

describe('wiring (source-lock)', () => {
  it('the pump continues past a quarantined head instead of stopping', () => {
    const pump = readFileSync(join(process.cwd(), PUMP_PATH), 'utf8');
    expect(pump).toContain("if (outcome === 'quarantined') {");
    expect(pump).toContain('continue;');
  });

  it('the Issues tab renders the quarantine card from quarantinedCount', () => {
    const panel = readFileSync(join(process.cwd(), OPERATIONAL_EVENTS_PANEL_PATH), 'utf8');
    expect(panel).toContain('forensicDeliveryStatus.quarantinedCount > 0');
    expect(panel).toContain('t.opsCardDeliveryQuarantinedTitle(forensicDeliveryStatus.quarantinedCount)');
  });
});
