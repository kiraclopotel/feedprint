// The envelope of the one filter, pinned byte for byte: one item per platform and kind as a scrolled feed hands it over,
// and nodes of an opened room per platform (the owner's document on the AI reading, 13 Oct 2026, pages 11, 14 and 15).
// The two depths give the same shape; only which lines are filled differs.
import { describe, expect, it } from 'vitest';
import { envelopeForItem, envelopeForRoomNode, renderEnvelope } from '../../../src/ai/envelope';
import { ITEMS, ROOMS } from '../../fixtures/envelope/items';

const item = (name: string): string => renderEnvelope(envelopeForItem(ITEMS[name]));
const room = (platform: string, id: string): string => {
  const e = envelopeForRoomNode(ROOMS[platform], id);
  if (!e) throw new Error(`no node ${id}`);
  return renderEnvelope(e);
};

const ITEM_EXPECTED: Record<string, string> = {
  'x post': `ITEM
kind: post
shown: whole
media: not known
placement: ordinary
text:
A long thread on bus fares, thanks @user_B for the numbers.

CONTEXT, not judged
replies to: not shown
quotes or links: quoted post: Fares rose twice this year.; link: City budget, explained
top replies: not shown
reactions: 1,200 approvals, 85 comments, 12 shares
surfaced first: not shown`,
  'x reply': `ITEM
kind: reply
shown: whole
media: not known
placement: ordinary
text:
Not true, check the budget.

CONTEXT, not judged
replies to: Fares rose twice this year, says @user_B.
quotes or links: not shown
top replies: not shown
reactions: 3 approvals, replies not shown, shares not shown
surfaced first: not shown`,
  'tiktok caption': `ITEM
kind: caption
shown: first lines only
media: video, not read
placement: ordinary
text:
day three of learning the violin

CONTEXT, not judged
replies to: none
quotes or links: not shown
top replies:
- you got this
- the second song was better
- keep going
reactions: 5,400 approvals, 210 comments, 31 shares
surfaced first: not shown`,
  'tiktok comment': `ITEM
kind: comment
shown: whole
media: not known
placement: ordinary
text:
you got this

CONTEXT, not judged
replies to: not shown
quotes or links: not shown
top replies: not shown
reactions: 1 approval, replies not shown, shares not shown
surfaced first: yes`,
  'instagram caption': `ITEM
kind: caption
shown: first lines only
media: image or video, not read
placement: ordinary
text:
Sunday market, too many lemons.
More tomorrow.

CONTEXT, not judged
replies to: none
quotes or links: not shown
top replies: not shown
reactions: approvals not shown, 14 comments, shares not shown
surfaced first: not shown`,
  'instagram reply': `ITEM
kind: reply
shown: whole
media: not known
placement: ordinary
text:
@user_B which stall?

CONTEXT, not judged
replies to: not shown
quotes or links: not shown
top replies: not shown
reactions: 2 approvals, 0 replies, shares not shown
surfaced first: not shown`,
  'facebook post': `ITEM
kind: post
shown: not read from the screen
media: not known
placement: paid
text:
Buy two get one free this week only!

CONTEXT, not judged
replies to: none
quotes or links: not shown
top replies: not shown
reactions: 87 approvals, 4 comments, 1 share
surfaced first: not shown`,
  'facebook caption': `ITEM
kind: caption
shown: whole
media: video, not read
placement: ordinary
text:
The bridge at night

CONTEXT, not judged
replies to: none
quotes or links: not shown
top replies: not shown
reactions: 2 approvals, comments not shown, shares not shown
surfaced first: not shown`,
  'facebook comment': `ITEM
kind: comment
shown: not known
media: not known
placement: ordinary
text:
Is this still on?

CONTEXT, not judged
replies to: not shown
quotes or links: not shown
top replies: not shown
reactions: 0 approvals, 2 replies, shares not shown
surfaced first: not shown`,
  'youtube title': `ITEM
kind: title
shown: whole
media: video, not read
placement: ordinary
text:
How tides work (in 6 minutes)

CONTEXT, not judged
replies to: none
quotes or links: not shown
top replies: not shown
reactions: 15,000 approvals, comments not shown, shares not shown
surfaced first: not shown`,
  'youtube comment': `ITEM
kind: comment
shown: not known
media: not known
placement: ordinary
text:
Clearest one I have seen.

CONTEXT, not judged
replies to: not shown
quotes or links: not shown
top replies: not shown
reactions: 44 approvals, 1 reply, shares not shown
surfaced first: not shown`,
};

