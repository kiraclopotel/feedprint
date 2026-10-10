// Renders FeedCard to static markup and asserts the redesign legibility
// upgrades: the per-record kind badge (post / comment / reply / video /
// AI-summary) and that EVERY technique renders as a chip, not just the first.
// useDashboardT() reads an I18n context with a safe default, so wrapping in
// <I18nProvider lang="en"> pins the assertions to the English table.

import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FeedCard, TimelineRow, timelineSeverity } from '../../../../../src/ui/dashboard/components/FeedCard';
import {
  PostGroupCard,
  countGroupInventory,
  type RecordGroup,
} from '../../../../../src/ui/dashboard/components/PostGroupCard';
import { I18nProvider } from '../../../../../src/i18n/react';
import type { ForensicRecord } from '../../../../../src/types/forensic';

function makeRecord(over: Partial<ForensicRecord>): ForensicRecord {
  return {
    id: 'r1',
    timestamp: '2026-06-13T21:00:00.000Z',
    platform: 'tiktok',
    originalText: 'sample text',
    originalHash: 'h',
    originalLength: 11,
    neutralizedText: '',
    author: 'creator99',
    postUrl: 'https://www.tiktok.com/@creator99/video/123',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'teen',
    aiSource: 'cloud',
    feedSource: 'foryou',
    integrityHash: 'ih',
    ...over,
  } as ForensicRecord;
}

function renderCard(record: ForensicRecord): string {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, { lang: 'en', children: React.createElement(FeedCard, { record }) }),
  );
}

type FeedCardProps = React.ComponentProps<typeof FeedCard>;
function renderCardWith(props: FeedCardProps): string {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, { lang: 'en', children: React.createElement(FeedCard, props) }),
  );
}

function makeGroup(over: Partial<RecordGroup>): RecordGroup {
  return {
    key: 'tiktok:123',
    postRecord: makeRecord({ id: 'post-1', kind: 'video', parentVideoId: '123' }),
    roomAuthor: 'creator99',
    roomCaption: 'caption',
    roomUrl: 'https://www.tiktok.com/@creator99/video/123',
    platform: 'tiktok',
    latestTs: '2026-06-13T21:00:10.000Z',
    children: [],
    flaggedCount: 0,
    blockedCount: 0,
    firstSeenAt: '2026-06-13T21:00:10.000Z',
    lastSeenAt: '2026-06-13T21:00:10.000Z',
    sessionKey: 'tiktok',
    ...over,
  };
}

function renderGroup(group: RecordGroup): string {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, {
      lang: 'en',
      children: React.createElement(PostGroupCard, {
        group,
        feedbackMap: new Map(),
        onConfirm: () => {},
        onDispute: () => {},
        onViewOriginal: () => {},
      }),
    }),
  );
}

// The Heart icon's path is unique to the metric "like" slot (Confirm/Dispute use
// ThumbsUp/ThumbsDown, never Heart) — so its presence tells us the like icon.
const HEART_PATH = 'M19 14c1.49';

