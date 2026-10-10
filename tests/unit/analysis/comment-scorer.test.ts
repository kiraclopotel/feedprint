import { describe, it, expect } from 'vitest';
import { scoreAndRankComments, RawComment } from '../../../src/analysis/comment-scorer';

function makeComment(overrides: Partial<RawComment> = {}): RawComment {
  return {
    text: 'A normal comment here',
    likes: 0,
    replies: 0,
    isPinned: false,
    isCreatorReply: false,
    isHighlighted: false,
    authorHandle: '@user',
    timestamp: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('comment-scorer', () => {
  // a) Substantive comments rank above emoji-only comments
  it('ranks substantive comments above emoji-only comments', () => {
    const comments = [
      makeComment({ text: '😂😂😂' }),
      makeComment({ text: 'This video makes a really important point about media literacy and critical thinking' }),
    ];
    const batch = scoreAndRankComments(comments);
    expect(batch.top[0].raw.text).toContain('media literacy');
    expect(batch.top[0].composite).toBeGreaterThan(batch.top[1].composite);
  });

  // b) "Totally safe bro, what could go wrong!!!" scores > 0.3 sarcasm
  it('detects sarcasm in "Totally safe bro, what could go wrong!!!"', () => {
    const comments = [makeComment({ text: 'Totally safe bro, what could go wrong!!!' })];
    const batch = scoreAndRankComments(comments);
    expect(batch.all[0].scores.sarcasm).toBeGreaterThan(0.3);
  });

  // c) "Sigur, foarte 'educativ'..." scores > 0.3 sarcasm
  it('detects sarcasm in Romanian "Sigur, foarte \'educativ\'..."', () => {
    const comments = [makeComment({ text: "Sigur, foarte 'educativ'..." })];
    const batch = scoreAndRankComments(comments);
    expect(batch.all[0].scores.sarcasm).toBeGreaterThan(0.3);
  });

  // d) Pinned creator comments get creatorSignal > 0.4
  it('gives pinned creator comments creatorSignal > 0.4', () => {
    const comments = [makeComment({ isPinned: true })];
    const batch = scoreAndRankComments(comments);
    expect(batch.all[0].scores.creatorSignal).toBeGreaterThan(0.4);
  });

  // e) A batch of 5 spam comments produces confidence 'low'
  it('produces confidence low for 5 spam comments', () => {
    const comments = [
      makeComment({ text: 'First!' }),
      makeComment({ text: 'sub4sub anyone?' }),
      makeComment({ text: '😂😂😂' }),
      makeComment({ text: 'Check out my channel for more' }),
      makeComment({ text: 'Free v-bucks click here' }),
    ];
    const batch = scoreAndRankComments(comments);
    expect(batch.confidence).toBe('low');
  });

  // f) A batch of 20 substantive comments produces confidence 'normal' and top.length === 15
  it('produces confidence normal and top 15 for 20 substantive comments', () => {
    const comments = Array.from({ length: 20 }, (_, i) =>
      makeComment({ text: `This is a thoughtful and substantive comment number ${i} about the video content and its implications` })
    );
    const batch = scoreAndRankComments(comments);
    expect(batch.confidence).toBe('normal');
    expect(batch.top).toHaveLength(15);
  });

  // g) Self-promotion ("check out my channel") has noise > 0.3
  it('flags self-promotion with noise > 0.3', () => {
    const comments = [makeComment({ text: 'Check out my channel for more content like this!' })];
    const batch = scoreAndRankComments(comments);
    expect(batch.all[0].scores.noise).toBeGreaterThan(0.3);
  });

  // h) A genuine long comment ranks above a high-like emoji comment
  it('ranks genuine long comment above high-like emoji comment', () => {
    const comments = [
      makeComment({ text: '😂😂😂', likes: 5000 }),
      makeComment({ text: 'This video uses fear tactics to make you feel inadequate about your body image', likes: 10 }),
    ];
    const batch = scoreAndRankComments(comments);
    expect(batch.top[0].raw.text).toContain('fear tactics');
    expect(batch.top[0].composite).toBeGreaterThan(batch.top[1].composite);
  });
});