const ROOM_EXPECTED: Array<[string, string, string]> = [
  ['youtube', 'yt1', `ITEM
kind: title
shown: not known
media: video, not read
placement: ordinary
text:
How tides work (in 6 minutes)

CONTEXT, not judged
replies to: none
quotes or links: not shown
top replies:
- Pinned: thanks all for watching
- The moon part lost me, @user_A
reactions: 15,000 approvals, 2,436 comments, shares not shown
surfaced first: not shown`],
  ['youtube', 'c1', `ITEM
kind: comment
shown: not known
media: not known
placement: ordinary
text:
Pinned: thanks all for watching

CONTEXT, not judged
replies to: How tides work (in 6 minutes)
quotes or links: not shown
top replies: not shown
reactions: 300 approvals, 1 reply, shares not shown
surfaced first: yes`],
  ['youtube', 'c2', `ITEM
kind: comment
shown: not known
media: not known
placement: ordinary
text:
The moon part lost me, @user_A

CONTEXT, not judged
replies to: How tides work (in 6 minutes)
quotes or links: not shown
top replies:
- It is the pull on both sides.
reactions: 12 approvals, replies not shown, shares not shown
surfaced first: no`],
  ['youtube', 'c3', `ITEM
kind: reply
shown: not known
media: not known
placement: ordinary
text:
It is the pull on both sides.

CONTEXT, not judged
replies to: The moon part lost me, @user_A
quotes or links: not shown
top replies: not shown
reactions: not shown
surfaced first: yes`],
  ['twitter', 'x1', `ITEM
kind: post
shown: not known
media: not known
placement: ordinary
text:
Fares rose twice this year.

CONTEXT, not judged
replies to: not shown
quotes or links: quoted post: not shown
top replies:
- Says who, @user_A?
reactions: 50 approvals, 9 comments, 4 shares
surfaced first: not shown`],
  ['twitter', 'x3', `ITEM
kind: reply
shown: not known
media: not known
placement: ordinary
text:
The council minutes say so.

CONTEXT, not judged
replies to: Says who, @user_A?
quotes or links: not shown
top replies:
- Source?
reactions: not shown
surfaced first: not shown`],
  ['twitter', 'x4', `ITEM
kind: reply
shown: not known
media: none
placement: ordinary
text:
Source?

CONTEXT, not judged
replies to: The council minutes say so.
quotes or links: not shown
top replies: not shown
reactions: not shown
surfaced first: yes`],
  ['instagram', 'ig1', `ITEM
kind: caption
shown: not known
media: image or video, not read
placement: ordinary
text:
Sunday market, too many lemons.

CONTEXT, not judged
replies to: none
quotes or links: not shown
top replies:
- no text
reactions: approvals not shown, 14 comments, shares not shown
surfaced first: not shown`],
  ['instagram', 'ig2', `ITEM
kind: comment
shown: not known
media: image or video, not read
placement: ordinary
text:
no text

CONTEXT, not judged
replies to: Sunday market, too many lemons.
quotes or links: not shown
top replies: not shown
reactions: not shown
surfaced first: yes`],
  ['tiktok', 'tt1', `ITEM
kind: caption
shown: not known
media: video, not read
placement: ordinary
text:
day three of learning the violin

CONTEXT, not judged
replies to: none
quotes or links: not shown
top replies:
- you got this
- the second song was better
reactions: 5,400 approvals, 210 comments, 31 shares
surfaced first: not shown`],
  ['tiktok', 'tt3', `ITEM
kind: comment
shown: not known
media: not known
placement: ordinary
text:
the second song was better

CONTEXT, not judged
replies to: day three of learning the violin
quotes or links: not shown
top replies: not shown
reactions: not shown
surfaced first: no`],
  ['facebook', 'fb1', `ITEM
kind: post
shown: not known
media: not known
placement: paid
text:
Buy two get one free this week only!

CONTEXT, not judged
replies to: none
quotes or links: not shown
top replies:
- Is this still on?
reactions: 87 approvals, 4 comments, 1 share
surfaced first: not shown`],
  ['facebook', 'fb2', `ITEM
kind: comment
shown: not known
media: not known
placement: ordinary
text:
Is this still on?

CONTEXT, not judged
replies to: Buy two get one free this week only!
quotes or links: not shown
top replies: not shown
reactions: approvals not shown, 2 replies, shares not shown
surfaced first: yes`],
];

describe('the envelope says what the reader saw, and nothing else', () => {
  it('pins one item per platform and kind, as a scrolled feed hands it over', () => {
    expect(Object.keys(ITEM_EXPECTED).sort()).toEqual(Object.keys(ITEMS).sort());
    for (const [name, expected] of Object.entries(ITEM_EXPECTED)) expect(item(name), name).toBe(expected);
  });

  it('pins the post and the comments of an opened room on every platform', () => {
    expect(new Set(ROOM_EXPECTED.map(([p]) => p))).toEqual(new Set(Object.keys(ROOMS)));
    for (const [platform, id, expected] of ROOM_EXPECTED) expect(room(platform, id), `${platform} ${id}`).toBe(expected);
  });

  it('gives the same lines, in the same order, at both depths', () => {
    // The labels alone: the text block and the reply bullets are content, not shape.
    const shape = (text: string): string[] => {
      const lines = text.split('\n');
      const ctx = lines.lastIndexOf('CONTEXT, not judged');
      const head = lines.slice(0, lines.indexOf('text:') + 1);
      const tail = lines.slice(ctx).filter((l) => !l.startsWith('- '));
      return [...head, ...tail].map((l) => l.split(':')[0]);
    };
    const expected = ['ITEM', 'kind', 'shown', 'media', 'placement', 'text', 'CONTEXT, not judged', 'replies to', 'quotes or links', 'top replies', 'reactions', 'surfaced first'];
    for (const name of Object.keys(ITEMS)) expect(shape(item(name)), name).toEqual(expected);
    for (const [platform, id] of ROOM_EXPECTED) expect(shape(room(platform, id)), `${platform} ${id}`).toEqual(expected);
  });

  it('answers null for a node the room does not hold', () => {
    expect(envelopeForRoomNode(ROOMS.youtube, 'nowhere')).toBeNull();
  });
});