describe('FeedCard kind badge', () => {
  it('labels each record kind in its own badge', () => {
    expect(renderCard(makeRecord({ kind: 'post' }))).toMatch(/fc-kind-tag">\s*post/);
    expect(renderCard(makeRecord({ kind: 'comment' }))).toMatch(/fc-kind-tag">\s*comment/);
    expect(renderCard(makeRecord({ kind: 'reply' }))).toMatch(/fc-kind-tag">\s*reply/);
    // The on-card video tile was removed (FW stores no frames, removed 2026-06-28);
    // a video record is now marked solely by its kind badge.
    expect(renderCard(makeRecord({ kind: 'video' }))).toMatch(/fc-kind-tag">\s*media record/);
    expect(renderCard(makeRecord({ kind: 'environment' }))).toMatch(/fc-kind-tag">\s*AI safety summary/);
  });

  it('defaults a kind-less (legacy) record to "post"', () => {
    expect(renderCard(makeRecord({}))).toMatch(/fc-kind-tag">\s*post/);
  });
});

describe('FeedCard renders NO on-card media tile (removed 2026-06-28)', () => {
  // tiktok/youtube video records + every instagram card used to render a fixed-height
  // `fc-video-tile` placeholder. It was removed: FW stores no frames, so the empty
  // "video" frame only wasted ~480px of height and drove the Activity-feed scroll jump
  // (known-issues M34). A media record is now marked solely by its kind badge.
  it('emits no fc-video-tile / fc-play markup for video or instagram cards', () => {
    const cards = [
      renderCard(makeRecord({ platform: 'tiktok', kind: 'video' })),
      renderCard(makeRecord({ platform: 'youtube', kind: 'video' })),
      renderCard(makeRecord({ platform: 'instagram', kind: 'post' })),
    ];
    for (const html of cards) {
      expect(html).not.toMatch(/fc-video-tile/);
      expect(html).not.toMatch(/fc-play/);
    }
  });
});

describe('FeedCard "shown as" header matches the record mode', () => {
  // A rewrite (neutralizedText ≠ originalText) renders the "Shown to … as"
  // header. The audience word must follow the mode the record was captured
  // under, not a hardcoded "child" — found "Shown to the child as" on an
  // adult-mode record (2026-06-22).
  const rewrite = (mode: 'child' | 'teen' | 'adult') => makeRecord({
    kind: 'post',
    originalText: 'you are an idiot',
    neutralizedText: 'I disagree with you',
    configSnapshot: { mode, threshold: 0, dailyCap: 0 },
  });

  it.each(['child', 'teen', 'adult'] as const)('says "Shown as" for a %s record, never who the person is', (mode) => {
    const html = renderCard(rewrite(mode));
    expect(html).toContain('Shown as');
    expect(html).not.toContain('Shown to the child as');
    expect(html).not.toContain('Shown to the teen as');
  });
});

describe('FeedCard per-platform metric icon', () => {
  it('uses a heart for X / TikTok / Instagram likes', () => {
    expect(renderCard(makeRecord({ platform: 'twitter', kind: 'post', metrics: { likes: 50 } }))).toContain(HEART_PATH);
    expect(renderCard(makeRecord({ platform: 'tiktok', kind: 'post', metrics: { likes: 50 } }))).toContain(HEART_PATH);
  });

  it('uses a thumbs-up (not a heart) for Facebook / YouTube likes, and renders FB reactions', () => {
    const fb = renderCard(makeRecord({ platform: 'facebook', kind: 'post', metrics: { primary_likes: 100 } }));
    expect(fb).not.toContain(HEART_PATH);
    expect(fb).toContain('100'); // FB reaction count renders (primary_likes)
    expect(renderCard(makeRecord({ platform: 'youtube', kind: 'post', metrics: { likes: 12 } }))).not.toContain(HEART_PATH);
  });
});

describe('FeedCard metric caption + button labels', () => {
  it('no longer prints the capture-note caption on the card face', () => {
    const html = renderCard(makeRecord({ platform: 'facebook', metrics: { primary_likes: 5 } }));
    expect(html).not.toContain('captured at observation');
    expect(html).not.toContain('before FW hid');
  });

  it('renames the buttons to "Original Post" and "Refresh counts"', () => {
    const html = renderCardWith({
      record: makeRecord({ platform: 'twitter', kind: 'post', postUrl: 'https://x.com/u/status/1' }),
      onRecheck: async () => true,
    });
    expect(html).toContain('Original Post');
    expect(html).toContain('Refresh counts');
    expect(html).not.toContain('View original');
    expect(html).not.toContain('>Recheck<');
  });
});

describe('FeedCard growth readout', () => {
  it('renders the latest numbers + a "+delta since date" line when growth is present', () => {
    const html = renderCardWith({
      record: makeRecord({ platform: 'twitter', kind: 'post', metrics: { likes: 100 } }),
      growth: {
        sinceTs: '2026-06-10T10:00:00.000Z',
        latestTs: '2026-06-15T10:00:00.000Z',
        sightings: 2,
        latest: { likes: 1500 },
        deltas: [{ key: 'likes', from: 100, to: 1500, delta: 1400 }],
      },
    });
    expect(html).toContain('1.5K');         // latest numbers shown, not the card's own 100
    expect(html).toContain('+1.4K likes');  // growth delta
    // The date is written in the interface language on the reader's clock now.
    // 10:00 UTC lands on 10 June in every zone a browser actually runs in.
    expect(html).toContain('since Jun 10, 2026');
  });
});

describe('FeedCard comments button', () => {
  it('leads the actions row with a "N comments" button when the post hosts comments', () => {
    const html = renderCardWith({
      record: makeRecord({ platform: 'twitter', kind: 'post', postUrl: 'https://x.com/u/status/1' }),
      commentCount: 3,
      commentsExpanded: false,
      onToggleComments: () => {},
    });
    expect(html).toContain('fc-action-btn comments');
    expect(html).toContain('3 comments');
    // the comments button comes before "Original Post" in the row
    expect(html.indexOf('3 comments')).toBeLessThan(html.indexOf('Original Post'));
  });

  it('shows a disabled comments status when there are no recorded comments', () => {
    const html = renderCardWith({
      record: makeRecord({ platform: 'twitter', kind: 'post' }),
      commentCount: 0,
      onToggleComments: () => {},
    });
    expect(html).toContain('fc-action-btn comments');
    expect(html).toContain('No comments recorded');
    expect(html).toContain('disabled=""');
  });
});

describe('PostGroupCard group inventory', () => {
  it('counts checks, comments, and AI summaries with the same partition the card renders', () => {
    const group = makeGroup({
      children: [
        makeRecord({ id: 'video-ai', kind: 'video', parentVideoId: '123', videoContext: {
          overlayText: '', scene: 'scene', contentType: 'talking-head',
          techniques: [], severity: 0, model: 'gemini', frameCount: 3,
        } }),
        makeRecord({ id: 'c1', kind: 'comment', parentVideoId: '123' }),
        makeRecord({ id: 'c2', kind: 'reply', parentVideoId: '123' }),
        makeRecord({ id: 'env1', kind: 'environment', parentVideoId: '123', environment: {
          label: 'sparse',
          summary: 'quiet',
          dominantTechnique: null,
          negativePct: 0,
          positivePct: 0,
          neutralPct: 100,
          sampled: 2,
        } }),
      ],
    });

    expect(countGroupInventory(group)).toEqual({
      checks: 2,
      comments: 2,
      aiSummaries: 1,
    });
  });

  it('renders the inventory line so grouped records do not look missing', () => {
    const html = renderGroup(makeGroup({
      children: [
        makeRecord({ id: 'video-ai', kind: 'video', parentVideoId: '123', videoContext: {
          overlayText: '', scene: 'scene', contentType: 'talking-head',
          techniques: [], severity: 0, model: 'gemini', frameCount: 3,
        } }),
        makeRecord({ id: 'c1', kind: 'comment', parentVideoId: '123' }),
        makeRecord({ id: 'c2', kind: 'comment', parentVideoId: '123' }),
        makeRecord({ id: 'env1', kind: 'environment', parentVideoId: '123', environment: {
          label: 'sparse',
          summary: 'quiet',
          dominantTechnique: null,
          negativePct: 0,
          positivePct: 0,
          neutralPct: 100,
          sampled: 2,
        } }),
      ],
    }));

    expect(html).toContain('pg-inventory');
    expect(html).toContain('checked 2');
    expect(html).toContain('2 comments');
    expect(html).toContain('1 AI interpretation');
  });
});

describe('FeedCard media detail status', () => {
  it('shows pending media status for video-capable records without videoContext', () => {
    const html = renderCard(makeRecord({ platform: 'tiktok', kind: 'video', videoContext: undefined }));
    expect(html).toContain('Media pending');
    expect(html).toContain('disabled=""');
  });

  it('shows ready media status when videoContext carries frame evidence', () => {
    const html = renderCard(makeRecord({
      platform: 'tiktok',
      kind: 'video',
      videoContext: {
        description: 'caption',
        overlayText: 'burned text',
        scene: 'person speaking to camera',
        contentType: 'talking-head',
        techniques: ['fear-appeal'],
        severity: 6,
        model: 'gemini-flash-lite',
        frameCount: 3,
        transcript: 'spoken words',
        audioModel: 'whisper-large-v3-turbo',
      },
    } as Partial<ForensicRecord>));
    expect(html).toContain('Media ready');
    // The on-card tile (which used to footnote "Frames analyzed") was removed; the
    // frame/scene evidence is surfaced by the always-mounted forensic-detail drawer.
    expect(html).toContain('burned text');             // vc.overlayText — on-screen text
    expect(html).toContain('person speaking to camera'); // vc.scene — eyes reading
  });
});

describe('FeedCard timeline-spine structure (locked redesign)', () => {
  it('emits the fc-tl-* card shell: head (who + record meta), quote, foot', () => {
    const html = renderCard(makeRecord({
      platform: 'tiktok', kind: 'post', chainPosition: 214,
      originalText: 'a sample post', verdict: 'flagged',
      techniques: [{ name: 'shame-attack', severity: 9, confidence: 0.9 }],
      metrics: { primary_likes: 1200000, comments_count: 2100 },
    }));
    // the card is an <article> with the timeline-card class
    expect(html).toMatch(/<article class="feed-card fc-tl-card/);
    for (const cls of ['fc-tl-head', 'fc-tl-who', 'fc-tl-l1', 'fc-tl-l2', 'fc-tl-rmeta', 'fc-tl-quote', 'fc-tl-foot']) {
      expect(html).toContain(cls);
    }
    // line 1 carries the at-a-glance technique chip; the chain-link names the
    // prior record (#chainPosition − 1); the foot carries the reach metrics.
    expect(html).toContain('fc-tech-tag');
    expect(html).toMatch(/fc-chainlink[\s\S]*#213/);
    expect(html).toContain('class="reach"');
  });

  it('renders a YouTube video record’s title on the card face (regression: it must not vanish)', () => {
    // YouTube videoContext.description is always empty (identity.ts), so the
    // caption must fall back to originalText or the title shows nothing.
    const html = renderCard(makeRecord({
      platform: 'youtube', kind: 'video', chainPosition: 1017,
      originalText: 'Why school keeps you POOR | the truth about the system',
      videoContext: {
        description: '', overlayText: '', scene: 's', contentType: 'talking-head',
        techniques: [], severity: 5, model: 'gemini-flash-lite', frameCount: 3, transcript: 't',
      },
    } as Partial<ForensicRecord>));
    expect(html).toContain('Why school keeps you POOR');
  });

  it('node severity follows the marker ramp; passed reads green', () => {
    expect(timelineSeverity(makeRecord({ verdict: 'pass' }))).toBe('pass');
    expect(timelineSeverity(makeRecord({ techniques: [{ name: 'x', severity: 9, confidence: 1 }] }))).toBe('hi');
    expect(timelineSeverity(makeRecord({ techniques: [{ name: 'x', severity: 6, confidence: 1 }] }))).toBe('mi');
    expect(timelineSeverity(makeRecord({ techniques: [{ name: 'x', severity: 2, confidence: 1 }] }))).toBe('lo');
    // a record FW hid/blocked never reads faint even with a low technique severity
    expect(timelineSeverity(makeRecord({ verdict: 'flagged-hidden', techniques: [{ name: 'profanity', severity: 4, confidence: 1 }] }))).toBe('mi');
    expect(timelineSeverity(makeRecord({ verdict: 'blocked' }))).toBe('mi');
    expect(timelineSeverity(makeRecord({ verdict: 'blocked', techniques: [{ name: 'ai-content-block', severity: 10, confidence: 1 }] }))).toBe('hi');
  });

  it('TimelineRow hangs a gutter node-circle beside the card', () => {
    const html = renderToStaticMarkup(
      React.createElement(I18nProvider, {
        lang: 'en',
        children: React.createElement(TimelineRow, {
          record: makeRecord({ verdict: 'pass', kind: 'comment' }),
          rowClass: 'sub',
          children: React.createElement(FeedCard, { record: makeRecord({ verdict: 'pass', kind: 'comment' }) }),
        }),
      }),
    );
    expect(html).toMatch(/<div class="fc-tl-row sub"/);
    expect(html).toContain('fc-tl-gutter');
    expect(html).toMatch(/fc-tl-node pass/);
    // The dot explains its colour on hover so the timeline isn't a mystery.
    expect(html).toContain('Passed. Feedprint found no manipulation');
  });
});

describe('FeedCard rewrite display', () => {
  // The locked timeline-spine redesign shows the rewrite INLINE beneath the
  // verbatim quote ("Shown to … as"), so the calmer version is visible without a
  // reveal click — the verbatim original still reads first because it renders
  // above the rewrite block. The audience word follows the record mode; the
  // default makeRecord is a teen record, so the header reads "the teen".
  it('renders the rewrite inline, under the verbatim quote', () => {
    const html = renderCard(makeRecord({
      originalText: 'the original',
      neutralizedText: 'a calmer version',
      techniques: [
        { name: 'fear-appeal', severity: 6, confidence: 0.9 },
        { name: 'false-urgency', severity: 4, confidence: 0.8 },
      ],
    }));
    expect(html).toContain('Shown as');
    expect(html).toContain('a calmer version');
    expect(html).toContain('the original');
    // verbatim quote renders before the rewrite block
    expect(html.indexOf('the original')).toBeLessThan(html.indexOf('a calmer version'));
  });
});
