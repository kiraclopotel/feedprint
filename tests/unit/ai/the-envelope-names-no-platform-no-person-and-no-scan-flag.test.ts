// The envelope carries no prior (the owner's document on the AI reading, 13 Oct 2026, principle 4, and the shape of
// what-leaves-at-the-network): no platform or surface name, no handle or display name, no pattern-scan flag, and none of
// what belongs to the ledger (feedSource, render state, expand events). Every fixture on both paths, at every node; the
// fixtures' own words name no platform, so a hit here is the module's doing.
import { describe, expect, it } from 'vitest';
import { envelopeForItem, envelopeForRoomNode, renderEnvelope } from '../../../src/ai/envelope';
import { ITEMS, NAMES, ROOMS } from '../../fixtures/envelope/items';
import type { PostContent } from '../../../src/types/post';

const PLATFORM_WORDS = ['twitter', 'x.com', 'tweet', 'tiktok', 'instagram', 'facebook', 'youtube', 'reel', 'shorts', 'permalink', 'home-feed', 'photo-modal'];
const SCAN_WORDS = ['hf:', 'flagged', 'pattern', 'harm', 'ad-hominem', 'identity-slur', 'liar', 'score'];
const LEDGER_WORDS = ['feedsource', 'for-you', 'following', 'visible-now', 'just-rendered', 'expand', 'render'];

function everyEnvelope(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const items: Record<string, PostContent> = {
    ...ITEMS,
    // The ledger's fields set on an item: the envelope must still not print them.
    // A card with only its display-name line (the shape that has no name-free part): it must not reach the envelope.
    'card by display name': { ...ITEMS['instagram caption'], card: { text: 'From Oak Person', accounts: ['quoted_oak'] } },
    'ledger fields': { ...ITEMS['x reply'], feedSource: 'for-you', render_state: 'just-rendered-by-expand', expand_event_observed: true },
  };
  for (const [name, post] of Object.entries(items)) out.push([name, renderEnvelope(envelopeForItem(post))]);
  for (const [platform, room] of Object.entries(ROOMS)) {
    const ids = [room.post.id, ...room.ancestors.map((c) => c.id), room.focused.id, ...room.children.map((c) => c.id)];
    for (const id of ids) {
      const e = envelopeForRoomNode(room, id);
      if (e) out.push([`${platform} ${id}`, renderEnvelope(e)]);
    }
  }
  return out;
}

describe('the envelope names no platform, no person and no scan flag', () => {
  const all = everyEnvelope();

  it('covers every item and every room node', () => {
    expect(all.length).toBeGreaterThanOrEqual(Object.keys(ITEMS).length + 15);
  });

  it('prints no platform or surface name', () => {
    const surfaces = Object.values(ROOMS).map((r) => r.surface.kind);
    for (const [name, text] of all) for (const w of [...PLATFORM_WORDS, ...surfaces]) expect(text.toLowerCase(), `${name}: ${w}`).not.toContain(w);
  });

  it('prints no handle and no display name, only the call\'s letters', () => {
    for (const [name, text] of all) for (const n of NAMES) expect(text.toLowerCase(), `${name}: ${n}`).not.toContain(n.toLowerCase());
  });

  it('prints no pattern-scan flag and nothing the ledger keeps', () => {
    for (const [name, text] of all) {
      for (const w of [...SCAN_WORDS, ...LEDGER_WORDS]) expect(text.toLowerCase(), `${name}: ${w}`).not.toContain(w);
    }
  });
});
